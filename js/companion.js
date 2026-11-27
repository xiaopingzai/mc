'use strict';
// ---------------------------------------------------------------------------
// The AI companion (the user, 2026-11-01: a friendly companion like the Verity mod's, on DeepSeek). Everyone talks on
// the service's one DeepSeek key (the user, 2026-11-05: "统一使用我的"), kept sealed by the room service
// (multiplayer/rooms/ai.js) - never in this page: every Toy runs on www.bilibilitoy.com, another Toy's page could read
// our storage; the service also makes the prompt and keeps the talk and the limits. Talking: V (or 游戏菜单 → 伙伴); what is going on in
// the game goes along with each line, so the answers fit; now and then (an advancement, a death, a new dimension) it
// says something by itself. What it remembers of the player is a short note the service keeps with the account.
// Unlocked by following the UP and 三连 on the game's video (Toy.VIDEOS; the user, 2026-11-07 - the service itself only
// asks for following); the first time, it comes to the player in the world by itself and says hello (greet).
// ---------------------------------------------------------------------------
// the kaomoji it may use (ai.js gives the model the same list): every character of these is in the game's font
// (tools/build_font.py takes the characters of the game's own text)
const JING_KAOMOJI = ['(≧▽≦)', '(｡･ω･｡)', '(◕‿◕)', '(￣▽￣)', 'ヾ(≧▽≦*)o', '(＞﹏＜)', '(´・ω・`)', '(｀・ω・´)', '(╥﹏╥)', 'Σ(っ°Д°;)っ', '(✿◠‿◠)', '♪(´▽｀)', '(*/ω＼*)', '(⊙_⊙)', '(・∀・)', '(￣ω￣)'];
// the whole companion off in this page (2026-11-02: taken down for one update, the super administrators too). Back on
// for the 11-06 launch (the user, 11-03): who sees it is the service's again - ai.enabled / ai.from in config.js
const COMPANION_OFF = false;
const Companion = {
  status: null, history: [], busy: false, sinceRemember: 0, lastEvent: 0, events: 0, watch: null,
  get name() { return (this.status && this.status.name) || '伙伴'; },
  // (the service's shared key - status.shared, with status.freeLeft lines left today; status.key: one's own, off now)
  get ready() { return !COMPANION_OFF && !!(this.status && this.status.on && this.unlocked && (this.status.key || this.status.shared)); },
  // the service's unlock (following) and the 三连 the game asks for too (Account.has('jing'))
  get unlocked() { return !!(this.status && this.status.unlocked) && Account.has('jing'); },
  // (whether it shows at all: the service says - not released to everyone yet)
  get shown() { return !COMPANION_OFF && !!(this.status && this.status.on); },
  async load() {
    if (COMPANION_OFF || !Account.loggedIn) { this.status = null; return null; }
    try { this.status = await Account.api('/api/ai/status', {}); } catch (e) { }
    return this.status;
  },
  // ---- what is going on (plain words for the model) ----
  context(g) {
    const p = g.player, o = {};
    if (g.state !== 'play' || !p || !g.world) return { 场景: '在游戏主菜单' };
    const x = Math.floor(p.pos[0]), y = Math.floor(p.pos[1] + (g.world.minY || 0)), z = Math.floor(p.pos[2]);
    o['游戏'] = g.net && g.net.room ? `联机房间（${(g.net.players && g.net.players.size) || '几'} 人）` : '单人游戏';
    o['模式'] = (typeof MODE_NAMES !== 'undefined' && MODE_NAMES[g.mode]) || g.mode;
    o['维度'] = (typeof DIM_CN !== 'undefined' && DIM_CN[g.dim]) || g.dim || '主世界';
    o['坐标'] = `${x}, ${y}, ${z}`;
    try { o['生物群系'] = biomeName(g, x, z); } catch (e) { }
    const t = g.dayTime(), hh = Math.floor((t / 1000 + 6) % 24);
    o['时间'] = `第 ${Math.floor(g.worldTime / 24000) + 1} 天 ${String(hh).padStart(2, '0')}:${String(Math.floor((t % 1000) * 0.06)).padStart(2, '0')}${t > 12500 && t < 23500 ? '（夜晚）' : ''}`;
    if (g.dim === 'overworld' || !g.dim) o['天气'] = g.weather > 0.5 ? '下雨' : '晴';
    if (g.mode === 'survival') { o['生命值'] = `${Math.ceil(p.health)}/${p.maxHealth}`; o['饥饿值'] = `${p.food}/20`; }
    const nm = (s) => (s && ITEMS[s.id] ? ITEMS[s.id].cn : '');
    const held = p.inv && p.inv.held;
    o['手上'] = held ? `${nm(held)}${held.count > 1 ? ' ×' + held.count : ''}` : '空手';
    if (p.inv) {
      const cnt = new Map();
      for (let i = 0; i < 36; i++) { const s = p.inv.slots[i]; if (s) cnt.set(nm(s), (cnt.get(nm(s)) || 0) + s.count); }
      o['背包'] = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([n, c]) => `${n}×${c}`);
      const arm = [36, 37, 38, 39].map((i) => nm(p.inv.slots[i])).filter(Boolean);
      if (arm.length) o['盔甲'] = arm;
    }
    const near = new Map();
    for (const e of g.entities || []) {
      if (!e.T || !e.T.cn || e.dead || !e.pos) continue;
      if (Math.hypot(e.pos[0] - p.pos[0], e.pos[1] - p.pos[1], e.pos[2] - p.pos[2]) > 24) continue;
      near.set(e.T.cn, (near.get(e.T.cn) || 0) + 1);
    }
    if (near.size) o['附近的生物'] = [...near].slice(0, 12).map(([n, c]) => (c > 1 ? `${n}×${c}` : n));
    if (g.adv) o['已完成进度'] = Object.keys(g.adv).length + ' 个';
    // the settings it can change for the player (ai.js SETTINGS), as they are now
    const st = g.settings, pc = (v) => Math.round(v * 100) + '%', oo = (v) => (v ? '开' : '关');
    o['当前设置'] = `光影 ${FX_NAMES[st.shaders || 0]}，画质预设 ${PRESET_NAMES[st.preset] || '自定义'}，图形品质 ${st.graphics === 'fast' ? '流畅' : '高品质'}，渲染距离 ${st.renderDist}，亮度 ${pc(st.gamma)}，视场角 ${Math.round(st.fov)}，主音量 ${pc(st.volume)}，鼠标灵敏度 ${Math.round(st.sens * 200)}%，渲染分辨率 ${pc(st.resScale)}，最大帧率 ${st.maxFps || '无限制'}，字幕 ${oo(st.subtitles)}，视角摇晃 ${oo(st.bobbing)}，云 ${oo(st.clouds)}，自动跳跃 ${oo(st.autoJump)}，动态分辨率 ${oo(st.dynRes)}`;
    o['设备'] = typeof touchOn === 'function' && touchOn(g) ? '手机 / 平板（触屏）' : '电脑';
    const said = (g.ui.chat || []).filter((m) => !m.ai && m.text).slice(-4).map((m) => m.text);
    if (said.length) o['聊天栏最近几行'] = said;
    return o;
  },
  // ---- talking ----
  show(g, who, text, color) {
    // (the chat box doesn't wrap: one line each up to its width)
    const lines = [], max = 312;
    let cur = who;
    for (const ch of String(text)) { if (Font.width(cur + ch) > max) { lines.push(cur); cur = '  '; } cur += ch; }
    lines.push(cur);
    for (const l of lines) { g.ui.message(l, color); g.ui.chat[g.ui.chat.length - 1].ai = true; }
  },
  // quick mode (the user, 2026-11-01): what the player writes in the chat is said to it too - every line alone in a
  // world, in a room only a line with its name in it (the friends' talk would use up the player's lines of the day)
  quick(g, text) {
    if (!this.ready || g.settings.aiQuick === false) return false;
    return text === undefined || !(g.net && g.net.room) || String(text).includes(this.name);
  },
  // quiet: a reaction of its own (to a command) - a refusal (too fast, no money) isn't shown
  async say(g, text, echo = true, quiet = false) {
    if (this.busy) return;
    if (!this.status) await this.load();
    if (!this.ready) { g.ui.open(new CompanionScreen(g, null)); return; }
    this.busy = true; Jing.call(1500);
    if (echo) this.show(g, '[对' + this.name + '说] ', text, '#AAAAAA');
    try {
      const r = await Account.api('/api/ai/chat', { said: text, history: this.history.slice(-10), ctx: this.context(g) });
      this.history.push({ r: 'u', t: text }, { r: 'a', t: r.reply });
      this.history = this.history.slice(-24);
      this.show(g, '<' + this.name + '> ', r.reply, '#7FE3FF'); Jing.pulse = performance.now(); Jing.call(Math.min(20000, Math.max(6000, 4000 + r.reply.length * 120)));
      if (r.actions && r.actions.length) this.applyActions(g, r.actions);
      if (r.freeLeft !== undefined && this.status) this.status.freeLeft = r.freeLeft;
      Telemetry.count && Telemetry.count('ai_chat');
      if (++this.sinceRemember >= 8) this.remember();
    } catch (e) { if (!quiet) this.show(g, '<' + this.name + '> ', e.message, '#FF8080'); }
    finally { this.busy = false; }
  },
  // settings it changes for the player once they said yes (ai.js takeActions): only these, in their ranges
  applyActions(g, acts) {
    const s = g.settings, done = [], cmds = [];
    const fb = acts.find((a) => a && a.k === 'feedback' && a.v && typeof a.v.text === 'string');
    if (fb) this.feedback(g, fb.v);
    const ok = { shaders: (v) => [0, 1, 2, 3, 4].includes(v), preset: (v) => ['auto', 'low', 'medium', 'high', 'ultra'].includes(v), graphics: (v) => v === 'fast' || v === 'fancy',
      renderDist: (v) => v >= 2 && v <= 16, gamma: (v) => v >= 0 && v <= 1, fov: (v) => v >= 30 && v <= 110, volume: (v) => v >= 0 && v <= 1, sens: (v) => v > 0 && v <= 1,
      resScale: (v) => [0.5, 0.75, 1].includes(v), maxFps: (v) => v === 0 || (v >= 10 && v <= 250), subtitles: (v) => typeof v === 'boolean', bobbing: (v) => typeof v === 'boolean',
      clouds: (v) => typeof v === 'boolean', autoJump: (v) => typeof v === 'boolean', dynRes: (v) => typeof v === 'boolean' };
    for (const a of acts) {
      if (a && a.k === 'cmd' && typeof a.v === 'string' && /^\/[^\n]{1,200}$/.test(a.v)) { cmds.push(a.v); continue; }
      if (!a || !ok[a.k] || !ok[a.k](a.v)) continue;
      if (a.k === 'shaders' && !(g.renderer.fx && g.renderer.fx.ok)) { this.show(g, '<' + this.name + '> ', '诶，你的设备好像不支持光影…', '#FF8080'); continue; }
      if (a.k === 'preset') applyPreset(g, a.v);
      else { if (['graphics', 'renderDist', 'resScale', 'clouds', 'dynRes'].includes(a.k)) s.preset = 'custom'; s[a.k] = a.v; if (a.k === 'graphics') g.graphicsChanged(); }
      done.push(a.name + '：' + a.label);
    }
    // a command typed for the player (they said yes): run as if typed, without a reaction to it
    for (const cmd of cmds) { g.ui.message('[' + this.name + '帮你输入了] ' + cmd, '#FFFF55'); g.ui.chat[g.ui.chat.length - 1].ai = true; (this.runRaw || runCommand)(g, cmd); Telemetry.count && Telemetry.count('ai_cmd'); }
    if (!done.length) return;
    g.applySettings(); g.saveSettings();
    g.ui.message('[' + this.name + '帮你调整了] ' + done.join('，'), '#FFFF55'); g.ui.chat[g.ui.chat.length - 1].ai = true;
    Telemetry.count && Telemetry.count('ai_adjust');
  },
  // a problem told to it, sent as the player's feedback (with the picture now and the game's state, like 反馈问题)
  async feedback(g, f) {
    const kind = ['bug', 'lag', 'idea', 'other'].includes(f.kind) ? f.kind : 'other', text = String(f.text).slice(0, 800);
    const err = await postFeedback(g, kind, '[' + this.name + '整理] ' + text, typeof feedbackShot === 'function' ? feedbackShot(g) : null);
    g.ui.message(err ? '[' + this.name + '没能帮你反馈] ' + err : '[' + this.name + '帮你反馈了] 作者会看到的，谢谢你！', err ? '#FF5555' : '#55FF55');
    g.ui.chat[g.ui.chat.length - 1].ai = true;
    Telemetry.count && Telemetry.count(err ? 'ai_feedback_fail' : 'ai_feedback');
  },
  // something just happened: a line of its own, now and then (the player's lines: at most every 2 minutes, 10 a visit)
  async event(g, what) {
    const s = g.settings;
    if (!this.ready || this.busy || s.aiTalk === false || g.state !== 'play') return;
    const now = Date.now();
    if (now - this.lastEvent < 120e3 || this.events >= 10) return;
    this.lastEvent = now; this.events++; this.busy = true;
    try {
      const r = await Account.api('/api/ai/chat', { event: what, history: this.history.slice(-6), ctx: this.context(g) });
      this.history.push({ r: 'a', t: r.reply }); this.history = this.history.slice(-24);
      this.show(g, '<' + this.name + '> ', r.reply, '#7FE3FF'); Jing.pulse = performance.now(); Jing.call(Math.min(20000, Math.max(6000, 4000 + r.reply.length * 120)));
      Telemetry.count && Telemetry.count('ai_event');
    } catch (e) { } finally { this.busy = false; }
  },
  async remember() {
    this.sinceRemember = 0;
    try { this.status = await Account.api('/api/ai/remember', { history: this.history.slice(-20) }); } catch (e) { }
  },
  // ---- the first time it is unlocked (each account, on this device): called in front of the player in the world, with
  // a hello of its own - not the model's, no line of the day used (the user, 2026-11-07: "通过后首次进入界面就会召唤鲸鲸")
  hiDone: null, hiWait: 0,
  greeted() {
    const id = Account.data && Account.data.id; if (!id) return true;
    if (!this.hiDone) { try { this.hiDone = new Set(JSON.parse(localStorage.getItem('mcjs-jing-hi') || '[]')); } catch (e) { this.hiDone = new Set(); } }
    return this.hiDone.has(id);
  },
  greet(g) {
    const id = Account.data && Account.data.id; if (!id) return;
    this.greeted(); this.hiDone.add(id);
    try { localStorage.setItem('mcjs-jing-hi', JSON.stringify([...this.hiDone].slice(-20))); } catch (e) { }
    const how = typeof touchOn === 'function' && touchOn(g) ? (g.net && g.net.room ? `在聊天里叫一声「${this.name}」我就会回你` : '点开聊天直接跟我说话就行') : '按 V 就能和我聊天';
    this.show(g, '<' + this.name + '> ', `你好呀～我是${this.name}！以后我就陪着你啦 (≧▽≦) ${how}，游戏里有什么不会的都可以问我哦～`, '#7FE3FF');
    Jing.pulse = performance.now(); Jing.call(10000);
    Sound.ev && Sound.ev('entity.experience_orb.pickup', null, 0.35, 1.3);
    Telemetry.count && Telemetry.count('jing_hi');
  },
  // the game watched once a second: advancements, death, another dimension
  start(g) {
    if (this.watch) return;
    let adv = null, dim = null, dead = false, world = null;
    this.watch = setInterval(() => {
      // (the hello: two seconds into the world with nothing open, once it is unlocked)
      if (g.state === 'play' && g.player && !g.player.dead && !g.ui.screen && this.ready && !this.greeted()) { if (++this.hiWait >= 2) { this.hiWait = 0; this.greet(g); } }
      else this.hiWait = 0;
      if (g.state !== 'play' || !g.player) { adv = null; dim = null; world = null; return; }
      if (world !== g.world) { world = g.world; adv = new Set(Object.keys(g.adv || {})); dim = g.dim; dead = false; return; }
      const now = new Set(Object.keys(g.adv || {}));
      for (const k of now) if (!adv.has(k) && typeof ADVANCEMENTS !== 'undefined' && ADVANCEMENTS[k]) { this.event(g, `玩家取得了进度「${ADVANCEMENTS[k].title}」`); break; }
      adv = now;
      if (g.dim !== dim) { if (dim) this.event(g, `玩家进入了${(typeof DIM_CN !== 'undefined' && DIM_CN[g.dim]) || g.dim}`); dim = g.dim; }
      const d = !!g.player.dead;
      if (d && !dead) this.event(g, String(g.deathMsg || '玩家死了').replace(/^玩家/, '玩家刚刚'));
      dead = d;
    }, 1000);
  },
};

