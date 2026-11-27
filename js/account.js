'use strict';
// ---------------------------------------------------------------------------
// The player's account (game/ACCOUNT_PLAN.md): log in with Bilibili inside Toy, or with the personal identity code
// anywhere, or play offline (single player only). The room service keeps the accounts (multiplayer/rooms/accounts.js);
// the browser keeps the login token. What an account unlocks (the rules the user set):
//   三连 on the Toy's video  -> the static capes + custom skins
//   following the UP         -> the animated capes
//   both                     -> playing online, 鲸鲸 (companion.js; the user, 2026-11-07)
// The video is the game's own (Toy.VIDEOS, 2026-11-07); the service's gate config still says whether 三连 / following
// are asked for. (Without a video, following alone unlocks what 三连 would.)
// ---------------------------------------------------------------------------
// a request by XMLHttpRequest (a string body goes as text/plain: no preflight), as {status, ok, text}
function xhr(method, url, body) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url); x.timeout = 15000;
    x.onload = () => resolve({ status: x.status, ok: x.status >= 200 && x.status < 300, text: x.responseText });
    x.onerror = () => reject(new Error('XHR 出错'));
    x.ontimeout = () => reject(new Error('XHR 超时'));
    x.send(body === undefined ? null : body);
  });
}
const Account = {
  // bili: the Bilibili openId this device logged in with ('' = by identity code, undefined = logged in before it was kept)
  token: '', data: null, offline: false, gate: null, checking: false, lastCheck: 0, codeShown: null, bili: undefined,
  // 本地账号默认拥有的全部装饰（cosmetics.js LIST 里的 id）
  LOCAL_OWNED: ['hat:straw', 'hat:tophat', 'hat:crown', 'pet:snowman', 'pre:potato', 'cape:penguin', 'cape:penguinwalk', 'cape:goldapple'],
  // 构造一个本地全解锁账号
  localData(existing) {
    const e = existing || {};
    const skin = (e.skin && typeof e.skin === 'object' && !Array.isArray(e.skin)) ? e.skin : {};
    const settings = (e.settings && typeof e.settings === 'object' && !Array.isArray(e.settings)) ? e.settings : {};
    return Object.assign({
      id: 'local', name: '玩家', super: true, created: Date.now(),
      unlocks: { follow: true, triple: true },
      owned: this.LOCAL_OWNED.slice(),
      skin: {}, settings: {},
    }, e, { skin, settings });
  },
  load() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('mcjs-account') || '{}'); } catch (e) { }
    this.token = s.token || 'local';
    this.data = this.localData(s.account);
    this.offline = false; this.bili = s.bili;
    this.save();
    // 已有真实登录态：后台向 PHP 校验，失败则回退本地账号
    if (this.token && this.token !== 'local') this.refresh().catch(() => this.logoutLocal());
  },
  save() { try { localStorage.setItem('mcjs-account', JSON.stringify({ token: this.token, account: this.data, offline: this.offline, bili: this.bili })); } catch (e) { } },
  get loggedIn() { return !!this.data; },
  get isLocal() { return this.token === 'local'; },
  // 管理员白名单：仅游戏名 xpz（大小写不敏感）显示管理员入口
  get isAdmin() { return this.loggedIn && !this.isLocal && String(this.data.name || '').toLowerCase() === 'xpz'; },
  get name() { return this.data ? this.data.name : '玩家'; },
  device() { const u = navigator.userAgent; return (/Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Windows' : /Mac/.test(u) ? 'Mac' : '其他') + ' · ' + (/BiliApp/i.test(u) ? 'B站App' : /Edg\//.test(u) ? 'Edge' : /Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : /Firefox/.test(u) ? 'Firefox' : '浏览器'); },
  apiBase() { return (window.NET_CONFIG && NET_CONFIG.api) || 'api'; },
  // 旧前端路径 → 本站 PHP 端点；返回 null 表示该接口本地降级为空成功
  route(path) {
    const q = path.split('?'), p = q[0], query = q[1] || '';
    if (p === '/api/account/register') return { url: 'account.php?action=register' };
    if (p === '/api/account/login') return { url: 'account.php?action=login' };
    if (p === '/api/account/me') return { url: 'account.php?action=me' };
    if (p === '/api/account/code') return { url: 'account.php?action=code' };
    if (p === '/api/account/update') return { url: 'account.php?action=update' };
    if (p === '/api/account/logout') return { url: 'account.php?action=logout' };
    if (p === '/api/account/checkin') return { url: 'checkin.php?action=status' };
    if (p === '/api/account/checkin/claim') return { url: 'checkin.php?action=claim' };
    if (p === '/api/news') return { url: 'news.php' };
    // 公告管理（管理员）：全集（含草稿）/ 新建编辑 / 删除
    if (p === '/api/account/news/list') return { url: 'news.php?action=admin' };
    if (p === '/api/account/news/save') return { url: 'news.php?action=save' };
    if (p === '/api/account/news/delete') return { url: 'news.php?action=delete' };
    if (p === '/api/account/announce') return { url: 'announce.php?action=publish' };
    if (p === '/api/announce') return { url: 'announce.php?' + query };
    if (p === '/api/feedback') return { url: 'feedback.php' };
    if (p === '/api/event') return { url: 'checkin.php?action=status' };
    if (p === '/api/skin') return { url: 'skin.php?' + query, method: 'GET' };
    if (p === '/api/cloud') return { url: 'cloud.php?action=list' };
    if (p === '/api/cloud/push') return { url: 'cloud.php?action=push' };
    const m = p.match(/^\/api\/cloud\/([A-Za-z0-9_\-]+)(\/delete|\/touch)?$/);
    if (m) {
      if (m[2] === '/delete') return { url: 'cloud.php?action=delete&wid=' + m[1] };
      if (m[2] === '/touch') return null;
      return { url: 'cloud.php?action=download&wid=' + m[1] };
    }
    return null;
  },
  async api(path, body) {
    const r = this.route(path);
    if (!r) return {}; // 不支持的旧接口（B站/管理员/中心化房间等）本地空成功
    const b = Object.assign({ _t: this.token }, body || {});
    let resp;
    try {
      resp = await fetch(this.apiBase() + '/' + r.url, r.method === 'GET'
        ? undefined
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    } catch (e) { throw new Error('连不上服务器'); }
    const j = await resp.json().catch(() => ({ error: '服务器没有回应（HTTP ' + resp.status + '）' }));
    if (!resp.ok || (j && j.error)) throw Object.assign(new Error((j && j.error) || 'HTTP ' + resp.status), { gate: !!(j && j.gate) });
    return j;
  },
  took(j) { if (j && j.token) this.token = j.token; if (j && j.account) { const a = j.account; if (!a.skin || typeof a.skin !== 'object' || Array.isArray(a.skin)) a.skin = {}; if (!a.settings || typeof a.settings !== 'object' || Array.isArray(a.settings)) a.settings = {}; this.data = a; } this.offline = false; this.codeText = undefined; this.save(); this.applySettings(); return j; },
  // 本站账号密码登录 / 注册（register=true 时新建账号）
  async auth(name, pass, register) {
    const j = this.took(await this.api(register ? '/api/account/register' : '/api/account/login', { name, pass }));
    this.bili = ''; this.save();
    // 用口令派生云存档加密密钥并存本机；换设备登录时重新派生
    try { if (typeof CloudSave !== 'undefined') await CloudSave.deriveKey(pass, name); } catch (e) { }
    return j;
  },
  async loginBili() { throw new Error('本页面为本地自托管版，请用账号密码登录'); },
  async loginCode(code) {
    const j = this.took(await this.api('/api/account/login', { code: String(code || '') }));
    this.bili = ''; this.save();
    return this.data;
  },
  async refresh() {
    // 本地游客没有本站 token：/me 只会回“请先登录”，以前每次打开账号界面都抛一个未处理的错误
    if (!this.token || this.token === 'local') return this.data;
    const j = await this.api('/api/account/me', {}); this.took(j); return this.data;
  },
  async update(fields, opts) {
    if (fields && typeof fields === 'object') {
      if (this.token && this.token !== 'local') {
        try { const j = await this.api('/api/account/update', { fields }); if (j.account) this.data = j.account; }
        catch (e) { Object.assign(this.data, fields); this.save(); if (opts && opts.strict) throw e; }
      } else Object.assign(this.data, fields);
    }
    this.save(); this.applySettings(); return this.data;
  },
  async logout() {
    if (this.token && this.token !== 'local') { try { await this.api('/api/account/logout', {}); } catch (e) { } }
    this.logoutLocal();
  },
  logoutLocal() { this.token = 'local'; this.data = this.localData(); this.offline = false; this.codeText = undefined; this.save(); try { if (typeof CloudSave !== 'undefined') CloudSave.clearKey(); } catch (e) { } },
  async resetCode(reset) {
    const j = await this.api('/api/account/code', { reset: reset ? 1 : 0 });
    if (!j || !j.code) throw new Error('服务器没有返回识别码');
    this.codeText = j.code;
    return j.code;
  },
  async remove() { await this.logout(); },
  chooseOffline() { this.offline = true; this.save(); },
  async loadGate(force) {
    // 联机必须登录：本地 Node 版也保留账号接口（server.js 的 /api/account.php），不再把默认本地游客当成已登录。
    this.gate = { follow: false, triple: false, videos: (typeof Toy !== 'undefined' && Toy.VIDEOS) || [], aiVideos: [], requireAccount: true };
    return this.gate;
  },
  // what is unlocked (anything needs an account)
  get unlocks() { return { follow: true, triple: true }; },
  tripleOk() { return true; },
  has(what) { return true; },
  allUnlocked() { return true; },
  // 三连 / follow as Bilibili says now (only inside Toy); what changed is returned, the account keeps what was seen
  async checkUnlocks(quiet) {
    // 本地版：全解锁，无需向上游校验
    this.checking = false;
    return { inToy: false, follow: true, triple: true, got: [], lost: false };
  },
  // the Bilibili user on this page is the account's own (logged in from here; before that was kept: the same nickname)
  async ownBili() {
    let p = null; try { p = await Toy.profile(); } catch (e) { return false; }
    if (!p || !p.toyOpenId) return false;
    if (this.bili === undefined && this.data && this.data.nick && p.nickname === this.data.nick) { this.bili = p.toyOpenId; this.save(); }
    return !!this.bili && p.toyOpenId === this.bili;
  },
  // settings follow the account (changed ones go up a few seconds later)
  applySettings() {
    const s = this.data && this.data.settings;
    if (!s || typeof game === 'undefined' || !game.settings || this.appliedFor === this.data.id) return;
    this.appliedFor = this.data.id;
    for (const k of ACCOUNT_SETTINGS) if (s[k] !== undefined) game.settings[k] = s[k];
    game.saveSettings();
  },
  settingsChanged() {
    if (!this.loggedIn || typeof game === 'undefined') return;
    clearTimeout(this.setT);
    this.setT = setTimeout(() => { const s = {}; for (const k of ACCOUNT_SETTINGS) if (game.settings[k] !== undefined) s[k] = game.settings[k]; this.update({ settings: s }).catch(() => { }); }, 4000);
  },
};
// the settings that follow the account to other devices (not the ones about this device's screen or speed)
// (not the touch buttons' layout: kept in screen pixels of one device, a tablet's put a phone's off the screen -
// feedback 11-01; each device keeps its own)
const ACCOUNT_SETTINGS = ['fov', 'sens', 'volume', 'gamma', 'bobbing', 'advTooltips', 'keys', 'autoJump', 'invertY', 'subtitles', 'chatOpacity', 'tutorialOff', 'minimap', 'deathMarker', 'recipeHints', 'vibrate', 'quickChat'];
Account.load();
// (each visit: follow / 三连 checked again once the page is up, quietly - unless it was a moment ago)
// A page opened fresh within 15 minutes of 去三连 / 去关注 (toy.js openNative's mark: the page before was killed behind
// the video's page, or this is a second one from its game entry - 11-07): checked aloud, so what was done there shows
setTimeout(() => {
  if (!Account.loggedIn) return;
  let nav = null; try { nav = JSON.parse(localStorage.getItem('mcjs-nav') || 'null'); localStorage.removeItem('mcjs-nav'); } catch (e) { }
  const back = !!(nav && Date.now() - nav.t < 15 * 60e3);
  if (back && typeof Telemetry !== 'undefined' && Telemetry.count) Telemetry.count('nav_reopen');
  // (a check already going - the login's own, quiet - is waited out first)
  const go = (n) => { if (Account.checking && n < 6) { setTimeout(() => go(n + 1), 2000); return; } Account.checkUnlocks(false).catch(() => { }); };
  if (back) go(0);
  else if (Date.now() - Account.lastCheck > 5000) Account.checkUnlocks(true).catch(() => { });
}, 3000);
// the rooms: this account's room key and token instead of the browser's own key
(() => {
  const key = RoomService.key.bind(RoomService);
  RoomService.key = () => (Account.loggedIn && Account.data.roomKey ? Account.data.roomKey : key());
  const api = RoomService.api.bind(RoomService);
  RoomService.api = async function (path, body) {
    if (!this.base()) return {}; // 本地版：未配置房间服务器，直接空成功
    if (!Account.token || !body) return api(path, body); // (what is only looked at needs no token)
    let r;
    try { r = await fetch(this.base() + path, { method: 'POST', body: JSON.stringify({ ...body, _t: Account.token }) }); }
    catch (e) { throw new Error('连不上联机服务器'); }
    const j = await r.json().catch(() => ({ error: '联机服务器没有回应' }));
    if (!r.ok || (j && j.error)) throw Object.assign(new Error((j && j.error) || 'HTTP ' + r.status), { gate: !!(j && j.gate) });
    return j;
  };
  const save = Game.prototype.saveSettings;
  Game.prototype.saveSettings = function () { save.call(this); Account.settingsChanged(); };
})();

// ---- drawing helpers for the account screens ----
// a rounded dark card with a gold or grey edge
function drawCard(c, x, y, w, h, gold) {
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, y, w, h);
  c.strokeStyle = gold ? '#E8B830' : '#555555'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (gold) { c.fillStyle = 'rgba(232,184,48,0.10)'; c.fillRect(x + 1, y + 1, w - 2, h - 2); }
}
// little pixel icons: thumb up, coin, star (三连), heart-plus (follow), check, lock
const ICON_PIX = {
  like: ['..##....', '..##....', '.###....', '########', '#.######', '#.######', '#.#####.', '#.####..'],
  coin: ['..####..', '.#....#.', '#..##..#', '#.#..#.#', '#.#..#.#', '#..##..#', '.#....#.', '..####..'],
  star: ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '.#....#.', '........'],
  follow: ['.##..##.', '########', '########', '########', '.######.', '..####..', '...##...', '........'],
  check: ['.......#', '......##', '.....##.', '#...##..', '##.##...', '.###....', '..#.....', '........'],
  lock: ['..####..', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########', '########'],
};
function drawIcon(c, name, x, y, s, col) {
  const p = ICON_PIX[name]; if (!p) return;
  c.fillStyle = col;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (p[j][i] === '#') c.fillRect(x + i * s, y + j * s, s, s);
}
// a short burst on screen when something is unlocked (a sound, a gold toast, sparks)
function unlockCelebrate(g, got) {
  const names = { triple: '静态披风和自定义皮肤', follow: '动态披风', online: '联机', jing: 'AI 伙伴' + ((typeof Companion !== 'undefined' && Companion.name) || '鲸鲸') };
  Sound.ev && Sound.ev('entity.player.levelup', null, 0.8, 1);
  g.ui.message && g.ui.message('解锁了：' + got.map((k) => names[k]).join('、') + '！', '#FFD24A');
  UnlockSparks.start(got);
}
const UnlockSparks = {
  t0: 0, list: [], text: '',
  start(got) {
    this.t0 = performance.now(); this.list = [];
    this.text = '解锁：' + got.map((k) => ({ triple: '静态披风 + 自定义皮肤', follow: '动态披风', online: '联机', jing: '鲸鲸' })[k]).join(' · ');
    for (let i = 0; i < 60; i++) this.list.push({ a: Math.random() * Math.PI * 2, v: 40 + Math.random() * 90, c: ['#FFD24A', '#FFF2B0', '#FB7299', '#7FD8FF'][i % 4] });
  },
  draw(ui) {
    const t = (performance.now() - this.t0) / 1000;
    if (!this.t0 || t > 2.6) return;
    const c = ui.ctx, cx = ui.w / 2, cy = ui.h / 2 - 20, f = Math.min(1, t * 4) * Math.min(1, (2.6 - t) * 2);
    c.save(); c.globalAlpha = f;
    for (const p of this.list) { const r = p.v * t, y = cy + Math.sin(p.a) * r + 30 * t * t; c.fillStyle = p.c; c.fillRect(Math.round(cx + Math.cos(p.a) * r), Math.round(y), 2, 2); }
    const w = Font.width(this.text) + 24;
    c.fillStyle = 'rgba(40,28,0,0.85)'; c.fillRect(cx - w / 2, cy - 12, w, 22);
    c.strokeStyle = '#E8B830'; c.strokeRect(cx - w / 2 + 0.5, cy - 11.5, w - 1, 21);
    Font.center(c, this.text, cx, cy - 4, '#FFD24A');
    c.restore();
  },
};

// ---- 登录: Bilibili (gold, recommended) / identity code / offline ----
// offline: where 离线游玩 goes when it is not next - from the way into multiplayer, back where the player came from
// (next would ask for the login again, and the same screen came back as if the button did nothing)
class LoginScreen extends MenuScreen {
  constructor(game, next, offline) {
    super(game, '登录'); this.next = next; this.offline = offline; this.pauses = false; this.titleY = 22; this.note = ''; this.noteColor = '#A0A0A0'; this.busy = false; this.inToy = null;
    Toy.ready().then((v) => { this.inToy = v; if (this.game.ui.screen === this) this.layout(); });
    this.mobileOutside = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && !/BiliApp/i.test(navigator.userAgent);
  }
  say(t, bad) { this.note = t; this.noteColor = bad ? '#FF6060' : '#A0A0A0'; }
  done() { const n = this.next; this.next = null; if (n) n(); else this.game.ui.open(new TitleScreen(this.game)); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.max(70, Math.floor(u.h / 2 - 40));
    this.widgets = [];
    this.widgets.push(
      { x: 6, y: 4, w: 64, h: 20, label: '< 返回', onClick: () => this.game.ui.open(new TitleScreen(this.game)) },
      { x: cx - 110, y, w: 220, h: 24, gold: true, label: () => (this.busy ? '正在登录…' : '账号登录 / 注册'), enabled: !this.busy, onClick: () => this.game.ui.open(new AccountAuthScreen(this.game, this)) },
      { x: cx - 60, y: y + 34, w: 120, h: 16, label: '离线游玩', enabled: !this.busy, tip: ['只能玩单人游戏，存档只在这台设备上', '之后随时可以在 选项 → 账号 里登录'], onClick: () => { Account.chooseOffline(); if (this.offline) { this.next = null; this.offline(); } else this.done(); } },
      { x: cx - 60, y: y + 54, w: 120, h: 16, label: '用识别码登录', enabled: !this.busy, tip: ['换设备、忘了密码时用', '第一次用 B站 登录时，游戏给过你 16 位识别码'], onClick: () => this.game.ui.open(new CodeLoginScreen(this.game, this)) },
    );
  }
  async bili() {
    this.busy = true; this.say('正在向 B站 请求授权…'); this.layout();
    try {
      const j = await Account.loginBili();
      if (j.code) { this.game.ui.open(new CodeShowScreen(this.game, j.code, () => this.done(), true)); return; }
      this.done();
      this.game.ui.message && this.game.ui.message('欢迎回来，' + Account.name, '#55FF55');
    } catch (e) {
      this.busy = false; this.say(e instanceof ToyError ? Toy.explain(e) : e.message, true); this.layout();
      if (e instanceof ToyError && typeof Telemetry !== 'undefined' && Telemetry.flush) Telemetry.flush(false);
    }
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, y = Math.max(70, Math.floor(ui.h / 2 - 40));
    const lines = ['登录后可以：和朋友联机、存档同步到云端、换皮肤和披风', '账号和存档换设备也在'];
    lines.forEach((t, i) => Font.center(c, fitText(t, ui.w - 8), cx, y - 34 + i * 11, i ? '#A0A0A0' : '#FFFFFF'));
    if (this.inToy === false) Font.center(c, fitText(this.mobileOutside ? '手机浏览器里不能用 B站一键登录：可以用本站账号密码，或用识别码登录' : '不在 B站 Toy 页面里：可以用本站账号密码，或用识别码登录', ui.w - 8), cx, y - 12, '#FFD24A');
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, y + 96, this.noteColor);
    if (typeof GAME_BUILD !== 'undefined') Font.center(c, '版本 ' + GAME_BUILD, cx, ui.h - 12, '#707070'); // (which build a screenshot is from)
  }
  onEsc() { this.game.ui.open(new TitleScreen(this.game)); }
}
// the identity code, the one time it is shown
class CodeShowScreen extends MenuScreen {
  constructor(game, code, next, fresh) {
    super(game, fresh === 'new' ? '已换成新的识别码' : fresh ? '这是你的个人识别码' : '你的个人识别码');
    this.code = code; this.next = next; this.pauses = false; this.t0 = performance.now(); this.copied = null; this.fresh = fresh;
  }
  base() { return Math.max(0, Math.floor((this.game.ui.h - 150) / 2)); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = this.base() + 110;
    this.titleY = this.base() + 10;
    this.widgets = [
      { x: cx - 110, y, w: 108, h: 20, label: () => (this.copied ? '已复制' : this.copied === false ? '复制不了，请抄下来' : '复制识别码'), onClick: async () => { this.copied = await copyText(this.code); } },
      { x: cx + 2, y, w: 108, h: 20, label: () => { const s = Math.ceil(3 - (performance.now() - this.t0) / 1000); return s > 0 ? `我记下了（${s}）` : '我记下了'; }, enabled: true,
        onClick: () => { if (performance.now() - this.t0 < 3000) return; const n = this.next; this.next = null; n && n(); } },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, y = this.base() + 76;
    const w = Font.width(this.code) * 2 + 24;
    drawCard(c, Math.floor(cx - w / 2), y - 8, w, 30, true);
    c.save(); c.translate(cx, y); c.scale(2, 2); Font.center(c, this.code, 0, 0, '#FFD24A'); c.restore();
    const lines = this.fresh
      ? [['只显示这一次，请抄下来或复制保存', '#FFFFFF'], ['用它可以在任何设备上登录你的账号：请保密，别发给别人', '#FF8080'], ['忘了可以登录后在 选项 → 账号 里重新生成', '#A0A0A0']]
      : [['用它可以在任何设备上登录你的账号：请保密，别发给别人', '#FF8080'], ['忘了带账号密码时，登录界面也能用它登录', '#A0A0A0'], ['在 选项 → 账号 里可以随时复制或重设', '#A0A0A0']];
    lines.forEach(([t, col], i) => Font.center(c, fitText(t, ui.w - 8), cx, this.base() + 26 + i * 11, col));
  }
  onEsc() { const n = this.next; this.next = null; n && n(); }
}
// 本站账号密码登录 / 注册（PHP 文件账号）
class AccountAuthScreen extends FormScreen {
  constructor(game, parent) {
    super(game, '账号登录', parent);
    this.name = ''; this.pass = ''; this.busy = false; this.register = false;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = {};
    this.addField('name', cx - 110, 70, 220, '用户名（3–16 位字母/数字/下划线）', 16, (v) => v.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16));
    this.addField('pass', cx - 110, 102, 220, '密码（4–32 位）', 32, (v) => v.slice(0, 32));
    this.widgets = [
      { x: cx - 110, y: 134, w: 108, h: 20, gold: true, label: () => (this.busy ? '正在…' : this.register ? '注册' : '登录'), enabled: !this.busy, onClick: () => this.submit() },
      { x: cx + 2, y: 134, w: 108, h: 20, label: () => (this.register ? '已有账号？去登录' : '没有账号？注册'), enabled: !this.busy, onClick: () => { this.register = !this.register; this.title = this.register ? '注册新账号' : '账号登录'; this.layout(); } },
      { x: cx - 100, y: 160, w: 200, h: 18, label: '返回', onClick: () => this.back() },
      { x: cx - 100, y: 182, w: 200, h: 18, label: '用识别码登录', tip: ['换个设备、或者忘了密码时用'], onClick: () => this.game.ui.open(new CodeLoginScreen(this.game, this.parent)) },
    ];
  }
  async submit() {
    if (this.busy) return;
    const name = this.name.trim(), pass = this.pass;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { this.say('用户名需为 3–16 位字母、数字或下划线', true); this.layout(); return; }
    if (pass.length < 4 || pass.length > 32) { this.say('密码需为 4–32 位', true); this.layout(); return; }
    this.busy = true; this.say(this.register ? '正在注册…' : '正在登录…'); this.layout();
    try {
      await Account.auth(name, pass, this.register);
      this.game.ui.hideInput();
      this.game.ui.message && this.game.ui.message('已登录：' + Account.name, '#55FF55');
      const p = this.parent;
      if (p instanceof LoginScreen) p.done(); else this.game.ui.open(new AccountScreen(this.game, new OptionsScreen(this.game, new TitleScreen(this.game))));
    } catch (e) { this.busy = false; this.say(e.message, true); this.layout(); }
  }
  drawExtra(ui) {
    this.drawFields(ui);
    Font.center(ui.ctx, this.register ? '注册后外观、云存档会保存在本站账号，换设备可同步' : '登录后可联机、同步云存档、换皮肤和披风', ui.w / 2, 204, '#808080');
  }
}
class CodeLoginScreen extends FormScreen {
  constructor(game, parent) { super(game, '用识别码登录', parent); this.code = ''; this.busy = false; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = {};
    this.addField('code', cx - 110, 80, 220, '个人识别码（XXXX-XXXX-XXXX-XXXX）', 19, (v) => { const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16); return s.replace(/(.{4})(?=.)/g, '$1-'); });
    this.widgets = [
      { x: cx - 110, y: 110, w: 108, h: 20, label: () => (this.busy ? '正在登录…' : '登录'), enabled: !this.busy, onClick: () => this.submit() },
      { x: cx + 2, y: 110, w: 108, h: 20, label: '返回', onClick: () => this.back() },
    ];
    this.focus('code');
  }
  async submit() {
    if (this.busy) return;
    if (this.code.replace(/-/g, '').length !== 16) { this.say('识别码是 16 位（4 组，每组 4 位）', true); return; }
    this.busy = true; this.say('正在登录…'); this.layout();
    try {
      await Account.loginCode(this.code);
      this.game.ui.hideInput();
      this.game.ui.message && this.game.ui.message('已登录：' + Account.name, '#55FF55');
      const p = this.parent;
      if (p instanceof LoginScreen) p.done(); else this.game.ui.open(new AccountScreen(this.game, new OptionsScreen(this.game, new TitleScreen(this.game))));
    } catch (e) { this.busy = false; this.say(e.message, true); this.layout(); }
  }
  drawExtra(ui) { this.drawFields(ui); Font.center(ui.ctx, fitText('第一次用 B站登录时，游戏给过你识别码', ui.w - 8), ui.w / 2, 140, '#808080'); }
}

