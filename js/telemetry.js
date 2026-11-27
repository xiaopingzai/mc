'use strict';
// ---------------------------------------------------------------------------
// Statistics and feedback (multiplayer/TELEMETRY_PLAN.md). Anonymous play and performance data goes to the room
// service (POST /api/telemetry) every few minutes and when the page closes; nothing about who the player is (an
// install id that is a random number, no names, no chat, no IP - the service keeps only a salted hash of it).
// On by default; Options -> 遥测数据 turns it off. Kept cheap: one fixed histogram of frame times a minute, a
// handful of counters, no work in a frame beyond a few additions.
// What is sent: the device (GPU, cores, memory, screen, refresh, browser, touch, inside the bilibili app), load
// times, a point a minute (frame time median / 95th / 99th, 1% low, main thread / chunk / render / GPU time,
// memory, entities, chunks, view distance, dynamic resolution, preset, single player or a room, dimension),
// stalls over 100 ms and what was going on, errors (message and file:line, no addresses), the screens opened
// and commands used (by name), deaths, worlds loaded; on a server the round trip times, disconnects and how long
// the room took to start.
// Feedback (FeedbackScreen): a kind, a description, optionally a screenshot, with the same device and recent
// performance data, to POST /api/feedback (the service limits it per IP).
// A page served from this machine (localhost) sends nothing unless ?rooms= points at a test service - testing
// here must not mix into the real data.
// ---------------------------------------------------------------------------
const TELEMETRY_V = 1;
const GAME_BUILD = '2026.11.27d';
const Telemetry = {
  g: null, sid: Math.random().toString(36).slice(2, 10), seq: 0, t0: performance.now(),
  hist: new Uint16Array(201), frames: 0, sum: { cpu: 0, chunk: 0, render: 0, gpu: 0, gpuN: 0 }, minuteAt: 0, playMs: 0, afkMs: 0,
  points: [], stalls: [], errors: new Map(), counts: {}, events: [], rtt: [], lastFlush: performance.now(),
  pings: new Map(), pingSeq: 0, lastPing: 0, prevState: null, loadStart: 0,
  // where the data goes, and whether it may go there
  // PHP 直接部署时 NET_CONFIG.rooms 为空，但站点自带 api/telemetry.php；此时回退到同源 api 路径。
  base() { return (typeof RoomService !== 'undefined' && RoomService.base()) || (typeof Account !== 'undefined' ? Account.apiBase() : 'api'); },
  url() { return (typeof RoomService !== 'undefined' && RoomService.base()) ? this.base() + '/api/telemetry' : 'api/telemetry.php'; },
  on() {
    const g = this.g;
    if (!g || g.settings.telemetry === false || !/^https?:$/.test(location.protocol) || !this.base()) return false;
    // (*.localhost / *.test too: test pages on per-test origins sent their numbers to the live service, and its origin
    // check banned the developer's own address, 2026-11-03)
    const local = /^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(location.hostname) || /\.(localhost|test)$/.test(location.hostname);
    return !local || new URLSearchParams(location.search).has('rooms');
  },
  // this browser's anonymous id (a random number kept in the page's storage), and whether it is new here
  install() {
    if (this._id) return this._id;
    let id = null, fresh = false;
    try { id = localStorage.getItem('mcjs-tid'); if (!id) { id = [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('mcjs-tid', id); fresh = true; } }
    catch (e) { id = 'nostore-' + this.sid; }
    this._fresh = fresh;
    return (this._id = id);
  },
  device() {
    const g = this.g, ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'edge' : /OPR\//.test(ua) ? 'opera' : /Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : 'other';
    const os = /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Mac OS/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'other';
    let gpu = '';
    try { gpu = PerfMon.gpuName(g.renderer.gl); } catch (e) { }
    return {
      gpu: String(gpu).slice(0, 120), cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0,
      sw: screen.width, sh: screen.height, dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100, hz: g.pacer ? Math.round(1000 / g.pacer.refresh) : 0,
      browser, bver: (ua.match(/(?:Chrome|Firefox|Version)\/(\d+)/) || [])[1] || '', os,
      touch: typeof TouchDevice !== 'undefined' ? TouchDevice.kind : '', bili: /BiliApp|bili-/i.test(ua), lang: navigator.language || '',
    };
  },
  count(k, n = 1) { if (Object.keys(this.counts).length < 300 || this.counts[k] !== undefined) this.counts[k] = (this.counts[k] || 0) + n; },
  event(type, data) { if (this.events.length < 200) this.events.push({ t: Math.round((performance.now() - this.t0) / 1000), type, ...data }); },
  error(where, msg, stack) {
    // (just the message and the first file:line - no page address, nothing typed by the player)
    const at = String(stack || '').split('\n').map(s => s.trim()).find(s => /\.js:\d+/.test(s)) || '';
    const loc = (at.match(/([\w.-]+\.js):(\d+)/) || []).slice(1, 3).join(':');
    const k = (where ? where + ': ' : '') + String(msg || '').replace(/https?:\/\/\S+/g, '<url>').slice(0, 200) + (loc ? ' @' + loc : '');
    const e = this.errors.get(k);
    if (e) e.n++; else if (this.errors.size < 50) this.errors.set(k, { n: 1, first: Math.round((performance.now() - this.t0) / 1000) });
  },
  // every frame (perf.js PerfMon.frame): a few additions while playing
  frame(dt, cpu, chunk, render) {
    const g = this.g; if (!g) return;
    if (g.state !== this.prevState) this.stateChanged(this.prevState, g.state);
    if (document.hidden) { this.away = true; return; }
    // the first frame back from a hidden tab carries the whole time away (a 36 s "stall" in the first real data);
    // a frame of more than 10 s is a suspended page, not a stall either
    if (this.away || dt > 10000) { this.away = false; return; }
    if (g.state !== 'play' || (g.ui.screen && g.ui.screen.pauses)) return;
    // (nor a frame held to 30 / 10 by the inactivity limit, or the one after: perf.js FramePacer.cappedFrame. Its time
    // still counts as played - the session's play time meant that before the limit came)
    if (g.pacer && g.pacer.cappedFrame) { this.afkMs += dt; return; }
    this.hist[Math.min(200, dt | 0)]++; this.frames++; this.playMs += dt;
    this.sum.cpu += cpu; this.sum.chunk += chunk; this.sum.render += render;
    if (PerfMon.gpuOn && PerfMon.lastGpu != null) { this.sum.gpu += PerfMon.lastGpu; this.sum.gpuN++; }
    if (dt > 100 && this.stalls.length < 100) this.stalls.push({ t: Math.round((performance.now() - this.t0) / 1000), ms: Math.round(dt), cpu: Math.round(cpu), chunk: Math.round(chunk), ents: g.entities ? g.entities.length : 0, dim: g.dim, net: !!g.net, screen: g.ui.screen ? g.ui.screen.constructor.name : '' });
    if (this.playMs - this.minuteAt >= 60000) { this.minuteAt = this.playMs; this.point(); }
  },
  stateChanged(from, to) {
    const now = performance.now();
    this.prevState = to;
    Crumbs.mark('s:' + to);
    if (to === 'title' && !this.titleAt) { this.titleAt = now; this.event('title', { ms: Math.round(now) }); }
    if (to === 'loading' || to === 'switching') this.loadStart = now;
    if (to === 'play' && this.loadStart) { this.event('enter', { ms: Math.round(now - this.loadStart), net: !!this.g.net, dim: this.g.dim }); this.loadStart = 0; }
  },
  // one minute of play: the frame time distribution and what the game was doing
  point() {
    const g = this.g, h = this.hist, n = this.frames;
    if (!n) return;
    const pct = (q) => { let k = Math.ceil(n * q), i = 0; for (; i < 201; i++) { k -= h[i]; if (k <= 0) break; } return i; };
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const s = g.settings;
    this.points.push({
      m: Math.round(this.playMs / 60000), fps: Math.round(n / (this.playMs - (this.lastPointMs || 0)) * 1000 * 10) / 10,
      p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), cpu: +(this.sum.cpu / n).toFixed(2), chunk: +(this.sum.chunk / n).toFixed(2), render: +(this.sum.render / n).toFixed(2),
      gpu: this.sum.gpuN ? +(this.sum.gpu / this.sum.gpuN).toFixed(2) : null, mem,
      ents: g.entities ? g.entities.length : 0, chunks: g.world && g.world.chunks ? g.world.chunks.size : 0, rd: s.renderDist,
      dyn: typeof DynRes !== 'undefined' ? DynRes.scale : 1, res: s.resScale, preset: s.preset || '', shaders: s.shaders || 0, maxFps: s.maxFps || 0, vsync: s.vsync !== false,
      lim: g.pacer ? g.pacer.playLimit : 0, // (the limit in effect: maxFps 0 is 60 on a 90/120 Hz phone, -1 跟随屏幕; 0 = the screen's rate)
      mode: g.net ? 'room' : 'single', dim: g.dim, gm: g.mode,
    });
    this.lastPointMs = this.playMs;
    h.fill(0); this.frames = 0; this.sum = { cpu: 0, chunk: 0, render: 0, gpu: 0, gpuN: 0 };
    if (this.points.length > 60) this.points.shift();
  },
  packet(final) {
    const net = this.rtt.length ? { rtt: this.rttSummary() } : null;
    const p = {
      v: TELEMETRY_V, kind: 'session', id: this.install(), sid: this.sid, seq: this.seq++, build: GAME_BUILD, final: !!final,
      fresh: !!this._fresh, dur: Math.round((performance.now() - this.t0) / 1000), play: Math.round((this.playMs + this.afkMs) / 1000),
      dev: this.seq === 1 ? this.device() : undefined, points: this.points, stalls: this.stalls,
      errors: [...this.errors].map(([k, e]) => ({ k, ...e })), counts: this.counts, events: this.events, net,
    };
    this.points = []; this.stalls = []; this.errors = new Map(); this.counts = {}; this.events = []; this.rtt = [];
    return p;
  },
  rttSummary() { const s = [...this.rtt].sort((a, b) => a - b); return { n: s.length, p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; },
  hasData() { return this.points.length || this.stalls.length || this.errors.size || this.events.length || Object.keys(this.counts).length || this.rtt.length; },
  // a packet every 5 minutes (a minute's point is made first if one is half done); the last one as the page goes
  flush(final) {
    if (!this.on()) return;
    if (final && this.frames > 600) this.point();
    if (!this.hasData() && this.seq > 0 && !final) return;
    const body = JSON.stringify(this.packet(final)), url = this.url();
    if (body.length > 120000) return;
    try {
      if (final && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      else fetch(url, { method: 'POST', body, keepalive: body.length < 60000, mode: 'cors' }).catch(() => { });
    } catch (e) { }
    this.lastFlush = performance.now();
  },
  // a second's upkeep: pings on a server, the five-minute packet
  tick() {
    const g = this.g, now = performance.now();
    if (g && g.net && now - this.lastPing > 10000 && g.net.ws && g.net.ws.readyState === 1) {
      this.lastPing = now; const i = ++this.pingSeq; this.pings.set(i, now); g.net.send({ t: 'ping', i });
      if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value);
    }
    if (now - this.lastFlush > 300000) this.flush(false);
  },
  init(g) {
    this.g = g; this.prevState = g.state;
    setInterval(() => { try { this.tick(); } catch (e) { } }, 1000);
    addEventListener('pagehide', () => this.flush(true));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(false); });
    addEventListener('error', (e) => this.error('page', e.message, e.error && e.error.stack || (e.filename ? `${e.filename}:${e.lineno}` : '')));
    addEventListener('unhandledrejection', (e) => this.error('promise', e.reason && e.reason.message || String(e.reason), e.reason && e.reason.stack));
    try { g.renderer.canvas.addEventListener('webglcontextlost', () => { this.event('contextlost', {}); Crumbs.mark('ctx'); }); } catch (e) { }
    this.install(); if (this._fresh) this.event('firstrun', {});
    try { Crumbs.init(g); } catch (e) { }
    try { Instances.init(g); } catch (e) { }
    // (the title screen was already up when this started: the time it took from opening the page)
    if (g.state === 'title' && !this.titleAt) { this.titleAt = performance.now(); this.event('title', { ms: Math.round(this.titleAt) }); }
  },
};