// a text in lines at most w wide
function wrapText(text, w) { const out = []; let line = ''; for (const ch of String(text)) { if (Font.width(line + ch) > w) { out.push(line); line = ''; } line += ch; } if (line) out.push(line); return out; }

// ---- talking to it: a line at the bottom like the chat's (the chat box shows the talk) ----
class CompanionChatScreen extends MenuScreen {
  constructor(game) { super(game, null); this.blurBg = false; this.bgDim = 0; this.isChat = true; game.ui.chatOff = 0; }
  wheel(ui, dy) { ui.chatOff = clamp((ui.chatOff || 0) - Math.sign(dy) * 7, 0, Math.max(0, ui.chat.length - 20)); }
  layout() {
    const u = this.game.ui, lw = Font.width('对' + Companion.name + '说：') + 6;
    u.showInput(2 + lw, u.h - 14, u.w - 4 - lw, 12, '', (v) => { u.close(); v = v.trim(); if (v) Companion.say(this.game, v); }, { onEsc: () => u.close(), max: 200 });
  }
  draw(ui) {
    const c = ui.ctx, t = '对' + Companion.name + '说：';
    c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(2, ui.h - 14, ui.w - 4, 12);
    Font.draw(c, t, 4, ui.h - 12, '#7FE3FF');
    if (Companion.busy) Font.draw(c, Companion.name + '正在想…', 4, ui.h - 26, '#AAAAAA');
  }
}