// ---- 账号 (选项): the game name, unlocks, the identity code, logging out, deleting ----
class AccountScreen extends FormScreen {
  constructor(game, parent) { super(game, '账号', parent); this.newName = Account.name; this.confirm = null; Account.refresh().then(() => { this.newName = Account.name; if (this.game.ui.screen === this) this.layout(); }).catch(() => { }); Account.loadGate(); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    this.fields = {}; this.widgets = [];
    if (Account.loggedIn && !Account.isLocal && Account.codeText === undefined) {
      Account.resetCode(false).then((c) => { if (this.game.ui.screen === this) this.layout(); }).catch(() => { Account.codeText = ''; });
    }
    if (!Account.loggedIn) {
      this.widgets.push(
        { x: cx - 100, y: 60, w: 200, h: 24, gold: true, label: '登录', onClick: () => g.ui.open(new LoginScreen(g, () => g.ui.open(new AccountScreen(g, this.parent)))) },
        { x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.back() },
      );
      return;
    }
    // (the game name is the Bilibili name: shown, not changed here - drawExtra)
    const confirmDel = this.confirm === 'del';
    // 160~200 逻辑像素的超短屏（手机浏览器地址栏 + GUI 缩放）：先算出文字块和页脚，再把所有行压进剩余高度
    if (u.h < 300) {
      const ultra = u.h < 190, footH = ultra ? 16 : 20, footY = u.h - 4 - footH;
      // 8 像素字高 + 1 像素阴影，行距留 10；标题在 y12，第一行从 y26 开始，避免压到标题
      this.titleY = 12;
      const stepY = 10, cy = ultra ? 26 : 28, textBottom = cy + stepY * 3 + 9;
      const rows = [], addRow = (l, r) => rows.push([l, r]);
      addRow({ label: '皮肤和装饰…', gold: true, onClick: () => g.ui.open(new WardrobeScreen(g, this)) },
        { label: () => Account.allUnlocked() ? '已全部解锁' : '解锁…', gold: !Account.allUnlocked(), onClick: () => g.ui.open(new UnlockScreen(g, this)) });
      if (Account.isLocal) addRow({ label: '登录 / 注册本站账号', gold: true, tip: ['登录后云存档跨设备同步、联机、签到领奖', '当前是本地游客：外观与存档只存在这台浏览器'], onClick: () => g.ui.open(new AccountAuthScreen(g, () => g.ui.open(new AccountScreen(g, this.parent)))) }, null);
      else addRow({ label: '退出登录', onClick: async () => { await Account.logout(); this.say('已退出登录'); this.layout(); } },
        { label: confirmDel ? '再点一次：永久删除' : '删除账号', color: confirmDel ? '#FF6060' : undefined, tip: ['删除账号、云存档、解锁记录，不能恢复', '这台设备上的存档不受影响'], onClick: () => this.del() });
      addRow({ label: '诊断', tip: ['显示 B站 返回的原始数据（排查问题用）'], onClick: () => g.ui.open(new ToyDiagScreen(g, this)) },
        Account.isAdmin ? { label: '管理员…', gold: true, tip: ['临时昵称、全服公告、昵称颜色、管理员披风'], onClick: () => g.ui.open(new AdminScreen(g, this)) } : null);
      addRow({ label: '识别码…', tip: ['个人识别码：换设备、忘记密码时在登录界面用它登录', '只给自己用，不要发给别人'], onClick: () => this.showCode() },
        { label: '重设识别码', tip: ['生成新的识别码，旧的立刻作废'], onClick: () => this.reset() });
      if (Companion.shown) addRow({ label: 'AI 伙伴…', tip: ['会聊天、懂你在游戏里做什么的 AI 小伙伴（全服免费，每天有次数）'], onClick: () => g.ui.open(new CompanionScreen(g, this)) }, null);
      const nRows = rows.length, gap = ultra ? 1 : 2;
      const bh = clamp(Math.floor((footY - 2 - textBottom - (nRows - 1) * gap) / nRows), 9, ultra ? 13 : 16);
      let ry = textBottom + 2;
      for (const [left, right] of rows) {
        if (left) this.widgets.push({ x: cx - 150, y: ry, w: 148, h: bh, ...left });
        if (right) this.widgets.push({ x: cx + 2, y: ry, w: 148, h: bh, ...right });
        ry += bh + gap;
      }
      this.widgets.push({ x: cx - 100, y: footY, w: 200, h: footH, label: '完成', onClick: () => this.back() });
      this.compact = true; this.ultra = ultra; this.textCY = cy; this.textStep = stepY;
      return;
    }
    // 手机横屏/GUI 缩放 3 时逻辑高度只有 240 左右：按钮排成两列并按高度收紧，否则识别码那排会压到“完成”
    const compact = u.h < 300, bh = compact ? 16 : 20, gap = compact ? 2 : 4, foot = u.h - 27;
    let y = compact ? 74 : 116;
    const push = (w) => this.widgets.push(w);
    const pair = (left, right) => {
      if (left) push({ x: cx - 150, y, w: 148, h: bh, ...left });
      if (right) push({ x: cx + 2, y, w: 148, h: bh, ...right });
      y += bh + gap;
    };
    pair({ label: '皮肤和装饰…', gold: true, onClick: () => g.ui.open(new WardrobeScreen(g, this)) },
      { label: () => Account.allUnlocked() ? '已全部解锁' : '解锁…', gold: !Account.allUnlocked(), onClick: () => g.ui.open(new UnlockScreen(g, this)) });
    if (Account.isLocal) {
      push({ x: cx - 150, y, w: 300, h: bh, gold: true, label: '登录 / 注册本站账号', tip: ['登录后云存档跨设备同步、联机、签到领奖', '当前是本地游客：外观与存档只存在这台浏览器'], onClick: () => g.ui.open(new AccountAuthScreen(g, () => g.ui.open(new AccountScreen(g, this.parent)))) });
      y += bh + gap;
    } else {
      pair({ label: '退出登录', onClick: async () => { await Account.logout(); this.say('已退出登录'); this.layout(); } },
        { label: confirmDel ? '再点一次：永久删除' : '删除账号', color: confirmDel ? '#FF6060' : undefined, tip: ['删除账号、云存档、解锁记录，不能恢复', '这台设备上的存档不受影响'], onClick: () => this.del() });
    }
    pair({ label: '诊断', tip: ['显示 B站 返回的原始数据（排查问题用）'], onClick: () => g.ui.open(new ToyDiagScreen(g, this)) },
      Account.isAdmin ? { label: '管理员…', gold: true, tip: ['临时昵称、全服公告、昵称颜色、管理员披风'], onClick: () => g.ui.open(new AdminScreen(g, this)) } : null);
    pair({ label: '识别码…', tip: ['个人识别码：换设备、忘记密码时在登录界面用它登录', '只给自己用，不要发给别人'], onClick: () => this.showCode() },
      { label: '重设识别码', tip: ['生成新的识别码，旧的立刻作废'], onClick: () => this.reset() });
    if (Companion.shown) {
      push({ x: cx - 150, y, w: 300, h: bh, label: 'AI 伙伴…', tip: ['会聊天、懂你在游戏里做什么的 AI 小伙伴（全服免费，每天有次数）'], onClick: () => g.ui.open(new CompanionScreen(g, this)) });
      y += bh + gap;
    }
    push({ x: cx - 100, y: foot, w: 200, h: 20, label: '完成', onClick: () => this.back() });
    this.compact = compact;
  }
  async showCode() {
    try { const code = await Account.resetCode(false); this.game.ui.hideInput(); this.game.ui.open(new CodeShowScreen(this.game, code, () => this.game.ui.open(this), false)); }
    catch (e) { this.say(e.message, true); }
  }
  async reset() {
    try { const code = await Account.resetCode(true); this.game.ui.hideInput(); this.game.ui.open(new CodeShowScreen(this.game, code, () => this.game.ui.open(this), 'new')); }
    catch (e) { this.say(e instanceof ToyError ? Toy.explain(e) : e.message, true); }
  }
  async del() {
    if (this.confirm !== 'del') { this.confirm = 'del'; this.layout(); return; }
    try { await Account.remove(Account.name); this.say('账号已删除'); } catch (e) { this.say(e.message, true); }
    this.confirm = null; this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    if (!Account.loggedIn) { Font.center(c, Account.offline ? '现在是离线游玩：只能玩单人游戏' : '还没有登录', cx, 40, '#A0A0A0'); return; }
    this.drawFields(ui);
    const d = Account.data, u = Account.unlocks, cy = this.textCY ?? (this.compact ? 28 : 52), stepY = this.textStep ?? (this.compact ? 10 : 12);
    if (Account.isLocal) {
      Font.draw(c, '游戏名：' + Account.name, cx - 150, cy, '#FFFFFF');
      Font.draw(c, '本地账号 · 外观与存档保存在本浏览器', cx - 150, cy + stepY, '#808080');
      Font.draw(c, '✓ 全部皮肤、披风、帽子、宠物、前缀已解锁', cx - 150, cy + stepY * 2, '#A0A0A0');
      if (!this.compact) Font.draw(c, '点下方「登录 / 注册本站账号」可云端同步存档、联机、签到', cx - 150, cy + stepY * 3, '#808080');
      else Font.draw(c, '点下面「登录 / 注册本站账号」可云端同步', cx - 150, cy + stepY * 3, '#808080');
      return;
    }
    if (this.compact) {
      Font.draw(c, '游戏名：' + Account.name, cx - 150, cy, '#FFFFFF');
      Font.draw(c, `B站：${d.nick || '（识别码登录）'}　注册于 ${new Date(d.created).toLocaleDateString()}`, cx - 150, cy + stepY, '#A0A0A0');
      const st = (ok, t) => (ok ? '✓ ' : '✗ ') + t;
      Font.draw(c, [st(Account.tripleOk(), '三连'), st(u.follow, '关注'), st(Account.has('online'), '联机')].join('　'), cx - 150, cy + stepY * 2, '#E0E0E0');
      if (Account.codeText) Font.draw(c, '识别码：' + Account.codeText, cx - 150, cy + stepY * 3, '#FFD24A');
      return;
    }
    Font.draw(c, '游戏名：' + Account.name, cx - 150, 52, '#FFFFFF');
    Font.draw(c, '就是 B站名，B站改名后会跟着变', cx - 150, 64, '#808080');
    Font.draw(c, `B站：${d.nick || '（识别码登录）'}　　注册于 ${new Date(d.created).toLocaleDateString()}`, cx - 150, 80, '#A0A0A0');
    const st = (ok, t) => (ok ? '✓ ' : '✗ ') + t;
    Font.draw(c, [st(Account.tripleOk(), '三连'), st(u.follow, '关注'), st(Account.has('online'), '联机')].join('　'), cx - 150, 94, '#E0E0E0');
    if (Account.codeText) Font.draw(c, '识别码：' + Account.codeText, cx - 150, 106, '#FFD24A');
  }
}
// ---- 管理员 (the highest permissions, rooms/accounts.js): a temporary nickname to play under online, an announcement
// to everyone playing, the colour of the name, the administrators' cape ----
const ADMIN_COLORS = ['', '#FFAA00', '#FFFF55', '#55FF55', '#55FFFF', '#5555FF', '#FF55FF', '#FF5555', '#AA00AA', '#00AAAA', '#AAAAAA', '#E8B830', '#FF7EB6', '#7FD4FF'];
// 冻结名单 (administrators): the accounts the service froze for a severe word (moderation.js) - who, when, where, the
// words - each with 解冻 (the account, its address and its network let back in)
class FrozenScreen extends MenuScreen {
  constructor(game, parent) { super(game, '冻结名单'); this.parent = parent; this.pauses = false; this.titleY = 12; this.list = null; this.page = 0; this.note = ''; this.noteColor = '#80FF80'; this.load(); }
  async load() {
    try { const j = await Account.api('/api/account/admin/frozen', {}); this.list = j.list || []; this.hours = j.hours; } catch (e) { this.list = []; this.say(e.message, true); }
    if (this.game.ui.screen === this) this.layout();
  }
  say(t, bad) { this.note = t; this.noteColor = bad ? '#FF6060' : '#80FF80'; }
  rows() { return Math.max(2, Math.floor((this.game.ui.h - 90) / 30)); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, L = this.list || [], n = this.rows(), pages = Math.max(1, Math.ceil(L.length / n));
    this.page = clamp(this.page, 0, pages - 1);
    this.widgets = L.slice(this.page * n, this.page * n + n).map((f, i) => ({ x: cx + 116, y: 34 + i * 30, w: 44, h: 18, label: '解冻', onClick: () => this.unfreeze(f) }));
    if (pages > 1) this.widgets.push(
      { x: cx - 160, y: u.h - 30, w: 50, h: 20, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
      { x: cx + 110, y: u.h - 30, w: 50, h: 20, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } },
    );
    this.widgets.push({ x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) });
  }
  async unfreeze(f) {
    try { const j = await Account.api('/api/account/admin/unfreeze', { id: f.id }); this.list = j.list || []; this.say('已解冻 ' + f.name + '（账号和 IP 都放开了）'); }
    catch (e) { this.say(e.message, true); }
    this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, L = this.list, n = this.rows();
    if (!L) { Font.center(c, '正在读取…', cx, 60, '#A0A0A0'); return; }
    if (!L.length) Font.center(c, '没有被冻结的账号', cx, 60, '#A0A0A0');
    const t2 = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    L.slice(this.page * n, this.page * n + n).forEach((f, i) => {
      const y = 34 + i * 30;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 160, y - 2, 320, 28);
      Font.draw(c, fitText(f.name || f.id, 140), cx - 157, y + 1, '#FFFFFF');
      Font.draw(c, fitText(`${t2(f.at)} · ${f.why}${f.banned ? ' · IP 封禁中' : ''}`, 270), cx - 157, y + 12, '#A0A0A0');
      if (f.text) Font.draw(c, fitText('原话：' + f.text, 270), cx - 157, y + 21, '#FF8080');
    });
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, ui.h - 42, this.noteColor);
  }
  onEsc() { this.game.ui.open(this.parent); }
}
class AdminScreen extends FormScreen {
  constructor(game, parent) { super(game, '管理员', parent); this.nick = Account.data.tempNick || ''; this.notice = ''; this.busy = null; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    this.fields = {}; this.widgets = [];
    this.addField('nick', cx - 150, 52, 196, '临时昵称（联机时用这个名字；留空：用 B站名）', 16, (v) => v.replace(/[\s"'\\§]/g, '').slice(0, 16));
    this.widgets.push({ x: cx + 50, y: 52, w: 48, h: 20, gold: true, label: () => (this.busy === 'nick' ? '…' : '使用'), enabled: !this.busy, onClick: () => this.setNick(this.nick) });
    this.widgets.push({ x: cx + 102, y: 52, w: 48, h: 20, label: '清除', enabled: !this.busy && !!Account.data.tempNick, onClick: () => this.setNick('') });
    this.addField('notice', cx - 150, 96, 248, '全服公告（单人和联机的所有人都会在聊天框看到）', 100, (v) => v.slice(0, 100));
    this.widgets.push({ x: cx + 102, y: 96, w: 48, h: 20, gold: true, label: () => (this.busy === 'notice' ? '…' : '发布'), enabled: !this.busy, onClick: () => this.announce() });
    // the name's colour: a row of swatches (the first: none)
    this.swatches = ADMIN_COLORS.map((col, i) => ({ x: cx - 150 + i * 21, y: 136, w: 19, h: 19, label: '', col, tip: [col ? '昵称颜色 ' + col : '不用颜色（白色）'], enabled: !this.busy, onClick: () => this.setColor(col) }));
    this.widgets.push(...this.swatches);
    this.widgets.push({ x: cx - 150, y: 166, w: 300, h: 20, gold: true, label: '管理员披风（动态）…', tip: ['在 皮肤和装饰 里选「管理员」'], onClick: () => g.ui.open(new WardrobeScreen(g, this)) });
    this.widgets.push({ x: cx - 150, y: 190, w: 300, h: 20, label: '冻结名单…', tip: ['写了严重违规内容被自动冻结的账号', '可以看原话和时间，误伤了可以解冻'], onClick: () => g.ui.open(new FrozenScreen(g, this)) });
    this.widgets.push({ x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '完成', onClick: () => this.back() });
  }
  async run(k, f, ok) {
    this.busy = k; this.layout();
    try { await f(); this.say(ok); } catch (e) { this.say(e.message, true); }
    this.busy = null; this.layout();
  }
  setNick(n) {
    return this.run('nick', async () => { await Account.update({ tempNick: n }); this.nick = Account.data.tempNick || ''; },
      n ? `之后进联机房间时叫「${n}」（已经在房间里的话，重新进入后生效）` : '已改回 B站名（重新进入房间后生效）');
  }
  setColor(c) { return this.run('color', () => Account.update({ nameColor: c }), c ? '昵称颜色已设置，房间里的人马上能看到' : '已取消昵称颜色'); }
  announce() {
    const text = this.notice.trim();
    if (!text) { this.say('先写公告内容', true); return; }
    return this.run('notice', async () => {
      if (typeof textOk === 'function' && !(await textOk(this.game, text, 'chat'))) throw new Error('这段文字没有通过 B站 的内容检查');
      await Account.api('/api/account/announce', { text });
      this.notice = '';
    }, '公告已发布');
  }
  drawExtra(ui) {
    this.drawFields(ui);
    const c = ui.ctx, cx = ui.w / 2, cur = Account.data.nameColor || '';
    Font.draw(c, '昵称颜色', cx - 150, 125, '#A0A0A0');
    Font.draw(c, '现在：' + (Account.data.tempNick || Account.name), cx + 50, 125, cur || '#FFFFFF');
  }
  draw(ui) {
    super.draw(ui);
    const c = ui.ctx, cur = Account.data.nameColor || '';
    for (const s of this.swatches || []) {
      c.fillStyle = s.col || '#FFFFFF'; c.fillRect(s.x + 3, s.y + 3, s.w - 6, s.h - 6);
      if (!s.col) { c.strokeStyle = '#FF5555'; c.beginPath(); c.moveTo(s.x + 4, s.y + s.h - 4); c.lineTo(s.x + s.w - 4, s.y + 4); c.stroke(); }
      if (s.col === cur) { c.strokeStyle = '#FFFFFF'; c.lineWidth = 1; c.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1); }
    }
  }
}
const g_netName = (g) => { if (Account.loggedIn) { g.settings.netName = Account.name; g.saveSettings(); } };

// ---- 解锁: 三连 and following, with what each gives (the user wants this done well) ----
class UnlockScreen extends MenuScreen {
  // then: where 开始联机 goes (the gate's next step; none: the multiplayer screen from the title)
  constructor(game, parent, reason, then) {
    super(game, '解锁'); this.parent = parent; this.reason = reason || ''; this.then = then || null; this.startOn = Account.has('online'); this.goldFrom = 0; this.pauses = false; this.titleY = 12; this.note = ''; this.noteColor = '#A0A0A0'; this.inToy = null; this.went = null;
    Account.loadGate().then(() => { if (this.game.ui.screen === this) this.layout(); });
    Toy.ready().then((v) => { this.inToy = v; if (this.game.ui.screen === this) this.layout(); if (v && Account.loggedIn && Date.now() - Account.lastCheck > 15000) this.check(true); });
    // back from the video / the UP's page: look again
    // (B站 may take a few seconds to count a new follow or coin: looked at a few more times while this is open)
    this.onBack = () => { if (document.visibilityState === 'visible' && this.went && this.game.ui.screen === this) { this.went = null; this.retries = 3; setTimeout(() => this.check(), 600); } };
    document.addEventListener('visibilitychange', this.onBack); window.addEventListener('focus', this.onBack);
  }
  // (close() is the UI's: called whenever another screen takes this one's place - opening one from it recursed)
  close() { document.removeEventListener('visibilitychange', this.onBack); window.removeEventListener('focus', this.onBack); }
  back() { this.game.ui.open(this.parent || new TitleScreen(this.game)); }
  onEsc() { this.back(); }
  say(t, bad) { this.note = t; this.noteColor = bad ? '#FF6060' : '#A0A0A0'; }
  cards() {
    const u = this.game.ui, cx = u.w / 2, w = Math.min(170, Math.floor((u.w - 24) / 2)), h = 132, y = 46;
    const g = Account.gate || {}, hasVideo = !!(g.videos && g.videos.length);
    return [
      { x: cx - w - 4, y, w, h, kind: 'triple', on: hasVideo, done: Account.tripleOk(), title: '给新视频三连', sub: hasVideo ? '点赞+投币+收藏（老视频不算）' : '视频发布后开放', gives: ['4 款静态披风', '自定义皮肤（正版玩家皮肤）'] },
      { x: cx + 4, y, w, h, kind: 'follow', on: true, done: !!Account.unlocks.follow, title: '关注 UP 主', sub: '土豆味小哲', gives: ['3 款动态披风', hasVideo ? '' : '（视频发布前也解锁静态披风和皮肤）'].filter(Boolean) },
    ];
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    this.widgets = [];
    if (!Account.loggedIn) {
      this.widgets.push({ x: cx - 100, y: 196, w: 200, h: 24, gold: true, label: '先登录', onClick: () => g.ui.open(new LoginScreen(g, () => g.ui.open(new UnlockScreen(g, this.parent, this.reason, this.then)), () => offlineBack(g, this.parent))) });
    } else for (const k of this.cards()) {
      if (k.done || !k.on) continue;
      this.widgets.push({ x: k.x + 10, y: k.y + k.h - 28, w: k.w - 20, h: 20, gold: true, enabled: this.inToy === true,
        label: k.kind === 'triple' ? '去三连' : '去关注', tip: this.inToy === false ? ['请在 B站 App 或电脑网页的游戏页面里操作'] : [k.kind === 'triple' ? '打开视频页，点赞、投币、收藏后回来' : '打开 UP 主的空间，关注后回来'],
        onClick: () => this.go(k.kind) });
    }
    // online unlocked: the check button turns gold into 开始联机 (at once if it already was when this opened)
    const canStart = Account.has('online') && (this.then || g.state !== 'play');
    if (!canStart) { this.goldFrom = 0; this.startOn = false; }
    else if (!this.startOn && !this.goldFrom) this.goldFrom = performance.now();
    if (canStart) this.widgets.push({ x: cx - 100, y: 196, w: 98, h: 20, gold: true, goldFrom: this.goldFrom, fromLabel: '我完成了，检查', label: '开始联机', onClick: () => this.start() });
    else if (Account.loggedIn) this.widgets.push({ x: cx - 100, y: 196, w: 98, h: 20, label: () => (Account.checking ? '正在检查…' : '我完成了，检查'), enabled: this.inToy === true && !Account.checking, onClick: () => this.check() });
    this.widgets.push({ x: Account.loggedIn ? cx + 2 : cx - 100, y: Account.loggedIn ? 196 : 224, w: Account.loggedIn ? 98 : 200, h: 20, label: '返回', onClick: () => this.back() });
  }
  start() {
    const g = this.game, t = this.then;
    Telemetry.count && Telemetry.count('unlock_start');
    if (t) { this.then = null; return t(); }
    g.ui.open(new MultiplayerScreen(g, this.parent instanceof TitleScreen ? this.parent : new TitleScreen(g)));
  }
  async go(kind) {
    const g = Account.gate || {};
    this.went = kind;
    try {
      if (kind === 'triple') await Toy.openVideo(g.videos[0]); else await Toy.openAuthor();
      this.say(Toy.backHint(kind));
      // (some hosts open it inside the same view: check again a little later too)
      setTimeout(() => { if (this.went === kind && this.game.ui.screen === this) { this.went = null; this.retries = 3; this.check(true); } }, 8000);
    } catch (e) { this.went = null; this.say(Toy.explain(e), true); }
    this.layout();
  }
  async check(quiet) {
    this.layout();
    try {
      const r = await Account.checkUnlocks();
      if (!r) return;
      const missing = !Account.allUnlocked();
      if (missing && this.retries > 0 && r.inToy) { this.retries--; setTimeout(() => { if (this.game.ui.screen === this) this.check(this.retries > 0); }, 4000); }
      if (!r.inToy) this.say('请在 B站 App 或电脑网页的游戏页面里检查', true);
      else if (!r.own && missing && !(r.got && r.got.length)) this.say('这里没登录你自己的 B站：用你的 B站 关注、三连后，在那台设备打开一次游戏就会同步', true);
      else if (r.error && r.follow === null && r.triple === null) this.say(Toy.explain(r.error), true);
      else if (r.got && r.got.length) this.say('解锁成功！', false);
      // (三连 asked for but not readable: said, not "all done")
      else if (Account.gate && Account.gate.videos && Account.gate.videos.length && r.triple === null && !Account.unlocks.triple) {
        this.say('没查到三连状态（' + (r.error ? Toy.explain(r.error) : 'B站没有返回能看懂的数据') + '），过一会儿再点检查', true);
      }
      else if (!quiet) {
        const t = Account.tripleParts, miss = [];
        if (t && !t.all) { if (!t.like) miss.push('点赞'); if (!t.coin) miss.push('投币'); if (!t.fav) miss.push('收藏'); }
        if (!Account.unlocks.follow) miss.push('关注');
        this.say(miss.length ? '还差：' + miss.join('、') + '（刚操作完可能要等几秒）' : '都完成了', !!miss.length);
      }
    } catch (e) { this.say(e.message, true); }
    if (this.game.ui.screen === this) this.layout();
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    if (this.reason) Font.center(c, fitText(this.reason, ui.w - 8), cx, 26, '#FFD24A');
    else Font.center(c, fitText('支持一下 UP 主，就能解锁披风、皮肤和联机', ui.w - 8), cx, 26, '#E0E0E0');
    for (const k of this.cards()) {
      drawCard(c, k.x, k.y, k.w, k.h, !k.done && k.on);
      if (k.kind === 'triple') { drawIcon(c, 'like', k.x + 8, k.y + 8, 1, '#FB7299'); drawIcon(c, 'coin', k.x + 18, k.y + 8, 1, '#FFD24A'); drawIcon(c, 'star', k.x + 28, k.y + 8, 1, '#FFD24A'); }
      else drawIcon(c, 'follow', k.x + 8, k.y + 8, 1, '#FB7299');
      Font.draw(c, k.title, k.x + (k.kind === 'triple' ? 40 : 20), k.y + 8, '#FFFFFF');
      Font.draw(c, fitText(k.sub, k.w - 16), k.x + 8, k.y + 22, '#A0A0A0');
      Font.draw(c, '解锁：', k.x + 8, k.y + 38, '#FFD24A');
      k.gives.forEach((t, i) => Font.draw(c, fitText(t, k.w - 16), k.x + 8, k.y + 50 + i * 10, '#E0E0E0'));
      // the capes it gives
      if (typeof Capes !== 'undefined') {
        const list = Capes.list.filter((p) => (k.kind === 'triple' ? !p.anim : p.anim)).slice(0, 4);
        list.forEach((p, i) => Capes.drawFlat(c, p.id, k.x + 8 + i * 26, k.y + 72, 2, !k.done));
      }
      if (k.done) { drawIcon(c, 'check', k.x + k.w - 30, k.y + k.h - 26, 2, '#55FF55'); Font.draw(c, '已完成', k.x + 10, k.y + k.h - 22, '#55FF55'); }
      else if (!k.on) Font.draw(c, '敬请期待', k.x + 10, k.y + k.h - 22, '#808080');
    }
    const on = Account.has('online');
    const y = 46 + 132 + 5;
    if (Account.loggedIn) Font.center(c, fitText(on ? (Account.has('jing') ? '✓ 联机和鲸鲸已解锁' : '✓ 联机已解锁') : (Account.gate && Account.gate.triple ? '三连 + 关注 = 解锁联机和鲸鲸' : '关注 = 解锁联机'), ui.w - 8), cx, y - 1, on ? '#55FF55' : '#FFD24A');
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, ui.h - 22 + (Account.loggedIn ? 0 : -6), this.noteColor);
    else if (this.inToy === false && Account.loggedIn) Font.center(c, fitText('在 B站 App 或电脑网页上打开游戏才能三连和关注；在别处用识别码登录时，按最后一次在 B站 检查到的状态', ui.w - 8), cx, ui.h - 22, '#A0A0A0');
  }
}

// ---- 诊断: the raw answers Bilibili gave (the field names of follow / 三连 are not documented) ----
class ToyDiagScreen extends MenuScreen {
  constructor(game, parent) { super(game, 'B站 接口诊断'); this.parent = parent; this.pauses = false; this.titleY = 12; this.lines = ['正在读取…']; this.run(); }
  async run() {
    const L = [], j = (v) => { try { return JSON.stringify(v); } catch (e) { return String(v); } };
    L.push('在 Toy 里：' + (await Toy.ready()) + (Toy.mock ? '（模拟）' : ''));
    const g = await Account.loadGate(true); L.push('联机门槛：' + j(g));
    try { const p = await Toy.profile(); L.push('用户：' + p.nickname + (p.toyOpenId ? '（有 toyOpenId）' : '（没有 toyOpenId）')); } catch (e) { L.push('用户：' + e.type + ' ' + e.message); }
    try { L.push('关注 → ' + (await Toy.following())); L.push('  原始：' + j(Toy.last.relation)); } catch (e) { L.push('关注：' + e.type + ' ' + e.message); }
    if (g.videos && g.videos.length) { try { L.push('三连 → ' + j(await Toy.triple(g.videos))); L.push('  原始：' + j(Toy.last.videoActions)); } catch (e) { L.push('三连：' + e.type + ' ' + e.message); } }
    try { L.push('能力：' + j(await Toy.abilities())); } catch (e) { L.push('能力：' + e.type); }
    this.lines = L; if (this.game.ui.screen === this) this.layout();
  }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  drawExtra(ui) {
    let y = 30;
    for (const t of this.lines) for (let s = String(t); s.length && y < ui.h - 36; y += 10) { let n = s.length; while (n > 1 && Font.width(s.slice(0, n)) > ui.w - 16) n--; Font.draw(ui.ctx, s.slice(0, n), 8, y, '#E0E0E0'); s = s.slice(n); }
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 离线游玩 chosen on the way into multiplayer: back where the player came from, and why online stays shut
function offlineBack(g, parent) {
  g.ui.open(parent || (g.state === 'play' ? null : new TitleScreen(g)));
  if (g.ui.toast) g.ui.toast('离线游玩', '只能玩单人游戏，联机要先登录（选项 → 账号）');
}
// ---- the way into multiplayer: an account, then the unlock (the service checks it again when joining) ----
// single player (the user, 2026-10-31): following the UP first, asked of Bilibili inside Toy each time. Only Bilibili's
// "not following" (or not logged in there) stops it - where it can't be asked (a phone's own browser, outside Toy) or
// the asking fails, the game opens as before, so a broken answer never locks everyone out
const SINGLE_OPEN = true;
async function singleGate(g, then, parent) {
  // single player is open to everyone, following or not (the user, 2026-11-03); the follow check below is kept for
  // if it ever comes back - multiplayer still asks for the account and its unlock
  if (SINGLE_OPEN) return then();
  // a super administrator (pinned by account id on the server, super.json) never waits here: the UP can't follow
  // themselves, and was kept out of single player (2026-11-01)
  if (Account.loggedIn && Account.data && Account.data.super) return then();
  // an account that has followed already (seen by the service): in by its identity code on another device, or with
  // another Bilibili user on this page, Bilibili said "not following" - multiplayer let it in, single player didn't
  // (feedback 2026-11-03)
  if (Account.loggedIn && Account.unlocks.follow) return then();
  if (!(await Promise.race([Toy.ready(), new Promise((r) => setTimeout(() => r(false), 2500))]))) return then();
  let f = null, err = null;
  try { f = await Toy.following(); } catch (e) { err = e; }
  // only one Bilibili says isn't following is asked; not logged in (a guest account, a browser not logged in to
  // Bilibili) the follow can't be seen at all - following changed nothing, a dead end (players' feedback 2026-10-31)
  if (f !== false || err) { if (err && err.type === 'not_logged_in') Telemetry.count && Telemetry.count('gate_single_guest'); return then(); }
  Telemetry.count && Telemetry.count('gate_single');
  g.ui.open(new FollowGateScreen(g, parent, then));
}
class FollowGateScreen extends MenuScreen {
  constructor(game, parent, then) {
    super(game, '关注 UP 主'); this.parent = parent; this.then = then; this.note = ''; this.noteColor = '#A0A0A0'; this.titleY = 40;
    // back from the UP's page: look again (a new follow can take a few seconds to show)
    this.onBack = () => { if (document.visibilityState === 'visible' && this.went && this.game.ui.screen === this) { this.went = false; this.retries = 3; setTimeout(() => this.check(true), 600); } };
    document.addEventListener('visibilitychange', this.onBack); window.addEventListener('focus', this.onBack);
  }
  close() { document.removeEventListener('visibilitychange', this.onBack); window.removeEventListener('focus', this.onBack); }
  back() { this.game.ui.open(this.parent || new TitleScreen(this.game)); }
  onEsc() { this.back(); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 2) + 10;
    this.widgets = [
      { x: cx - 100, y, w: 200, h: 20, gold: true, label: '去关注', onClick: () => this.go() },
      { x: cx - 100, y: y + 24, w: 98, h: 20, label: () => (this.checking ? '正在检查…' : '我关注了，检查'), enabled: !this.checking, onClick: () => this.check(false) },
      { x: cx + 2, y: y + 24, w: 98, h: 20, label: '返回', onClick: () => this.back() },
    ];
  }
  async go() {
    this.went = true;
    try { await Toy.openAuthor(); this.note = Toy.backHint('follow'); this.noteColor = '#A0A0A0'; }
    catch (e) { this.went = false; this.note = Toy.explain(e); this.noteColor = '#FF6060'; }
    setTimeout(() => { if (this.went && this.game.ui.screen === this) { this.went = false; this.retries = 3; this.check(true); } }, 8000);
  }
  async check(quiet) {
    if (this.checking) return;
    this.checking = true;
    let f = null, err = null;
    try { f = await Toy.following(); } catch (e) { err = e; }
    this.checking = false;
    if (this.game.ui.screen !== this) return;
    if (f === true || (f === null && !err)) { Telemetry.count && Telemetry.count('gate_single_ok'); const t = this.then; this.then = null; if (t) t(); return; }
    if (this.retries > 0) { this.retries--; setTimeout(() => { if (this.game.ui.screen === this) this.check(true); }, 4000); }
    if (!quiet || !this.retries) { this.note = err ? Toy.explain(err) : '还没查到关注（刚关注完可能要等几秒，再点一次检查）'; this.noteColor = '#FF6060'; }
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, y = Math.floor(ui.h / 2) - 40;
    Font.center(c, fitText('关注 UP 主「土豆味小哲」后就能玩单人游戏', ui.w - 8), cx, y, '#FFD24A');
    Font.center(c, fitText('在 B站 里关注完回到这里，会自动检查', ui.w - 8), cx, y + 14, '#E0E0E0');
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, y + 30, this.noteColor);
  }
}

async function onlineGate(g, then, parent) {
  const gate = await Account.loadGate();
  if (!gate.requireAccount && !gate.follow && !gate.triple) return then();
  // 默认本地账号（token=local，昵称“玩家”）不算登录：想联机必须注册/登录一个真实账号，避免房客改名冒充房主。
  if (!Account.loggedIn || Account.isLocal) { Telemetry.count && Telemetry.count('gate_login'); return g.ui.open(new LoginScreen(g, () => onlineGate(g, then, parent), () => offlineBack(g, parent))); }
  // (in Bilibili: checked again now - unfollowing locks it again)
  try { await Account.checkUnlocks(true); } catch (e) { }
  if (!Account.has('online')) {
    Telemetry.count && Telemetry.count('gate_unlock');
    return g.ui.open(new UnlockScreen(g, parent, gate.triple ? '联机需要关注 UP 主并给新视频三连（老视频的三连不算了）' : '联机需要关注 UP 主（取消关注后会重新锁上）', then));
  }
  then();
}