// ---- the hooks ----
(() => {
  const _init = Game.prototype.init;
  Game.prototype.init = async function (...a) { const r = await _init.apply(this, a); try { Telemetry.init(this); } catch (e) { } return r; };
  const _frame = PerfMon.frame;
  PerfMon.frame = function (dt, cpu, chunk, g) { const r = _frame.call(this, dt, cpu, chunk, g); try { Telemetry.frame(dt, cpu, chunk, this.renderMs || 0); } catch (e) { } return r; };
  // the renderer's side of a frame (render.js): nothing is drawn while the WebGL context is lost (its notice is up and a
  // tap reloads); inFrame - a canvas resize asked for between frames waits for the next one (it showed a black frame)
  const _render = Game.prototype.render;
  Game.prototype.render = function (a, now) {
    const r = this.renderer;
    if (r && r.lost) { if (r.lostFrame) r.lostFrame(this); return; }
    if (r) r.inFrame = true;
    try { return _render.call(this, a, now); } finally { if (r) r.inFrame = false; }
  };
  const _err = Game.prototype.reportError;
  Game.prototype.reportError = function (where, e, quiet) { Telemetry.error(where, e && e.message || e, e && e.stack); return _err.call(this, where, e, quiet); };
  const _open = UI.prototype.open;
  UI.prototype.open = function (screen) { if (screen && screen.constructor) { Telemetry.count('screen:' + screen.constructor.name); Crumbs.mark('o:' + screen.constructor.name.replace(/Screen$/, '')); } return _open.call(this, screen); };
  const _death = Game.prototype.onPlayerDeath;
  Game.prototype.onPlayerDeath = function (src) { Telemetry.count('death:' + (src && src.type || 'other')); return _death.call(this, src); };
  const _load = Game.prototype.loadWorld;
  Game.prototype.loadWorld = function (...a) { Telemetry.count('world:load'); return _load.apply(this, a); };
  const _create = Game.prototype.createWorld;
  Game.prototype.createWorld = function (...a) { Telemetry.count('world:create:' + (a[2] || '')); return _create.apply(this, a); };
  if (typeof cmdExec === 'function') {
    const _cmd = cmdExec;
    // (a command block's commands aren't counted: a repeating one would run 20 a second)
    cmdExec = function (g, text, src) { if (!src) Telemetry.count('cmd:' + String(text).slice(1).split(/\s+/)[0].replace(/^minecraft:/, '').slice(0, 20)); return _cmd(g, text, src); };
  }
  if (typeof NetClient !== 'undefined') {
    const _om = NetClient.prototype.onMessage;
    NetClient.prototype.onMessage = function (m) {
      if (m && m.t === 'pong') { const t = Telemetry.pings.get(m.i); if (t) { Telemetry.pings.delete(m.i); if (Telemetry.rtt.length < 500) Telemetry.rtt.push(Math.round(performance.now() - t)); } return; }
      if (m && m.t === 'notice' && !this.roomWaitAt) this.roomWaitAt = performance.now();
      if (m && m.t === 'room') { Telemetry.event('room', { wait: this.roomWaitAt ? Math.round(performance.now() - this.roomWaitAt) : 0 }); Telemetry.count('net:room'); }
      return _om.call(this, m);
    };
    const _fail = NetClient.prototype.fail;
    NetClient.prototype.fail = function (reason) { Telemetry.count('net:fail'); Telemetry.event('netfail', { why: String(reason || '').slice(0, 80) }); return _fail.call(this, reason); };
  }
  // (the last things done, for Crumbs: the window's size, the on-screen keyboard's field, errors)
  const _rs = Game.prototype.resize;
  Game.prototype.resize = function (...a) { try { Crumbs.mark('rs:' + innerWidth + 'x' + innerHeight); } catch (e) { } return _rs.apply(this, a); };
  const _si = UI.prototype.showInput, _hi = UI.prototype.hideInput;
  UI.prototype.showInput = function (...a) { try { if (this.input.style.display !== 'block') Crumbs.mark('kb+'); } catch (e) { } return _si.apply(this, a); };
  UI.prototype.hideInput = function (...a) { try { if (this.input.style.display === 'block') Crumbs.mark('kb-'); } catch (e) { } return _hi.apply(this, a); };
  const _err2 = Game.prototype.reportError;
  Game.prototype.reportError = function (where, e, quiet) { try { Crumbs.mark('e:' + String(where || '').slice(0, 14)); } catch (x) { } return _err2.call(this, where, e, quiet); };
})();