// ---- 选项 → 账号 → AI 伙伴: the unlock, the lines left today, what it remembers ----
class CompanionScreen extends FormScreen {
  constructor(game, parent) {
    super(game, 'AI 伙伴', parent);
    Promise.all([Companion.load(), Account.loadGate()]).then(() => { if (this.game.ui.screen === this) this.layout(); });
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game, st = Companion.status;
    this.fields = {}; this.widgets = [];
    const back = { x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.back() };
    if (!Account.loggedIn) { this.widgets.push({ x: cx - 100, y: 70, w: 200, h: 24, gold: true, label: '登录', onClick: () => g.ui.open(new LoginScreen(g, () => g.ui.open(new CompanionScreen(g, this.parent)))) }, back); return; }
    if (!st) { this.widgets.push(back); return; }
    if (!Companion.unlocked) {
      // (both asked for: following the UP and 三连 on the game's video; each opens the app's own page)
      const f = !!Account.unlocks.follow, t = Account.tripleOk();
      this.widgets.push(
        { x: cx - 100, y: 76, w: 98, h: 22, gold: !f, label: f ? '✓ 已关注' : '去关注', enabled: !f, tip: ['打开 UP 主的空间，关注后回来'], onClick: () => this.unlock('follow') },
        { x: cx + 2, y: 76, w: 98, h: 22, gold: !t, label: t ? '✓ 已三连' : '去三连', enabled: !t, tip: ['打开新视频，点赞、投币、收藏后回来'], onClick: () => this.unlock('triple') },
        { x: cx - 100, y: 102, w: 200, h: 20, label: () => (Account.checking ? '正在检查…' : '我完成了，检查'), enabled: !Account.checking, onClick: () => this.recheck() },
        back);
      return;
    }
    const s = g.settings;
    this.widgets.push(
      { x: cx - 150, y: 94, w: 98, h: 20, label: () => '主动说话：' + (s.aiTalk === false ? '关' : '开'), tip: ['完成进度、死亡、进入新维度时', Companion.name + '会说一句（每 2 分钟最多一次）'], onClick: () => { s.aiTalk = s.aiTalk === false; g.saveSettings(); } },
      { x: cx - 49, y: 94, w: 98, h: 20, label: () => '快速模式：' + (s.aiQuick === false ? '关' : '开'), tip: ['开着时，在聊天框里说的话' + Companion.name + '都会回', '（联机房间里要提到「' + Companion.name + '」）；关掉就只有按 V 才回'], onClick: () => { s.aiQuick = s.aiQuick === false; g.saveSettings(); } },
      { x: cx + 52, y: 94, w: 98, h: 20, label: '忘掉记忆', enabled: !!st.memory, tip: st.memory ? [Companion.name + '记得：', ...wrapText(st.memory, 220), '', '点一下清空这些记忆'] : ['还没有记住什么'], onClick: () => this.forget() },
      // (no 改名字 any more - the user, 2026-11-05: 鲸鲸 is always 鲸鲸)
      { x: st.admin ? cx - 150 : cx - 74, y: 118, w: 148, h: 20, label: () => '显示' + Companion.name + '：' + (s.aiShow === false ? '关' : '开'), tip: ['在你身边飘着的小球（只有你自己看得到）'], onClick: () => { s.aiShow = s.aiShow === false; g.saveSettings(); } },
      ...(st.admin ? [{ x: cx + 2, y: 118, w: 148, h: 20, gold: true, label: '共用密钥…', tip: ['管理员：全服玩家聊天用的密钥', '今天已花 ' + st.admin.yuan + ' 元 / 上限 ' + st.admin.budget + ' 元（' + st.admin.lines + ' 句）'], onClick: () => { g.ui.hideInput(); g.ui.open(new CompanionSharedScreen(g, this)); } }] : []),
      { x: cx - 150, y: u.h - 30, w: 148, h: 20, gold: Companion.ready, label: fitText('和' + Companion.name + '聊天', 140), enabled: Companion.ready && g.state === 'play', tip: g.state === 'play' ? ['也可以在游戏里按 V'] : ['进入世界后按 V 和' + Companion.name + '聊天'], onClick: () => { g.ui.hideInput(); g.ui.open(new CompanionChatScreen(g)); } },
      { x: cx + 2, y: u.h - 30, w: 148, h: 20, label: '完成', onClick: () => this.back() },
    );
  }
  async unlock(kind) {
    try {
      if (!(await Toy.ready())) { this.say('请在 B站 App 或电脑网页的游戏页面里操作', true); return; }
      if (kind === 'triple') await Toy.openVideo(Toy.VIDEOS[0]); else await Toy.openAuthor();
      this.say(Toy.backHint(kind));
      this.waiting = true;
    } catch (e) { this.say(e instanceof ToyError ? Toy.explain(e) : e.message, true); }
  }
  // back from the video / the UP's page (or 我完成了，检查): checked again
  async recheck() {
    this.waiting = false;
    if (!(await Toy.ready())) { this.say('请在 B站 App 或电脑网页的游戏页面里检查', true); return; }
    this.layout();
    let r = null; try { r = await Account.checkUnlocks(); } catch (e) { this.say(e.message, true); }
    await Companion.load();
    if (Companion.unlocked) this.say('已解锁' + Companion.name + '！' + (this.game.state === 'play' ? '回到游戏，它马上就来' : '进入世界后它就会来找你'));
    else if (r && r.inToy && r.error && r.follow === null && r.triple === null) this.say('没查到（' + Toy.explain(r.error) + '），过一会儿再点检查', true);
    else if (r && r.inToy && !r.own) this.say('这里没登录你自己的 B站：用你的 B站 关注、三连后，在那台设备打开一次游戏就会同步', true);
    else if (r && r.triple === null && !Account.tripleOk()) this.say('没查到三连状态（' + (r.error ? Toy.explain(r.error) : 'B站没有返回能看懂的数据') + '），过一会儿再点检查', true);
    else {
      const t = Account.tripleParts, miss = [];
      if (!Account.unlocks.follow) miss.push('关注');
      if (!Account.tripleOk()) { if (t && !t.all) { if (!t.like) miss.push('点赞'); if (!t.coin) miss.push('投币'); if (!t.fav) miss.push('收藏'); } else miss.push('三连'); }
      this.say(miss.length ? '还差：' + miss.join('、') + '（刚操作完可能要等几秒）' : '还没有检测到，完成后再回来看看', true);
    }
    if (this.game.ui.screen === this) this.layout();
  }
  // (opened in the game with V: back to the game)
  back() { const g = this.game; g.ui.hideInput(); if (this.parent) g.ui.open(this.parent); else if (g.state === 'play') g.ui.close(); else g.ui.open(new TitleScreen(g)); }
  async forget() { try { Companion.status = await Account.api('/api/ai/forget', {}); this.say(Companion.name + '已经忘掉了'); } catch (e) { this.say(e.message, true); } this.layout(); }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, st = Companion.status;
    if (this.waiting && document.visibilityState === 'visible' && this.leftAt && Date.now() - this.leftAt > 1500) { this.leftAt = 0; this.recheck(); }
    if (this.waiting && document.visibilityState !== 'visible') this.leftAt = Date.now();
    if (!Account.loggedIn) { Font.center(c, '登录后才能使用 AI 伙伴', cx, 50, '#A0A0A0'); return; }
    if (!st) { Font.center(c, '正在读取…', cx, 50, '#A0A0A0'); return; }
    if (!Companion.unlocked) {
      Font.center(c, fitText(`关注 UP 主 + 给新视频三连，就能解锁${Companion.name}`, ui.w - 8), cx, 46, '#FFD24A');
      Font.center(c, fitText('三连 = 点赞 + 投币 + 收藏；之前给老视频三连过的也要再三连', ui.w - 8), cx, 60, '#A0A0A0');
      if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, 130, this.noteColor);
      return;
    }
    Font.center(c, fitText(`${Companion.name}：会聊天、懂你在游戏里做什么的 AI 小伙伴`, ui.w - 8), cx, 34, '#7FE3FF');
    if (st.shared || st.key) {
      if (st.shared) Font.center(c, fitText(`全服免费：今天还能聊 ${st.freeLeft ?? '?'} 句（每天 ${st.perDay || 30} 句，明天重新算）`, ui.w - 8), cx, 50, '#55FF55');
      Font.center(c, fitText('只聊游戏和日常；总让' + Companion.name + '写代码、翻译、做作业会被暂停一天', ui.w - 8), cx, 64, '#A0A0A0');
    } else Font.center(c, fitText(Companion.name + '暂时在休息，稍后再来找它吧', ui.w - 8), cx, 50, '#FF8080');
    this.drawFields(ui);
  }
}

