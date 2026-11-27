'use strict';
// ---------------------------------------------------------------------------
// Background music scheduler (framework only).
//
// The original Toy package had its music and music discs stripped out
// (see the note at the top of audio.js), so there is no built-in playlist.
// This module wires a music gain node into the existing WebAudio master chain
// and rotates tracks per scene (menu / overworld / nether / the end). It plays
// nothing until real audio files are dropped in:
//
//   sounds/music/manifest.json   - track list, grouped by scene, e.g.
//     {
//       "_comment": "Put m4a/ogg/mp3 files under sounds/music/ and list them here. Items may be a plain path or {file,name,volume,pitch}.",
//       "menu":       ["menu/menu1.m4a"],
//       "overworld":  ["game/calm1.m4a", "game/calm2.ogg"],
//       "nether":     ["nether/nether1.m4a"],
//       "end":        ["end/end1.m4a"]
//     }
//
// Missing manifest, missing files or a decode failure are all silent: the
// framework simply waits and retries, it never errors out into the game loop.
// ---------------------------------------------------------------------------
const Music = {
  manifest: null,          // { group: [entry,...] } once loaded
  manifestTried: false,    // fetch attempted once; a failed fetch does not retry every frame
  buffers: new Map(),      // file -> decoded AudioBuffer
  gain: null,              // music gain -> Sound.master
  current: null,           // { src, trackGain, group, file, live, stopped }
  group: null,
  lastFile: null,
  nextAt: 0,               // seconds (performance.now()/1000) when the next track may start
  volume: 0.5,

  FADE_IN: 2,              // seconds, ramp up on start
  FADE_OUT: 3,             // seconds, ramp down before stopping
  GAP_MIN: 180,            // idle gap after a track ends, vanilla uses a long random gap
  GAP_MAX: 360,
  RETRY_EMPTY: 10,         // re-check a scene with no usable track after this many seconds

  // ---- manifest -----------------------------------------------------------
  loadManifest() {
    if (this.manifestTried) return;
    this.manifestTried = true;
    fetch('sounds/music/manifest.json', { cache: 'force-cache' })
      .then(r => r.ok ? r.json() : null)
      .then(json => { this.manifest = (json && typeof json === 'object') ? json : null; })
      .catch(() => { this.manifest = null; });
  },

  ensureGain() {
    if (this.gain || !Sound.ctx || !Sound.master) return;
    this.gain = Sound.ctx.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(Sound.master);
  },

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.gain) this.gain.gain.value = this.volume;
  },

  groupOf(game) {
    if (!game) return 'menu';
    if (game.state === 'title' || game.state === 'boot') return 'menu';
    return game.dim || 'overworld';
  },

  tracks(group) {
    const list = this.manifest && this.manifest[group];
    return Array.isArray(list) ? list : [];
  },

  norm(entry) {
    if (typeof entry === 'string') return { file: entry, volume: 1, pitch: 1 };
    if (entry && typeof entry === 'object') return { file: entry.file, name: entry.name, volume: entry.volume ?? 1, pitch: entry.pitch ?? 1 };
    return null;
  },

  pick(group) {
    const list = this.tracks(group).map(e => this.norm(e)).filter(e => e && e.file);
    if (!list.length) return null;
    // avoid repeating the same track back-to-back when the group has more than one
    const fresh = list.filter(e => e.file !== this.lastFile);
    const pool = fresh.length ? fresh : list;
    return pool[(Math.random() * pool.length) | 0];
  },

  decode(file) {
    const hit = this.buffers.get(file);
    if (hit) return Promise.resolve(hit);
    if (!Sound.ctx) return Promise.resolve(null);
    const base = 'sounds/music/' + file.replace(/\.(m4a|ogg|mp3|wav)$/, '');
    const tryExt = (ext) => fetch(base + ext).then(r => r.ok ? r.arrayBuffer() : null);
    const decode = (ab) => ab ? new Promise(res => Sound.ctx.decodeAudioData(ab, res, () => res(null))) : Promise.resolve(null);
    const hasExt = /\.(m4a|ogg|mp3|wav)$/.test(file);
    const stem = hasExt ? file.replace(/\.(m4a|ogg|mp3|wav)$/, '') : file;
    const order = hasExt
      ? [file.slice(file.lastIndexOf('.')), ...['.m4a', '.ogg', '.mp3', '.wav'].filter(e => e !== file.slice(file.lastIndexOf('.')))]
      : ['.m4a', '.ogg', '.mp3', '.wav'];
    return order.reduce((prom, ext) => prom.then(buf => buf || tryExt(ext).then(decode)), Promise.resolve(null))
      .then(buf => { if (buf) this.buffers.set(file, buf); return buf; })
      .catch(() => null);
  },

  stopCurrent(fade) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    cur.stopped = true;
    const c = Sound.ctx;
    if (!c) { return; }
    const t = c.currentTime;
    try {
      if (fade) {
        cur.trackGain.gain.cancelScheduledValues(t);
        cur.trackGain.gain.setTargetAtTime(0, t, this.FADE_OUT / 3);
        cur.src.stop(t + this.FADE_OUT + 0.1);
      } else {
        cur.src.stop(t);
      }
    } catch (e) { }
    const g = cur.trackGain, src = cur.src;
    setTimeout(() => { try { g.disconnect(); } catch (e) { } }, (fade ? this.FADE_OUT : 0.2) * 1000);
  },

  play(group, entry) {
    const c = Sound.ctx;
    if (!c) return;
    this.stopCurrent(true);
    this.decode(entry.file).then(buf => {
      if (!buf || this.group !== group) return;   // scene changed while decoding
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = clamp(entry.pitch || 1, 0.5, 2);
      const trackGain = c.createGain();
      trackGain.gain.value = 0;
      src.connect(trackGain); trackGain.connect(this.gain);
      const vol = this.volume * (entry.volume ?? 1);
      trackGain.gain.setTargetAtTime(vol, c.currentTime, this.FADE_IN / 3);
      const cur = { src, trackGain, group, file: entry.file, live: true, stopped: false };
      src.onended = () => {
        cur.live = false;
        if (!cur.stopped) {
          // natural end: schedule the next track after a random gap
          this.lastFile = cur.file;
          // 主菜单不要像原版环境音乐那样静默几分钟，否则玩家以为音乐坏了
          const gapMin = cur.group === 'menu' ? 6 : this.GAP_MIN, gapMax = cur.group === 'menu' ? 18 : this.GAP_MAX;
          this.nextAt = performance.now() / 1000 + gapMin + Math.random() * (gapMax - gapMin);
        }
      };
      this.current = cur;
      src.start();
    });
  },

  update(game) {
    if (!Sound.ctx || Sound.idle) return;
    this.ensureGain();
    if (!this.gain) return;

    const group = this.groupOf(game);
    if (group !== this.group) {
      this.group = group;
      this.stopCurrent(true);
      this.nextAt = 0;            // a scene change picks a fresh track right away
    }

    // 主菜单按用户要求完全静默：标题/启动界面不播放任何背景音乐，进入世界后才按场景取曲。
    if (this.group === 'menu') { this.stopCurrent(true); this.nextAt = Infinity; return; }

    if (this.current && this.current.live) return;

    const now = performance.now() / 1000;
    if (now < this.nextAt) return;

    const entry = this.pick(this.group);
    if (!entry) { this.nextAt = now + this.RETRY_EMPTY; return; }
    this.play(this.group, entry);
  },
};