// ---- the last moments of a page that died (11-07: a page killed on Apple devices sends nothing, and the reopened one
// can't say what it was doing - one in five iPhone sessions in the Bilibili app since the 11-06 version). Every 2 s and
// at each mark, a few words about this page go into the page's storage (what state and screen, the canvases' sizes,
// the last 10 things done); leaving the page properly marks it ended. The next page to start sends any that never
// ended, as a 'died' event: how long it lived, whether it was hidden (killed in the background) or on screen. Nothing
// about the player - the same kind of facts as the rest of the statistics ----
const Crumbs = {
  KEY: 'mcjs-crumbs', marks: [], g: null, lastW: 0,
  mark(k) {
    this.marks.push(Math.round((performance.now() - Telemetry.t0) / 1000) + ':' + k);
    if (this.marks.length > 10) this.marks.shift();
    if (this.g && performance.now() - this.lastW > 200) this.save();
  },
  read() { try { const o = JSON.parse(localStorage.getItem(this.KEY) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } },
  save(end) {
    const g = this.g; if (!g) return;
    this.lastW = performance.now();
    try {
      const r = g.renderer, u = g.ui, sc = u && u.screen, inp = u && u.input;
      const rec = {
        at: Date.now(), up: Math.round((performance.now() - Telemetry.t0) / 1000), v: GAME_BUILD, st: g.state, sc: sc ? sc.constructor.name : '',
        hid: !!document.hidden, gl: r ? r.canvas.width + 'x' + r.canvas.height : '', ui: u && u.canvas ? u.canvas.width + 'x' + u.canvas.height : '',
        rs: r ? r.resScale : 0, sec: r && r.sections ? r.sections.size : 0, mb: r && r.arena ? Math.round(r.arena.total / 1048576) : 0,
        ent: g.entities ? g.entities.length : 0, net: !!g.net, kb: !!(inp && document.activeElement === inp), lost: !!(r && r.lost),
        old: !!Instances.stale, mk: this.marks.join(' '), end: end ? 1 : 0,
      };
      const all = this.read(); all[Telemetry.sid] = rec;
      const ids = Object.keys(all); if (ids.length > 4) for (const k of ids.sort((a, b) => all[a].at - all[b].at).slice(0, ids.length - 4)) delete all[k];
      localStorage.setItem(this.KEY, JSON.stringify(all));
    } catch (e) { }
  },
  init(g) {
    this.g = g;
    // (the pages before this one that never ended: each sent once, then forgotten. One written in the last 5 s may be
    // a page still open - a second one: Instances - and is left)
    const all = this.read(), now = Date.now();
    for (const [sid, r] of Object.entries(all)) {
      if (sid === Telemetry.sid || !r || typeof r !== 'object') continue;
      if (!r.end && now - r.at < 5000) continue;
      if (!r.end && now - r.at < 6 * 3600e3) Telemetry.event('died', { ago: Math.round((now - r.at) / 1000), up: r.up, v: r.v, st: r.st, sc: r.sc, hid: r.hid, gl: r.gl, ui: r.ui, rs: r.rs, sec: r.sec, mb: r.mb, ent: r.ent, net: r.net, kb: r.kb, lost: r.lost, old: r.old, mk: String(r.mk || '').slice(0, 260) });
      delete all[sid];
    }
    try { localStorage.setItem(this.KEY, JSON.stringify(all)); } catch (e) { }
    if (Telemetry.events.some((e) => e.type === 'died')) setTimeout(() => Telemetry.flush(false), 4000);
    setInterval(() => this.save(), 2000);
    addEventListener('pagehide', () => this.save(true));
    // (back from the background: not ended after all - a page hidden and shown again fires no pagehide on some phones)
    document.addEventListener('visibilitychange', () => { this.mark(document.hidden ? 'hid' : 'vis'); });
    document.addEventListener('fullscreenchange', () => this.mark('fs'));
    document.addEventListener('webkitfullscreenchange', () => this.mark('fs'));
    this.save();
  },
};

// ---- one game page at a time (11-07). In the Bilibili app 去三连 opens the video's own page, and that page has the
// game's entry on it: players came back by it and had a second game page open, the first behind it (telemetry: new
// sessions started while the old one was still sending - and the old one, gone back to, would save its older world over
// the new page's). A page on screen says so (at start, and each time it comes back on screen); a page that hears of a
// newer one saves once if it is on screen (two tabs on a computer), then writes nothing more - the saves are refused -
// pauses, and shows a notice whose button reloads it (and so makes it the newest). A page opened out of sight (a preload)
// says nothing until it is shown ----
const Instances = {
  stale: false, leaving: false, at: 0, ch: null, g: null,
  key() { return 'mcjs-inst:' + location.pathname; },
  init(g) {
    this.g = g;
    try { this.ch = new BroadcastChannel(this.key()); this.ch.onmessage = (e) => this.heard(e.data); } catch (e) { }
    addEventListener('storage', (e) => { if (e.key === this.key() && e.newValue) { try { this.heard(JSON.parse(e.newValue)); } catch (x) { } } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.shown(); });
    // (the saves: refused once stale - wrapped here, after every file has wrapped them its own way: cloudsave.js, p2p.js)
    if (typeof DB !== 'undefined') for (const k of ['putChunks', 'putWorld']) {
      const f = DB[k]; if (typeof f !== 'function') continue;
      DB[k] = function (...a) { return Instances.stale ? Promise.resolve() : f.apply(this, a); };
    }
    if (!document.hidden) this.announce();
  },
  announce() {
    this.at = Date.now();
    const m = { t: 'hello', id: Telemetry.sid, at: this.at };
    try { localStorage.setItem(this.key(), JSON.stringify(m)); } catch (e) { }
    try { if (this.ch) this.ch.postMessage(m); } catch (e) { }
  },
  // on screen again: a newer page said hello meanwhile (its message may not have reached this one, asleep behind it)
  shown() {
    if (this.stale || this.leaving) return;
    let m = null; try { m = JSON.parse(localStorage.getItem(this.key()) || 'null'); } catch (e) { }
    if (m && m.id !== Telemetry.sid && m.at > this.at && this.at) { this.goStale(); return; }
    this.announce();
  },
  heard(m) {
    if (!m || m.t !== 'hello' || m.id === Telemetry.sid || this.stale || this.leaving) return;
    if (this.at && (m.at > this.at || (m.at === this.at && m.id > Telemetry.sid))) this.goStale();
  },
  async goStale() {
    if (this.stale || this.leaving) return;
    this.leaving = true;
    const g = this.g;
    try { Crumbs.mark('old'); Telemetry.count('inst_old'); Telemetry.event('inst_old', { st: g.state, hid: !!document.hidden }); } catch (e) { }
    // (on screen - two tabs: what it has is the newest, saved; out of sight it was saved when it was hidden: main.js)
    try { if (g.state === 'play' && !g.net && !document.hidden && g.saveWorld) await Promise.race([g.saveWorld(true), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { }
    this.stale = true;
    try { if (g.state === 'play' && !g.net && g.ui && !(g.ui.screen && g.ui.screen.pauses) && typeof PauseScreen !== 'undefined') g.ui.open(new PauseScreen(g)); } catch (e) { }
    try { if (g.net && g.net.close) g.net.close(); } catch (e) { }
    try { if (g.releasePointer) g.releasePointer(); } catch (e) { }
    try { if (Sound.sleep) Sound.sleep('old'); } catch (e) { }
    try { this.notice(); } catch (e) { }
  },
  notice() {
    if (this.el || typeof document === 'undefined') return;
    const d = this.el = document.createElement('div');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:60;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.9);color:#fff;font:15px "Microsoft YaHei",sans-serif;text-align:center';
    const line = (text, css) => { const e = document.createElement('div'); e.textContent = text; if (css) e.style.cssText = css; d.appendChild(e); return e; };
    line('游戏在另一个页面里打开了', 'font-size:22px;font-weight:bold;margin-bottom:6px');
    line('这个页面已经停下，不会再存档，免得覆盖另一个页面的进度');
    const btn = line('点这里在这个页面继续（会重新载入）', 'margin-top:14px;padding:10px 28px;border:2px solid #fff;background:rgba(255,255,255,0.12)');
    let going = false;
    d.addEventListener('pointerup', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (going) return; going = true; btn.textContent = '正在重新载入…';
      try { Telemetry.count('inst_reload'); Telemetry.flush(false); } catch (x) { }
      // (not 'play': the page's "leave?" prompt asks only then - nothing here is left to save)
      try { this.g.state = 'boot'; } catch (x) { }
      location.reload();
    });
    for (const k of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown', 'wheel', 'keydown']) d.addEventListener(k, (e) => e.stopPropagation(), { passive: true });
    (document.getElementById('stage') || document.body).appendChild(d);
  },
};

// ---- feedback (Options -> 遥测数据 -> 反馈问题, the pause menu, the title screen) ----
const FEEDBACK_KINDS = [['bug', '错误（bug）'], ['lag', '卡顿 / 性能'], ['idea', '建议'], ['other', '其他']];
// a feedback sent (FeedbackScreen, and the AI companion for the player - companion.js), with what the game is like now
// -> null, or what went wrong
async function postFeedback(g, kind, text, shot) {
  // the recent performance: the points not yet sent and the minute going on
  if (Telemetry.frames > 120) Telemetry.point();
  const ctx = {
    build: GAME_BUILD, id: Telemetry.install(), dev: Telemetry.device(), perf: Telemetry.points.slice(-5), stalls: Telemetry.stalls.slice(-10),
    errors: [...Telemetry.errors].slice(-10).map(([k, e]) => ({ k, ...e })), mode: g.net ? 'room' : g.state === 'play' ? 'single' : g.state,
    room: g.net && g.net.room ? g.net.room.code : null, dim: g.dim, settings: { rd: g.settings.renderDist, preset: g.settings.preset, shaders: g.settings.shaders, dyn: g.settings.dynRes },
  };
  try {
    await Account.api('/api/feedback', { v: 1, kind, text, shot, ctx });
    return null;
  } catch (e) { return e.message || '连不上服务器'; }
}
class FeedbackScreen extends FormScreen {
  constructor(game, parent, shot) {
    super(game, '反馈问题', parent);
    // the world stands still while the report is written, in single player (players' feedback 2026-10-31)
    this.pauses = game.state === 'play' && !game.net;
    this.kind = 0; this.text = ''; this.withShot = !!shot; this.shot = shot || null; this.shotName = ''; this.sending = false; this.done = false;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, compact = u.h < 300;
    const y = compact ? 32 : Math.max(46, Math.floor(u.h / 2) - 80);
    const fw = Math.min(300, u.w - 20), fx = Math.round(cx - fw / 2);
    this.addField('text', fx, y + 32, fw, '描述（最多 500 字）', 500);
    const shotY = y + 64, half = Math.floor((fw - 6) / 2);
    const by = compact ? u.h - 28 : y + 126;
    this.widgets = this.done ? [
      { x: cx - 100, y: u.h - 52, w: 200, h: 20, label: '查看我的反馈', onClick: () => this.game.ui.open(new MyFeedbackScreen(this.game, this.parent)) },
      { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.back() },
      { text: this.note, x: cx, y: u.h - 72, color: this.noteColor },
    ] : [
      { x: fx, y, w: fw, h: 20, label: () => '类型：' + FEEDBACK_KINDS[this.kind][1], onClick: () => { this.kind = (this.kind + 1) % FEEDBACK_KINDS.length; } },
      { x: fx, y: shotY, w: half, h: 20, label: () => '附带截图：' + (this.withShot ? '是' : '否'), enabled: !!this.shot, tip: this.shot ? [this.shotName || '打开这个界面之前的游戏画面'] : ['没有自动截图；可以点右边选择一张图片'], onClick: () => { this.withShot = !this.withShot; } },
      { x: fx + half + 6, y: shotY, w: half, h: 20, label: () => this.shot ? '换一张截图…' : '选择截图…', tip: ['从手机相册或电脑里选图片；会自动压缩后随反馈上传'], onClick: () => this.pickShot() },
      { x: fx, y: by, w: half, h: 20, label: () => this.sending ? '发送中…' : '发送', enabled: !this.sending, onClick: () => this.submit() },
      { x: fx + half + 6, y: by, w: half, h: 20, label: '取消', onClick: () => this.back() },
    ];
    // 手机上不要自动弹键盘：键盘会盖住发送按钮；点输入框再弹出
    if (!this.done && !(typeof TouchDevice !== 'undefined' && TouchDevice.kind === 'phone')) this.focus('text');
  }
  // 手机相册 / 电脑文件选择：把图片压到后端能收下的大小，避免“上传截图没反应”
  pickShot() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const im = new Image();
        im.onload = () => {
          try {
            const k = Math.min(1, 720 / Math.max(1, im.width)), w = Math.max(1, Math.round(im.width * k)), h = Math.max(1, Math.round(im.height * k));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(im, 0, 0, w, h);
            let q = 0.72, url = c.toDataURL('image/jpeg', q);
            while (url.length > 690000 && q > 0.32) { q -= 0.08; url = c.toDataURL('image/jpeg', q); }
            if (url.length > 690000) { this.note = '这张图片太大，换一张小一点的'; this.noteColor = '#FF5555'; this.layout(); return; }
            this.shot = url; this.shotName = f.name || '自选截图'; this.withShot = true; this.note = ''; this.layout();
          } catch (e) { this.note = '读取图片失败，换一张试试'; this.noteColor = '#FF5555'; this.layout(); }
        };
        im.onerror = () => { this.note = '这张图片打不开，换一张试试'; this.noteColor = '#FF5555'; this.layout(); };
        im.src = String(rd.result || '');
      };
      rd.readAsDataURL(f);
    };
    inp.click();
  }
  drawExtra(ui) {
    if (this.done) return;
    this.drawFields(ui);
    if (ui.h < 260) return; // 手机小屏：不叠说明文字，把发送按钮留在安全区
    const y = Math.max(46, Math.floor(ui.h / 2) - 80);
    Font.center(ui.ctx, '会一起发送：游戏版本、设备和显卡、最近几分钟的帧率、', ui.w / 2, y + 90, '#A0A0A0');
    Font.center(ui.ctx, '单机还是房间、最近的报错', ui.w / 2, y + 100, '#A0A0A0');
    Font.center(ui.ctx, '不会发送你的名字、聊天记录或存档', ui.w / 2, y + 110, '#A0A0A0');
  }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  onEsc() { this.back(); }
  async submit() {
    const g = this.game, text = String(this.text || '').trim();
    if (text.length < 2) { this.note = '请先写几句描述'; this.noteColor = '#FF5555'; return; }
    this.sending = true; this.note = ''; g.ui.hideInput();
    const err = await postFeedback(g, FEEDBACK_KINDS[this.kind][0], text, this.withShot ? this.shot : null);
    this.sending = false; this.done = true;
    this.note = err ? '发送失败：' + err : '已发送，谢谢你的反馈！';
    this.noteColor = err ? '#FF5555' : '#55FF55';
    if (!err) this.text = '';
    this.layout();
  }
}
// the game's picture right now, made smaller (a JPEG of at most 720 pixels across), for a feedback
function feedbackShot(g) {
  try {
    // (drawn again now without the menu over it: the canvas keeps no picture between frames)
    if (g.state === 'play') { const sc = g.ui.screen; g.ui.screen = null; try { g.render(g.lastA || 0, performance.now()); } finally { g.ui.screen = sc; } }
    const c = g.renderer.canvas, k = Math.min(1, 720 / Math.max(1, c.width)), o = document.createElement('canvas');
    o.width = Math.max(1, Math.round(c.width * k)); o.height = Math.max(1, Math.round(c.height * k));
    o.getContext('2d').drawImage(c, 0, 0, o.width, o.height);
    // 后端单字段上限 700000 字符：先试 0.7，太大就逐档降质量，保证真的能传上去
    let q = 0.7, url = o.toDataURL('image/jpeg', q);
    while (url.length > 680000 && q > 0.3) { q -= 0.08; url = o.toDataURL('image/jpeg', q); }
    return url.length > 30 && url.length < 690000 ? url : null;
  } catch (e) { return null; }
}