// the watch starts with the game; the status is read again after logging in (Account.took)
(() => {
  const st = Game.prototype.startTitle;
  Game.prototype.startTitle = function (...a) { const r = st.apply(this, a); Companion.start(this); if (!Companion.status) Companion.load(); return r; };
  const took = Account.took;
  Account.took = function (j) { const r = took.call(this, j); if (j && j.token) Companion.load(); return r; };
  // (unlocked on the 解锁 screen: the service's half - following - read again, so it comes at once)
  const cu = Account.checkUnlocks;
  Account.checkUnlocks = async function (...a) { const r = await cu.apply(this, a); if (r && r.got && r.got.length) await Companion.load(); return r; };
})();

// ---- 共用密钥… (super administrators): the service's own DeepSeek key everyone talks on, what it spent today ----
class CompanionSharedScreen extends FormScreen {
  constructor(game, parent) { super(game, '全服共用密钥', parent); this.key = ''; this.busy = false; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, a = (Companion.status && Companion.status.admin) || {};
    this.fields = {};
    this.addField('key', cx - 150, 94, 300, a.sharedTail ? `共用密钥（已设置：sk-…${a.sharedTail}，粘贴新的可以替换）` : '共用密钥（以 sk- 开头）', 140, (v) => v.trim());
    this.widgets = [
      { x: cx - 150, y: 118, w: 148, h: 20, gold: true, label: () => (this.busy ? '正在检查…' : '设为共用密钥'), enabled: !this.busy, onClick: () => this.submit() },
      { x: cx + 2, y: 118, w: 148, h: 20, label: '停用共用密钥', enabled: !!a.sharedTail && !this.busy, tip: ['删掉共用密钥：所有玩家就都不能聊了'], onClick: () => this.remove() },
      // (the limits, changed at once - no restart: the service's ai-limits.json, the user 2026-11-07)
      { x: cx - 150, y: 142, w: 300, h: 20, gold: true, label: '调整上限…（每天 / 每小时花多少钱、每人几句，立刻生效）', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new CompanionLimitsScreen(this.game, this)); } },
      { x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.back() },
    ];
  }
  async submit() {
    if (this.busy) return;
    if (!/^sk-\S{16,}$/.test(this.key)) { this.say('DeepSeek 的密钥以 sk- 开头，请完整复制', true); return; }
    this.busy = true; this.say('正在向 DeepSeek 检查密钥…'); this.layout();
    try { const r = await Account.api('/api/ai/shared', { key: this.key }); Companion.status = r.status; this.key = ''; this.game.ui.hideInput(); this.say('已设为共用密钥' + (r.balance && r.balance.text ? '，余额 ' + r.balance.text : '')); }
    catch (e) { this.say(e.message, true); }
    this.busy = false; this.layout();
  }
  async remove() { try { Companion.status = await Account.api('/api/ai/shared/delete', {}); this.say('共用密钥已停用'); } catch (e) { this.say(e.message, true); } this.layout(); }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, a = (Companion.status && Companion.status.admin) || {};
    this.drawFields(ui);
    Font.center(c, fitText('全服玩家都用这个密钥和' + Companion.name + '聊天（费用从这个账户扣，只存在服务器上）', ui.w - 8), cx, 36, '#A0A0A0');
    Font.center(c, fitText(`今天已花 ${a.yuan ?? 0} 元 / 每天上限 ${a.budget ?? '?'} 元，共 ${a.lines ?? 0} 句；这个小时 ${a.hourYuan ?? 0} / ${a.hourBudget ?? '?'} 元`, ui.w - 8), cx, 50, '#FFD24A');
    Font.center(c, fitText(`每天：每人 ${a.perDay ?? 30} 句（每分钟 ${a.perMinute ?? 4} 句）、每个地址 ${a.perIp ?? 60} 句、每个网段 ${a.perNet ?? 300} 句`, ui.w - 8), cx, 64, '#A0A0A0');
    if (a.stopped) Font.center(c, fitText('今天有 ' + a.stopped + ' 个账号一直让' + Companion.name + '做别的事（写代码、翻译等），免费聊天已暂停', ui.w - 8), cx, 168, '#FF8080');
  }
}