// ---- 我的反馈：提交过的反馈现在是什么状态、有没有人回复 ----
const FB_STATUS = { new: ['未处理', '#A0A0A0'], doing: ['处理中', '#FFFF55'], done: ['已处理', '#55FF55'], replied: ['已回复', '#55FFFF'] };
function fbKindName(k) { const f = FEEDBACK_KINDS.find(x => x[0] === k); return f ? f[1] : '其他'; }
function fbTime(at) {
  const d = new Date(at || 0), p = n => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 按实际像素宽度折行（汉字 9 px、西文 6 px，以 Font.charW 为准），最后一行加省略号
function fbWrap(s, maxW, maxLines) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  const lines = []; let cur = '', w = 0;
  for (const c of s) {
    const cw = Font.charW(c);
    if (w + cw > maxW) {
      if (lines.length >= maxLines - 1) {
        while (cur.length && w + Font.charW('\u2026') > maxW) { w -= Font.charW(cur[cur.length - 1]); cur = cur.slice(0, -1); }
        lines.push(cur + '\u2026');
        return lines;
      }
      lines.push(cur); cur = ''; w = 0;
    }
    cur += c; w += cw;
  }
  if (cur) lines.push(cur);
  return lines;
}
class MyFeedbackScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '我的反馈');
    this.parent = parent; this.pauses = game.state === 'play' && !game.net;
    this.items = null; this.err = ''; this.page = 0; this.per = 4;
    this.layout(); // 先放一个可用的返回按钮，接口回来后再按条数重排
    this.load();
  }
  async load() {
    try {
      const j = await Account.api('/api/feedback', { action: 'mine', dev: Telemetry.install() });
      this.items = j && Array.isArray(j.items) ? j.items : [];
    } catch (e) { this.items = null; this.err = (e && e.message) || '连不上服务器'; }
    this.layout();
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, by = u.h - 44;
    this.per = Math.max(2, Math.floor((u.h - 120) / 56));
    const btns = [{ x: cx - 55, y: by, w: 110, h: 20, label: '返回', onClick: () => this.game.ui.open(this.parent) }];
    if (this.items && this.items.length > this.per) {
      const pages = Math.ceil(this.items.length / this.per);
      if (this.page > 0) btns.push({ x: cx - 225, y: by, w: 100, h: 20, label: '上一页', onClick: () => { this.page--; this.layout(); } });
      if (this.page < pages - 1) btns.push({ x: cx + 125, y: by, w: 100, h: 20, label: '下一页', onClick: () => { this.page++; this.layout(); } });
    }
    this.widgets = btns;
  }
  drawExtra(ui) {
    const cx = ui.w / 2, W = Math.min(420, ui.w - 32), x0 = Math.round((ui.w - W) / 2);
    if (this.err) {
      const noLogin = this.err.indexOf('登录') >= 0;
      Font.center(ui.ctx, noLogin ? '登录账号后才能查看自己提交的反馈' : '读取失败：' + this.err, cx, 90, noLogin ? '#FFFF55' : '#FF5555');
      if (noLogin) Font.center(ui.ctx, '登录入口在标题界面和暂停菜单的账号页', cx, 104, '#A0A0A0');
      return;
    }
    if (!this.items) { Font.center(ui.ctx, '读取中…', cx, 90, '#A0A0A0'); return; }
    if (!this.items.length) {
      Font.center(ui.ctx, '还没有提交过反馈', cx, 90, '#A0A0A0');
      Font.center(ui.ctx, '标题界面、暂停菜单和遥测数据页都能提交', cx, 104, '#808080');
      return;
    }
    let y = 46;
    for (const it of this.items.slice(this.page * this.per, this.page * this.per + this.per)) y = this.drawItem(ui, it, x0, y, W);
    const pages = Math.max(1, Math.ceil(this.items.length / this.per));
    Font.center(ui.ctx, `第 ${this.page + 1} / ${pages} 页，共 ${this.items.length} 条`, cx, ui.h - 60, '#808080');
  }
  drawItem(ui, it, x0, y, W) {
    const ctx = ui.ctx, st = FB_STATUS[it.status] || FB_STATUS.new, kind = fbKindName(it.kind);
    Font.draw(ctx, kind, x0, y, '#E0E0E0');
    Font.draw(ctx, st[0], x0 + Font.width(kind) + 12, y, st[1]);
    const time = fbTime(it.at);
    Font.draw(ctx, time, x0 + W - Font.width(time), y, '#808080');
    y += 12;
    for (const line of fbWrap(it.text, W, 2)) { Font.draw(ctx, line, x0, y, '#FFFFFF'); y += 11; }
    if (it.reply) {
      Font.draw(ctx, '回复：', x0, y, '#55FFFF');
      Font.draw(ctx, fbWrap(it.reply, W - 36, 1)[0] || '', x0 + 36, y, '#A0FFFF');
      y += 11;
    } else {
      Font.draw(ctx, '等待处理', x0, y, '#606060'); y += 11;
    }
    return y + 10;
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// ---- Options -> 遥测数据: the switch, what is collected, the feedback button ----
class TelemetryScreen extends MenuScreen {
  constructor(game, parent) { super(game, '遥测数据'); this.parent = parent; this.pauses = game.state === 'play'; this.titleY = 12; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game, s = g.settings, compact = u.h < 260;
    const ty = compact ? 34 : u.h - 80;
    this.widgets = [
      { x: cx - 155, y: ty, w: 310, h: 20, label: () => '匿名统计上传（自动）：' + (s.telemetry !== false ? '开' : '关'), onClick: () => { s.telemetry = s.telemetry === false; g.saveSettings(); } },
      { x: cx - 155, y: u.h - 55, w: 100, h: 20, label: '反馈问题…', onClick: () => g.ui.open(new FeedbackScreen(g, this, null)) },
      { x: cx - 50, y: u.h - 55, w: 100, h: 20, label: '我的反馈…', onClick: () => g.ui.open(new MyFeedbackScreen(g, this)) },
      { x: cx + 55, y: u.h - 55, w: 100, h: 20, label: '完成', onClick: () => g.ui.open(this.parent) },
    ];
  }
  drawExtra(ui) {
    if (ui.h < 260) {
      Font.center(ui.ctx, '匿名统计每 5 分钟自动上传一次，不含名字、聊天和存档', ui.w / 2, 62, '#A0A0A0');
      Font.center(ui.ctx, '关掉后不再上传；反馈截图走单独的反馈接口', ui.w / 2, 74, '#A0A0A0');
      return;
    }
    const lines = ['为了让游戏更流畅、少出错，游戏会把匿名的统计数据发到我们的服务器：', '',
      '• 设备：显卡型号、处理器线程数、内存档位、屏幕和刷新率、浏览器和系统', '• 性能：每分钟的帧率和卡顿、内存、实体和区块数量、画质设置',
      '• 出错：报错信息（只有出错的代码位置）', '• 使用：打开过哪些界面、用过哪些命令（只有名字）、联机延迟和掉线', '',
      '不收集：你的名字、聊天内容、存档、IP 地址（服务器只保存打乱后的编号）。', '数据只用来改进游戏和写研究报告，原始数据保存 180 天。'];
    lines.forEach((t, i) => Font.draw(ui.ctx, t, Math.round(ui.w / 2 - 155), 34 + i * 11, t.startsWith('不收集') ? '#FFFF55' : '#E0E0E0'));
  }
  onEsc() { this.game.ui.open(this.parent); }
}