// ---- 调整上限… (super administrators): the shared key's limits - the day's and the hour's yuan, one player's lines a
// day, and a day's budget for today only (back to the usual at 00:00) - saved by the service in ai-limits.json and
// used at once, no restart (the user, 2026-11-07). An empty field: the service's own setting (config.js) ----
class CompanionLimitsScreen extends FormScreen {
  constructor(game, parent) {
    super(game, Companion.name + '的上限', parent); this.busy = false;
    const a = (Companion.status && Companion.status.admin) || {}, str = (v) => (v === undefined || v === null ? '' : String(v));
    this.day = str(a.budgetBase ?? a.budget); this.hour = str(a.hourBudget); this.per = str(a.perDay); this.today = a.boost ? str(a.boost.yuan) : '';
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, num = (v) => v.replace(/[^0-9.]/g, '').slice(0, 6), int = (v) => v.replace(/[^0-9]/g, '').slice(0, 5);
    this.fields = {};
    this.addField('day', cx - 150, 72, 96, '每天上限（元）', 6, num);
    this.addField('hour', cx - 48, 72, 96, '每小时上限（元）', 6, num);
    this.addField('per', cx + 54, 72, 96, '每人每天（句）', 5, int);
    this.addField('today', cx - 150, 114, 96, '只今天的每天上限（元）', 6, num);
    this.widgets = [
      { x: cx - 150, y: u.h - 30, w: 148, h: 20, gold: true, label: () => (this.busy ? '正在保存…' : '保存（立刻生效）'), enabled: !this.busy, onClick: () => this.save() },
      { x: cx + 2, y: u.h - 30, w: 148, h: 20, label: '完成', onClick: () => this.back() },
    ];
  }
  submit() { this.save(); }
  async save() {
    if (this.busy) return;
    const b = { freeBudgetYuan: this.day, freeBudgetHourYuan: this.hour, freePerDay: this.per, todayYuan: this.today };
    for (const k in b) b[k] = String(b[k] || '').trim();
    this.busy = true; this.layout();
    try { Companion.status = await Account.api('/api/ai/limits', b); this.say('已保存，马上生效（不用重启）'); }
    catch (e) { this.say(e.message, true); }
    this.busy = false; this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, a = (Companion.status && Companion.status.admin) || {};
    const b = a.boost;
    Font.center(c, fitText(`现在：每天 ${a.budget ?? '?'} 元${b ? `（今天临时，0 点后回到 ${a.budgetBase ?? '?'} 元）` : ''} · 每小时 ${a.hourBudget ?? '?'} 元 · 每人每天 ${a.perDay ?? '?'} 句`, ui.w - 8), cx, 34, '#FFD24A');
    Font.center(c, fitText(`今天已花 ${a.yuan ?? 0} 元，共 ${a.lines ?? 0} 句；这个小时 ${a.hourYuan ?? 0} 元`, ui.w - 8), cx, 46, '#A0A0A0');
    Font.draw(c, fitText('填了就只用到今晚 0 点；空着 = 不用', ui.w / 2 + 150 - 104), cx - 48, 120, '#A0A0A0');
    Font.center(c, fitText('空着的格子 = 用服务器原来的设置', ui.w - 8), cx, 144, '#808080');
    this.drawFields(ui);
  }
}

// ---- 鲸鲸 in the world (the user, 2026-11-01: a real sphere with the character's face, not a flat picture) ----
// A UV sphere of 32 x 16 quads: the front half shows JING_TEX's front picture, the back half its back picture, each
// projected straight on (a point's x, y on the ball is where it is in the picture; the meridians at 90 and 270
// degrees are grid lines, so no quad straddles the two). The fins, the tail, the ahoge and the headdress's frill
// stand out of the ball: flat pictures from the same atlas. Drawn with the entity shader, lit by the world.
const Jing = {
  R: 0.2, mesh: null, tail: null, pos: null, yaw: 0, last: 0, pulse: -1e9,
  TAIL_AT: [0, -0.55, -0.78], // where the tail's stem meets the ball (it swings about this)
  visible(g) { return Companion.ready && g.settings.aiShow !== false && g.state === 'play' && !!g.player && !g.player.dead && g.mode !== 'spectator'; },
  // a mesh in the entity layout (position, uv, normal; quads)
  upload(r, d) {
    const gl = r.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, r.quadIdx);
    gl.bindVertexArray(null);
    return { vao, n: d.length / 8 };
  },
  // a part picture made solid the way vanilla makes held items (ItemModelGenerator): the picture front and back,
  // and a side face along every edge between a drawn pixel and an empty one, in that pixel's colour.
  // W: its width (ball radii); anchor [ax, ay]: the point of the picture (0..1 from the bottom-left) put at the
  // origin; place(v): from the part's own space (x right, y up, z out of the picture) to the ball's
  extrude(d, mask, name, W, anchor, place, flip, thick = 0.14) {
    const S = JING_TEX.size, [rx, ry, w, h] = JING_TEX.parts[name], s = W / w, t = thick / 2;
    // (the sides on a coarser grid than the picture: about 48 cells across)
    const st = Math.max(1, Math.round(w / 48)), cw = Math.ceil(w / st), ch = Math.ceil(h / st);
    const at = (x, y) => (x < 0 || y < 0 || x >= cw || y >= ch ? 0 : mask[(ry + Math.min(h - 1, y * st + (st >> 1))) * S + rx + Math.min(w - 1, x * st + (st >> 1))] >= 128);
    // picture pixel (x from the left, y from the top) -> part space
    const P = (x, y, z) => place([((flip ? w - x : x) - anchor[0] * w) * s, (h - y - anchor[1] * h) * s, z]);
    const N = (n) => { const o = place([0, 0, 0]), q = place(n); return [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; };
    const V = (p, u, v, n) => d.push(p[0], p[1], p[2], u / S, v / S, n[0], n[1], n[2]);
    const u0 = flip ? rx + w : rx, u1 = flip ? rx : rx + w;
    let n = N([0, 0, 1]);
    V(P(0, 0, t), u0, ry, n); V(P(0, h, t), u0, ry + h, n); V(P(w, h, t), u1, ry + h, n); V(P(w, 0, t), u1, ry, n);
    n = N([0, 0, -1]);
    V(P(w, 0, -t), u1, ry, n); V(P(w, h, -t), u1, ry + h, n); V(P(0, h, -t), u0, ry + h, n); V(P(0, 0, -t), u0, ry, n);
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
      if (!at(cx, cy)) continue;
      const x = cx * st, y = cy * st, x1 = Math.min(w, x + st), y1 = Math.min(h, y + st);
      const u = rx + Math.min(w - 1, x + (st >> 1)) + 0.5, v = ry + Math.min(h - 1, y + (st >> 1)) + 0.5, sx = flip ? -1 : 1;
      if (!at(cx, cy - 1)) { n = N([0, 1, 0]); V(P(x, y, t), u, v, n); V(P(x, y, -t), u, v, n); V(P(x1, y, -t), u, v, n); V(P(x1, y, t), u, v, n); }
      if (!at(cx, cy + 1)) { n = N([0, -1, 0]); V(P(x, y1, -t), u, v, n); V(P(x, y1, t), u, v, n); V(P(x1, y1, t), u, v, n); V(P(x1, y1, -t), u, v, n); }
      if (!at(cx - 1, cy)) { n = N([-sx, 0, 0]); V(P(x, y, -t), u, v, n); V(P(x, y, t), u, v, n); V(P(x, y1, t), u, v, n); V(P(x, y1, -t), u, v, n); }
      if (!at(cx + 1, cy)) { n = N([sx, 0, 0]); V(P(x1, y, t), u, v, n); V(P(x1, y, -t), u, v, n); V(P(x1, y1, -t), u, v, n); V(P(x1, y1, t), u, v, n); }
    }
  },
  build(r, img) {
    const S = JING_TEX.size, C = JING_TEX.cell, c = document.createElement('canvas'); c.width = c.height = S;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    const px = cx.getImageData(0, 0, S, S).data, mask = new Uint8Array(S * S);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3];
    // the ball: 32 x 16 quads
    const d = [], NL = 32, NT = 16;
    const pt = (i, j) => { const lon = (i / NL) * 2 * Math.PI, lat = Math.PI / 2 - (j / NT) * Math.PI; return [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)]; };
    for (let j = 0; j < NT; j++) for (let i = 0; i < NL; i++) {
      const q = [pt(i, j), pt(i, j + 1), pt(i + 1, j + 1), pt(i + 1, j)];
      const side = q[0][2] + q[1][2] + q[2][2] + q[3][2] > 0 ? 0 : C;
      for (const p of q) d.push(p[0], p[1], p[2], (side + 0.5 + (0.5 + 0.5 * p[0]) * (C - 1)) / S, (0.5 + (0.5 - 0.5 * p[1]) * (C - 1)) / S, p[0], p[1], p[2]);
    }
    // turns: about x (y toward +z for a > 0) and y (+z toward +x), then a move
    const rx = (a) => (v) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
    const ry = (a) => (v) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    const rz = (a) => (v) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
    const mv = (o) => (v) => [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
    const seq = (...f) => (v) => f.reduce((p, fn) => fn(p), v);
    // the fins: their roots in the sides a little above the middle, turned halfway between the front and the side
    // (seen whole from either), the tips drooping
    this.extrude(d, mask, 'ear', 0.8, [0.9, 0.1], seq(rz(0.35), ry(-0.8), mv([-0.78, 0.2, 0])), false);
    this.extrude(d, mask, 'ear', 0.8, [0.1, 0.1], seq(rz(-0.35), ry(0.8), mv([0.78, 0.2, 0])), true);
    // the ahoge on the crown, the headdress's frill over the forehead leaning back
    this.extrude(d, mask, 'ahoge', 0.5, [0.45, 0.02], seq(rx(-0.25), mv([0.02, 0.9, 0.12])), false, 0.12);
    this.extrude(d, mask, 'crown', 1.55, [0.5, 0.02], seq(rx(-0.55), mv([0, 0.6, 0.6])), false, 0.12);
    this.mesh = this.upload(r, d);
    // the tail (its own mesh: it swings): out of the back below the middle, the fluke up and away
    const t = [];
    this.extrude(t, mask, 'tail', 1.05, [0.5, 0.0], seq(rx(0.95), ry(Math.PI)), false, 0.16);
    this.tail = this.upload(r, t);
  },
  // where it floats (the user, 2026-11-01): called (V, the talk line, quick mode, a line of its own) it comes in front
  // of the eyes and stays while the answer is read; otherwise it waits beside the player, out of the way (in first
  // person out of sight, in third person by the shoulder). Never through blocks: the way from the eyes to where it
  // goes is walked, and it stops short of the first block in it.
  summoned(g) {
    const s = g.ui.screen;
    return performance.now() < this.until || Companion.busy || s instanceof CompanionChatScreen || (s instanceof ChatScreen && Companion.quick(g));
  },
  call(ms) { this.until = Math.max(this.until || 0, performance.now() + ms); },
  place(g, now) {
    const p = g.player, w = g.world, cp = Math.cos(p.pitch);
    const e = [p.pos[0], p.pos[1] + (p.eyeH || 1.62) * (p.sneaking ? 0.92 : 1), p.pos[2]];
    const fh = [-Math.sin(p.yaw), 0, -Math.cos(p.yaw)], rt = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    let d = [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
    if (g.perspective === 2) d = d.map((v) => -v);
    const up = [rt[1] * d[2] - rt[2] * d[1], rt[2] * d[0] - rt[0] * d[2], rt[0] * d[1] - rt[1] * d[0]];
    const add = (o, ...terms) => { const q = o.slice(); for (const [v, k] of terms) for (let i = 0; i < 3; i++) q[i] += v[i] * k; return q; };
    const call = this.summoned(g);
    let t;
    if (call) t = add(g.perspective === 0 ? e : g.renderer.camPos, [d, 1.4], [rt, 0.32], [up, -0.12]);
    else if (g.perspective === 0) t = add(e, [rt, 1.0], [fh, -0.45], [[0, 1, 0], -0.1]);
    else t = add(e, [rt, 0.75], [fh, 0.15], [[0, 1, 0], 0.35]);
    // the way there walked in steps: the last point where the whole ball is clear of blocks
    const rr = this.R * 1.15;
    const solid = (x, y, z) => { const b = BLOCKS[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]; return !!(b && b.solid); };
    const clear = (q) => !solid(q[0], q[1], q[2]) && !solid(q[0] + rr, q[1], q[2]) && !solid(q[0] - rr, q[1], q[2]) && !solid(q[0], q[1] + rr, q[2]) && !solid(q[0], q[1] - rr, q[2]) && !solid(q[0], q[1], q[2] + rr) && !solid(q[0], q[1], q[2] - rr);
    const reach = (a, b) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(L / 0.08));
      let good = a;
      for (let i = 1; i <= n; i++) { const q = [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, a[2] + (b[2] - a[2]) * i / n]; if (!clear(q)) break; good = q; }
      return good;
    };
    t = reach(e, t);
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now;
    if (!this.pos || Math.hypot(t[0] - this.pos[0], t[1] - this.pos[1], t[2] - this.pos[2]) > 12 || this.world !== w) { this.pos = t.slice(); this.world = w; }
    const k = 1 - Math.exp(-dt * (call ? 7 : 6));
    for (let i = 0; i < 3; i++) this.pos[i] += (t[i] - this.pos[i]) * k;
    // (on its way it doesn't cut through a wall either)
    this.pos = reach(e, this.pos);
    // too close to the eyes to be anything but in the way (a one-block tunnel): not drawn
    this.tooClose = g.perspective === 0 && Math.hypot(this.pos[0] - e[0], this.pos[1] - e[1], this.pos[2] - e[2]) < 0.55;
    const cam = g.renderer.camPos, want = Math.atan2(cam[0] - this.pos[0], cam[2] - this.pos[2]);
    let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 6));
  },
  draw(g, a, env) {
    if (!this.visible(g)) { this.pos = null; return; }
    const r = g.renderer, gl = r.gl, now = performance.now();
    if (!r.entityTex['@jing']) {
      // (a picture, not pixels: smooth, with mipmaps)
      if (!this.loading) {
        this.loading = true; const im = new Image();
        im.onload = () => {
          this.img = im; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          r.entityTex['@jing'] = t;
        };
        im.src = JING_TEX.src;
      }
      return;
    }
    if (!this.mesh) this.build(r, this.img);
    this.place(g, now);
    if (this.tooClose) return;
    const s = now / 1000, since = (now - this.pulse) / 1000;
    // a little hop when it speaks
    const hop = since < 0.6 ? Math.sin(since / 0.6 * Math.PI) : 0;
    // (smaller right by the camera, on its way past it)
    const cd = Math.hypot(...[0, 1, 2].map((i) => this.pos[i] - r.camPos[i]));
    const sq = 1 + 0.12 * hop, R = this.R * Math.max(0.55, Math.min(1, cd / 1.2));
    const m = M4.create();
    M4.translate(m, this.pos[0], this.pos[1] + Math.sin(s * 2.2) * 0.04 + hop * 0.12, this.pos[2]);
    M4.rotY(m, this.yaw); M4.rotZ(m, Math.sin(s * 1.3) * 0.08);
    M4.scale(m, R / Math.sqrt(sq), R * sq, R / Math.sqrt(sq));
    const w = g.world, l = w.getLight(Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2]));
    const E = r.entBegin('@jing', [Math.max(0.5, (l >> 4) / 15), Math.max(0.5, (l & 15) / 15)], env, {});
    // half lit by the world, half its own light: the side it shows the player faces away from the sun as often as
    // not, and under the shader pack it was in the player's own shadow - it went dark (the user, 2026-11-01)
    gl.uniform1f(E.u.u_bright, r.fxOn ? 0.55 : 0.3);
    gl.disable(gl.CULL_FACE);
    gl.uniformMatrix4fv(E.u.u_model, false, m);
    gl.bindVertexArray(this.mesh.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.n * 1.5, gl.UNSIGNED_INT, 0);
    // the tail swings about its stem
    const mt = M4.copy(m); M4.translate(mt, ...this.TAIL_AT); M4.rotY(mt, Math.sin(s * 3.1) * 0.35);
    gl.uniformMatrix4fv(E.u.u_model, false, mt);
    gl.bindVertexArray(this.tail.vao);
    gl.drawElements(gl.TRIANGLES, this.tail.n * 1.5, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null); gl.enable(gl.CULL_FACE); gl.activeTexture(gl.TEXTURE0);
  },
};

// quick mode: a chat line goes to it as well, without being shown twice; a command too, with what the game answered
(() => {
  const run = runCommand;
  Companion.runRaw = run;
  runCommand = function (g, text) {
    const t0 = performance.now();
    run(g, text);
    const t = cmdTidy(String(text || ''));
    if (!t) return;
    if (!t.startsWith('/')) { if (Companion.quick(g, t)) Companion.say(g, t, false); return; }
    // a command (the user, 2026-11-01): it says something about it - what was wrong and the right form, offering to type
    // it. What the game answered is in the chat (a room's server answers a moment later)
    if (!Companion.quick(g)) return;
    setTimeout(() => {
      const got = g.ui.chat.filter((m) => m.t >= t0 && !m.ai && m.text), bad = got.some((m) => m.color === '#FF5555');
      Companion.say(g, `（玩家刚输入了命令：${t}  游戏的回应：${got.map((m) => m.text).join(' / ').slice(0, 300) || '没有回应'}${bad ? '（出错了）' : ''}）`, false, true);
    }, g.net ? 1500 : 300);
  };
})();
