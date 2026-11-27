'use strict';
// ---------------------------------------------------------------------------
// Skins (game/ACCOUNT_PLAN.md「皮肤系统」): preset skins (skins_data.js, loaded when needed) and a premium player's
// skin looked up by name (the room service asks Mojang: skin and arm model, never their cape). Classic (4 px) or slim
// (3 px) arms, the second layer, old 64 x 32 skins turned into 64 x 64 like vanilla; the first-person arm uses the
// skin too. In a room the web players tell each other what they wear (a 'look' message the room service passes on).
// Presets are free; a premium player's skin needs 三连 (Account.has('skin')); keeping a choice needs an account.
// ---------------------------------------------------------------------------
const Skins = (() => {
  const canv = new Map();   // id -> 64 x 64 canvas
  const loading = new Map();
  let presetsP = null;
  // ---- 本地导入的自定义皮肤（存 localStorage，不依赖上游）----
  const CUSTOM_KEY = 'mcjs-custom-skins';
  function customList() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch (e) { return []; } }
  function saveCustomList(l) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(l)); } catch (e) { } }
  function importCustom(img, slim) {
    const cv = normalize(img);
    const png = cv.toDataURL('image/png');
    const list = customList();
    const id = 'custom_' + Date.now().toString(36);
    list.push({ id, name: '自定义 ' + (list.length + 1), png, slim: !!slim });
    saveCustomList(list);
    cv.slim = !!slim;
    canv.set('u:' + id, cv);
    return 'u:' + id;
  }
  function removeCustom(id) {
    const key = id.startsWith('u:') ? id.slice(2) : id;
    saveCustomList(customList().filter((q) => q.id !== key));
    canv.delete('u:' + key);
  }
  // ---- 联机时对方发来的皮肤：只放在内存里，不写进本地皮肤列表 ----
  // (自定义皮肤原先只有一个本机编号 u:..., 对方没有同一份文件，只能画成史蒂夫；发送时改成 r:... 并带上 PNG)
  const remote = new Map();   // 'r:...' -> { png, slim }
  const MAX_PNG = 700000;
  const isPng = (v) => typeof v === 'string' && v.length <= MAX_PNG && /^data:image\/png;base64,/.test(v);
  // The PNG of a custom skin: the local list first; if this browser has no list (another device /
  // cleared site data), the copy saved with the account still lets the player look right.
  function customSkin(id) {
    if (!id || !id.startsWith('u:')) return null;
    const key = id.slice(2), c = customList().find((q) => q.id === key);
    if (c && isPng(c.png)) return c;
    const a = (typeof Account !== 'undefined' && Account.data && Account.data.skin) || null;
    if (a && a.skin === id && isPng(a.png)) return { png: a.png, slim: !!a.slim };
    return null;
  }
  function hashSkin(png, slim) {
    let h = 2166136261; const s = png + (slim ? '|1' : '|0');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'r:' + (h >>> 0).toString(36);
  }
  function presets() {
    if (self.SKIN_PRESETS) return Promise.resolve(self.SKIN_PRESETS);
    if (!presetsP) presetsP = new Promise((res) => { const s = document.createElement('script'); s.src = 'js/skins_data.js'; s.onload = () => res(self.SKIN_PRESETS || []); s.onerror = () => res([]); document.head.appendChild(s); });
    return presetsP;
  }
  // an image -> a 64 x 64 skin canvas (vanilla SkinTextureDownloader.processLegacySkin for 64 x 32 ones)
  // HD skins (128 x 128 / 256 x 256) are scaled down first; drawing 128 x 128 at (0, 0) on a
  // 64 x 64 canvas would keep only the top-left quarter and produce a broken model.
  function normalize(img) {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
    const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height;
    const legacy = sh * 2 === sw && sw >= 64 && sw % 2 === 0;
    const dw = 64, dh = legacy ? 32 : 64;
    x.drawImage(img, 0, 0, sw, sh, 0, 0, dw, dh);
    if (legacy) {
      const copy = (sx, sy, dx, dy, w, h) => { const d = x.getImageData(sx, sy, w, h), o = x.createImageData(w, h); for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let k = 0; k < 4; k++) o.data[(j * w + i) * 4 + k] = d.data[(j * w + (w - 1 - i)) * 4 + k]; x.putImageData(o, sx + dx, sy + dy); };
      copy(4, 16, 16, 32, 4, 4); copy(8, 16, 16, 32, 4, 4); copy(0, 20, 24, 32, 4, 12); copy(4, 20, 16, 32, 4, 12); copy(8, 20, 8, 32, 4, 12); copy(12, 20, 16, 32, 4, 12);
      copy(44, 16, -8, 32, 4, 4); copy(48, 16, -8, 32, 4, 4); copy(40, 20, 0, 32, 4, 12); copy(44, 20, -8, 32, 4, 12); copy(48, 20, -16, 32, 4, 12); copy(52, 20, -8, 32, 4, 12);
    }
    // the base layer has no see-through pixels; a hat drawn fully opaque (old skins) is no hat at all
    const d = x.getImageData(0, 0, 64, 64), p = d.data, A = (i, j) => p[(j * 64 + i) * 4 + 3];
    const opaque = (x0, y0, x1, y1) => { for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) p[(j * 64 + i) * 4 + 3] = 255; };
    opaque(0, 0, 32, 16); opaque(0, 16, 64, 32); opaque(16, 48, 48, 64);
    let full = true; for (let j = 0; j < 16 && full; j++) for (let i = 32; i < 64; i++) if (A(i, j) < 128) { full = false; break; }
    if (full) for (let j = 0; j < 16; j++) for (let i = 32; i < 64; i++) p[(j * 64 + i) * 4 + 3] = 0;
    x.putImageData(d, 0, 0);
    return cv;
  }
  const loadImg = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('皮肤图片读不出来')); im.src = src; });
  // a skin's canvas: 'p:<preset id>' or 'm:<premium name>' (loaded once, then from memory)
  function load(id) {
    if (canv.has(id)) return Promise.resolve(canv.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = (async () => {
      let src, slim = false;
      if (id.startsWith('p:')) { const s = (await presets()).find((q) => q.id === id.slice(2)); if (!s) throw new Error('没有这个皮肤'); src = s.png; slim = s.slim; }
      else if (id.startsWith('m:')) {
        let v = null; try { v = JSON.parse(localStorage.getItem('mcjs-skin-' + id.slice(2).toLowerCase()) || 'null'); } catch (e) { }
        if (!v || Date.now() - v.at > 86400e3) { v = await Account.api('/api/skin?name=' + encodeURIComponent(id.slice(2))); v.at = Date.now(); try { localStorage.setItem('mcjs-skin-' + id.slice(2).toLowerCase(), JSON.stringify(v)); } catch (e) { } }
        src = 'data:image/png;base64,' + v.png; slim = v.slim;
      }
      else if (id.startsWith('r:')) {
        const v = remote.get(id);
        if (!v) throw new Error('对方的皮肤还没收到');
        src = v.png; slim = !!v.slim;
      }
      else if (id.startsWith('u:')) {
        const c = customSkin(id);
        if (!c) throw new Error('自定义皮肤已删除');
        src = c.png; slim = !!c.slim;
      } else throw new Error('皮肤编号不对');
      const cv = normalize(await loadImg(src)); cv.slim = slim;
      canv.set(id, cv);
      return cv;
    })();
    loading.set(id, p);
    p.catch(() => loading.delete(id));
    return p;
  }
  // a look ({skin: id, slim, cape}) -> what to draw; skins still loading show Steve meanwhile
  const keyOf = (id) => 'skin_' + id.replace(/[^A-Za-z0-9_:]/g, '_');
  function tex(r, id) {
    if (!id) return 'steve';
    const k = keyOf(id);
    if (r.entityTex[k]) return k;
    const cv = canv.get(id);
    if (cv) { r.entityTex[k] = r.tex2D(cv, false); return k; }
    load(id).catch(() => { });
    return 'steve';
  }
  // this player's look: the preview being chosen, else the account's (a premium skin only once 三连 is done)
  let preview = null;
  function lookOf(g, e) {
    if (e === g.player) {
      if (preview) return preview;
      const s = Account.data && Account.data.skin;
      if (!s) return null;
      if (s.skin && s.skin.startsWith('m:') && !Account.has('skin')) return { skin: null, slim: false, cape: s.cape };
      return s;
    }
    return e.look || null;
  }
  function initModels(r) {
    if (r.models.steve_slim) return;
    const P = (parts) => { for (const p of parts) p.mesh = r.makeModelPart(p.boxes, 64, 64); return { parts }; };
    // slim arms (vanilla PlayerModel slim: 3 px wide, the pivot in the same place)
    r.models.steve_slim = P(r.models.steve.parts.map((p) => {
      if (p.name === 'rarm') return { name: 'rarm', pivot: [5.5, 22, 0], boxes: [[40, 16, -1.5, -10, -2, 3, 12, 4], [40, 32, -1.5, -10, -2, 3, 12, 4, 0.25]] };
      if (p.name === 'larm') return { name: 'larm', pivot: [-5.5, 22, 0], boxes: [[32, 48, -1.5, -10, -2, 3, 12, 4], [48, 48, -1.5, -10, -2, 3, 12, 4, 0.25]] };
      return { name: p.name, pivot: p.pivot, boxes: p.boxes, rotX: p.rotX, rotY: p.rotY, parent: p.parent };
    }));
    r.models.arm_slim = P([{ name: 'arm', pivot: [0, 0, 0], boxes: [[40, 16, -1.5, -10, -2, 3, 12, 4], [40, 32, -1.5, -10, -2, 3, 12, 4, 0.25]] }]);
    r.models.arm_left_slim = P([{ name: 'arm', pivot: [0, 0, 0], boxes: [[32, 48, -1.5, -10, -2, 3, 12, 4], [48, 48, -1.5, -10, -2, 3, 12, 4, 0.25]] }]);
  }
  const api = {
    presets, load, normalize, customList, importCustom, removeCustom,
    modelOf(g, e) { const l = lookOf(g, e); if (l && l.slim) { initModels(g.renderer); return 'steve_slim'; } return 'steve'; },
    texOf(g, e) { const l = lookOf(g, e); return tex(g.renderer, l && l.skin); },
    armOf(g, left) { const l = lookOf(g, g.player); if (l && l.slim) { initModels(g.renderer); return left ? 'arm_left_slim' : 'arm_slim'; } return left ? 'arm_left' : 'arm'; },
    setPreview(l) { preview = l; },
    preview() { return preview; },
    // what this player wears, for the others in a room (and the decorations it owns: cosmetics.js)
    mine(g) { const l = lookOf(g, g.player) || {}; return { skin: l.skin || null, slim: !!l.slim, cape: Capes.of(g, g.player), ...(typeof Cosmetics !== 'undefined' ? Cosmetics.mine(g) : {}) }; },
    // a look another game can draw without this machine's custom-skin list: a custom skin becomes an r:... id
    portable(g) {
      const l = lookOf(g, g.player) || {}, base = { skin: l.skin || null, slim: !!l.slim, cape: Capes.of(g, g.player), ...(typeof Cosmetics !== 'undefined' ? Cosmetics.mine(g) : {}) };
      if (base.skin && base.skin.startsWith('u:')) {
        const c = customSkin(base.skin);
        base.skin = c ? hashSkin(c.png, base.slim) : null;
      }
      return base;
    },
    // the same, with the PNG so the other side can draw it; send this only when the look changes
    share(g) {
      const l = lookOf(g, g.player) || {}, out = api.portable(g);
      if (l.skin && l.skin.startsWith('u:')) {
        const c = customSkin(l.skin);
        if (c && out.skin) out.png = c.png;
      }
      return out;
    },
    // take a peer's look: remember its PNG (once) and give back the compact look kept on the entity
    accept(l) {
      if (!l || typeof l !== 'object' || typeof l.skin !== 'string' || !l.skin.startsWith('r:') || !isPng(l.png)) return false;
      if (!remote.has(l.skin)) {
        remote.set(l.skin, { png: l.png, slim: !!l.slim });
        loadImg(l.png).then((im) => { const cv = normalize(im); cv.slim = !!l.slim; canv.set(l.skin, cv); }).catch(() => { });
      }
      return true;
    },
    // a cheap fingerprint of the look (no PNG): state messages only carry the look when this changes
    key(g) {
      const l = api.mine(g);
      return [l.skin || '', l.slim ? 1 : 0, l.cape || '', l.hat || '', l.pet || '', l.pre || ''].join('|');
    },
  };
  return api;
})();

// ---- in a room: tell the others what this player wears, and take theirs ----
(() => {
  // (hat, pet, pre: the decorations' names, cosmetics.js - the room service checked they are owned)
  const word = (v) => !v || /^[a-z]{3,16}$/.test(String(v));
  const skinOk = (v) => v === null || /^(p:[a-z_]{3,20}|m:[A-Za-z0-9_]{3,16}|u:[a-z0-9_]+|r:[a-z0-9]{4,16})$/.test(v || '');
  const pngOk = (l) => !l.png || (!!l.skin && l.skin.startsWith('r:') && typeof l.png === 'string' && l.png.length <= 700000 && /^data:image\/png;base64,/.test(l.png));
  const ok = (l) => l && typeof l === 'object' && skinOk(l.skin) && pngOk(l) && (!l.cape || Capes.info(l.cape)) && word(l.hat) && word(l.pet) && word(l.pre);
  const om = NetClient.prototype.onMessage;
  NetClient.prototype.onMessage = function (m) {
    if (m && m.t === 'look') {
      if (!ok(m.look)) return;
      if (m.look.png) Skins.accept(m.look);
      (this.looks || (this.looks = new Map())).set(String(m.name), { skin: m.look.skin || null, slim: !!m.look.slim, cape: m.look.cape || null, hat: m.look.hat || null, pet: m.look.pet || null, pre: m.look.pre || null });
      for (const e of this.g.entities) if (e.type === 'player' && e.name === m.name) e.look = this.looks.get(m.name);
      return;
    }
    const r = om.call(this, m);
    if (m && m.t === 'room') this.sendLook();
    return r;
  };
  NetClient.prototype.sendLook = function () { try { this.send({ t: 'look', look: Skins.share(this.g) }); } catch (e) { } };
  // a player who appears gets the look already known for its name
  const dm = Game.prototype.drawMob;
  Game.prototype.drawMob = function (e, ip, a, env, l) {
    if (e.type === 'player' && e !== this.player && !e.look && this.net && this.net.looks) e.look = this.net.looks.get(e.name) || null;
    return dm.call(this, e, ip, a, env, l);
  };
})();

// ---- 皮肤和装饰: a turning 3D preview, the skins, the capes, the hats, pets and name prefixes (cosmetics.js);
// locked ones say how to get them ----
class WardrobeScreen extends FormScreen {
  constructor(game, parent) {
    super(game, '皮肤和装饰', parent); this.titleY = 8;
    const s = (Account.data && Account.data.skin) || {};
    this.look = { skin: s.skin || null, slim: !!s.slim, cape: s.cape || null, hat: s.hat || null, pet: s.pet || null, pre: s.pre || null };
    this.tab = 'skin'; this.page = 0; this.mojang = s.skin && s.skin.startsWith('m:') ? s.skin.slice(2) : ''; this.list = [];
    this.customs = Skins.customList();
    // a custom skin saved with the account on another device is not in this browser's list; show it too
    if (s.skin && s.skin.startsWith('u:') && s.png && !this.customs.some((c) => 'u:' + c.id === s.skin)) {
      this.customs.push({ id: s.skin.slice(2), name: '已保存的自定义皮肤', png: s.png, slim: !!s.slim });
    }
    this.fileInput = null;
    this.yaw = 0.5; this.drag = null; this.busy = false;
    Skins.presets().then((l) => { this.list = l; for (const p of l) Skins.load('p:' + p.id).catch(() => { }); if (this.game.ui.screen === this) this.layout(); });
    Account.loadGate();
  }
  get dirty() {
    const s = (Account.data && Account.data.skin) || {};
    return (s.skin || null) !== this.look.skin || !!s.slim !== this.look.slim || ['cape', 'hat', 'pet', 'pre'].some((k) => (s[k] || null) !== (this.look[k] || null));
  }
  // a sign-in reward not owned yet: to the sign-in card (checkin.js), else a line saying how
  toCheckin(id) {
    if (this.giftOf(id) && typeof NewsBoard !== 'undefined') { NewsBoard.open(this.game, this, false); return; }
    if (typeof CheckinScreen !== 'undefined' && typeof Checkin !== 'undefined' && Checkin.shown()) this.game.ui.open(new CheckinScreen(this.game, this));
    else this.say('签到活动奖励：活动期间每天登录签到，累计签到就能领');
  }
  // how a locked sign-in reward is got: its day in the event's rewards as last read (checkin.js keeps it, also
  // across reloads; the server may change the order, so never hardcoded), else just that it's a reward
  // an announcement's gift (news.js): the published announcement that gives it
  giftOf(id) { return !!id && typeof NewsBoard !== 'undefined' && (NewsBoard.list || []).some((x) => x.gift === id && !x.draft); }
  evHow(id) {
    if (this.giftOf(id)) return ['公告里的礼物', '点一下去领取'];
    const st = typeof Checkin !== 'undefined' && Checkin.st, R = st && st.event && Array.isArray(st.event.rewards) ? st.event.rewards : [];
    const i = R.indexOf(id);
    return [i >= 0 ? '签到第 ' + (i + 1) + ' 天' : '签到活动奖励', ...(typeof Checkin !== 'undefined' && Checkin.shown() ? ['点一下去签到'] : [])];
  }
  pv() { const u = this.game.ui; return u.h < 210 ? { x: 6, y: 26, w: 60, h: 96 } : { x: Math.max(8, Math.floor(u.w / 2 - 190)), y: 26, w: 110, h: 170 }; }
  layout() {
    const u = this.game.ui, g = this.game, P = this.pv(), x0 = P.x + P.w + 10, W = Math.min(270, u.w - x0 - 8);
    const short = u.h < 210;
    this.fields = {}; this.widgets = [];
    const TABS = [['skin', '皮肤'], ['cape', '披风'], ['hat', '帽子'], ['pet', '宠物'], ['pre', '前缀']], tw = W / TABS.length;
    TABS.forEach(([k, cn], i) => this.widgets.push({ x: Math.round(x0 + i * tw), y: 24, w: Math.round(x0 + (i + 1) * tw) - Math.round(x0 + i * tw) - 2, h: 18, label: cn,
      color: this.tab === k ? '#FFFF55' : undefined, onClick: () => { this.tab = k; this.page = 0; this.layout(); } }));
    const cell = short ? 26 : 30, cols = Math.max(3, Math.floor(W / cell)), y0 = short ? 44 : 48;
    const maxRows = short ? Math.max(1, Math.floor((u.h - 34 - y0) / (cell + 12))) : 99;
    if (this.tab === 'skin') {
      const items = [
        { id: null, name: '默认（史蒂夫）', slim: false },
        ...this.list.filter((p) => p.own).map((p) => ({ id: 'p:' + p.id, name: p.name, slim: !!p.slim })),
        ...this.customs.map((c) => ({ id: 'u:' + c.id, name: c.name, slim: !!c.slim, custom: true })),
      ];
      items.slice(0, cols * maxRows).forEach((p, i) => {
        const cx = x0 + (i % cols) * cell, cy = y0 + Math.floor(i / cols) * (cell + 2);
        this.widgets.push({ x: cx, y: cy, w: cell - 2, h: cell - 2, label: '', skinIcon: p.id, sel: p.id === this.look.skin, tip: [p.name + (p.slim ? '（纤细）' : '（经典）')],
          onClick: () => { this.look.skin = p.id; this.look.slim = !!p.slim; this.layout(); } });
      });
      if (!short) {
      const yy = y0 + Math.ceil(items.length / cols) * (cell + 2) + 6;
      this.widgets.push({ x: x0, y: yy, w: W, h: 18, label: () => '手臂：' + (this.look.slim ? '纤细（3 像素，Alex）' : '经典（4 像素，Steve）'), onClick: () => { this.look.slim = !this.look.slim; } });
      this.widgets.push({ x: x0, y: yy + 24, w: W, h: 20, gold: true, label: () => (this.busy ? '正在导入…' : '导入本地皮肤 PNG'), enabled: !this.busy, onClick: () => this.pickLocalSkin() });
      this.addField('mojang', x0, yy + 48, W, '正版玩家名（3–16 位字母/数字/下划线）', 16, (v) => v.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16));
      this.widgets.push({ x: x0, y: yy + 72, w: W, h: 20, label: () => (this.busy ? '正在查找…' : '按正版名加载皮肤'), enabled: !this.busy, onClick: () => this.useMojang() });
      }
    } else if (this.tab === 'cape') {
      const items = [{ id: null, name: '不穿披风' }, ...Capes.list.filter((c) => !c.admin || Capes.unlocked(c.id))];
      items.slice(0, cols * Math.max(1, Math.floor((u.h - 34 - y0) / (cell + 12)))).forEach((c, i) => {
        const cx = x0 + (i % cols) * cell, cy = y0 + Math.floor(i / cols) * (cell + 12);
        const locked = c.id && !Capes.unlocked(c.id);
        // (the sign-in event's capes: owned once signed for, not unlocked by 三连 / following)
        const how = c.ev ? this.evHow('cape:' + c.id) : [c.anim ? '关注 UP 主解锁' : '给视频三连解锁', '点一下去解锁'];
        this.widgets.push({ x: cx, y: cy, w: cell - 2, h: cell + 8, label: '', capeIcon: c.id, locked, sel: c.id === this.look.cape,
          tip: [c.name + (c.anim ? '（动态）' : ''), ...(locked ? how : [])],
          onClick: () => { if (locked && c.ev) this.toCheckin('cape:' + c.id); else if (locked) g.ui.open(new UnlockScreen(g, this, c.anim ? '关注 UP 主就能穿上动态披风' : '给视频三连就能穿上静态披风')); else { this.look.cape = c.id; this.layout(); } } });
      });
    } else {
      // hats, pets, name prefixes (cosmetics.js): 'none' first, then each with its icon; all sign-in rewards for now
      const k = this.tab, C = typeof Cosmetics !== 'undefined' ? Cosmetics : null;
      const items = [{ id: null, name: { hat: '不戴帽子', pet: '不带宠物', pre: '不用前缀' }[k] }, ...(C ? C.LIST.filter((d) => d.kind === k) : [])];
      items.slice(0, cols * maxRows).forEach((d, i) => {
        const cx = x0 + (i % cols) * cell, cy = y0 + Math.floor(i / cols) * (cell + 2);
        const v = d.id ? d.id.split(':')[1] : null, locked = !!d.id && !C.has(d.id);
        this.widgets.push({ x: cx, y: cy, w: cell - 2, h: cell - 2, label: '', cosIcon: d.id, locked, sel: v === (this.look[k] || null),
          tip: [d.name, ...(locked ? this.evHow(d.id) : [])],
          onClick: () => { if (locked) this.toCheckin(d.id); else { this.look[k] = v; this.layout(); } } });
      });
    }
    this.widgets.push(
      { x: P.x, y: u.h - 28, w: 110, h: 20, label: () => (this.busy ? '正在保存…' : this.dirty ? '保存' : '已保存'), gold: this.dirty, enabled: !this.busy && this.dirty, onClick: () => this.saveLook() },
      { x: P.x + 116, y: u.h - 28, w: 110, h: 20, label: '返回', onClick: () => this.back() },
    );
  }
  async useMojang() {
    const n = nameOnly(this.mojang || '');
    if (n.length < 3) { this.say('输入正版玩家名（3–16 个英文字母、数字或下划线）', true); return; }
    this.busy = true; this.say('正在查找 ' + n + ' 的皮肤…'); this.layout();
    try { const cv = await Skins.load('m:' + n); this.look.skin = 'm:' + n; this.look.slim = !!cv.slim; this.say('找到了：' + n + (cv.slim ? '（纤细手臂）' : '（经典手臂）')); }
    catch (e) { this.say(e.message, true); }
    this.busy = false; this.layout();
  }
  pickLocalSkin() {
    if (!this.fileInput) {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/png,image/x-png'; inp.style.display = 'none';
      inp.onchange = () => this.onLocalSkin(inp.files && inp.files[0]);
      document.body.appendChild(inp); this.fileInput = inp;
    }
    this.fileInput.value = ''; this.fileInput.click();
  }
  async onLocalSkin(file) {
    if (!file) return;
    this.busy = true; this.layout();
    try {
      const im = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('图片读不出来，请换一张 PNG 皮肤')); im.src = URL.createObjectURL(file); });
      const id = Skins.importCustom(im, this.look.slim);
      this.customs = Skins.customList();
      this.look.skin = id;
      this.say('已导入皮肤');
      // 登录玩家导入后直接上传到账号：换设备登录时不必再手动点保存
      if (Account.loggedIn && !Account.isLocal) await this.saveLook();
    } catch (e) { this.say(e.message, true); }
    this.busy = false; this.layout();
  }
  async saveLook() {
    if (!Account.loggedIn) { this.game.ui.open(new LoginScreen(this.game, () => this.game.ui.open(this))); return; }
    this.busy = true; this.layout();
    try {
      const look = { ...this.look };
      // keep the custom PNG with the account, so a reload / another device can still show it
      if (look.skin && look.skin.startsWith('u:')) {
        const c = Skins.customList().find((q) => 'u:' + q.id === look.skin);
        const a = Account.data && Account.data.skin;
        const png = (c && c.png) || (a && a.skin === look.skin && a.png);
        if (png) look.png = png;
      }
      await Account.update({ skin: look }, { strict: true });
      this.say(Account.isLocal ? '已保存到本机' : '已保存到网站，换设备登录后也能看到');
      if (this.game.net && typeof this.game.net.sendLook === 'function') this.game.net.sendLook();
    }
    catch (e) {
      // 本地已经保留这份皮肤，只是网站没写进去：不要再说“已保存”
      this.say('网站同步失败，皮肤只保存在这台设备：' + e.message, true);
    }
    this.busy = false; this.layout();
  }
  back() { Skins.setPreview(null); super.back(); }
  mouseDown(ui, mx, my, b) { const P = this.pv(); if (mx >= P.x && mx < P.x + P.w && my >= P.y && my < P.y + P.h) { this.drag = { x: mx, yaw: this.yaw }; return; } super.mouseDown(ui, mx, my, b); }
  mouseMove(ui, mx, my) { if (this.drag && ui.mouse.down) this.yaw = this.drag.yaw + (mx - this.drag.x) * 0.03; else super.mouseMove(ui, mx, my); }
  mouseUp(ui) { this.drag = null; super.mouseUp(ui); }
  draw(ui) {
    // the widgets with pictures (skins' faces, capes) are drawn here; the rest as usual
    // (the tooltips last, over the pictures: FormScreen.draw puts them right after the buttons)
    const pics = this.widgets.filter((w) => w.skinIcon !== undefined || w.capeIcon !== undefined || w.cosIcon !== undefined);
    const tips = this.widgets.filter((w) => w.tip);
    for (const w of tips) { w.tip0 = w.tip; w.tip = null; }
    try { super.draw(ui); } finally { for (const w of tips) { w.tip = w.tip0; delete w.tip0; } }
    const c = ui.ctx;
    for (const w of pics) {
      c.strokeStyle = w.sel ? '#FFFFFF' : '#555555'; c.lineWidth = 1; c.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
      if (w.skinIcon !== undefined) {
        const img = w.skinIcon ? this.faceOf(w.skinIcon) : this.game.renderer.images.steve;
        if (img) { c.drawImage(img, 8, 8, 8, 8, w.x + 4, w.y + 4, w.w - 8, w.h - 8); c.drawImage(img, 40, 8, 8, 8, w.x + 3, w.y + 3, w.w - 6, w.h - 6); }
      } else if (w.capeIcon) { Capes.drawFlat(c, w.capeIcon, w.x + 4, w.y + 3, 2, w.locked); if (w.locked) drawIcon(c, 'lock', w.x + w.w - 11, w.y + w.h - 11, 1, '#FFD24A'); }
      else if (w.cosIcon) { Cosmetics.drawIcon(c, w.cosIcon, w.x + 2, w.y + 2, w.w - 4, w.locked); if (w.locked) drawIcon(c, 'lock', w.x + w.w - 11, w.y + w.h - 11, 1, '#FFD24A'); }
      else Font.center(c, '无', w.x + w.w / 2, w.y + w.h / 2 - 4, '#A0A0A0');
    }
    for (const w of tips) if (ui.hit(w)) ui.tooltip(w.tip.map((t) => ({ text: t })), ui.mouse.x, ui.mouse.y);
  }
  faceOf(id) { const s = this.faceCache || (this.faceCache = new Map()); if (s.has(id)) return s.get(id); Skins.load(id).then((cv) => s.set(id, cv)).catch(() => { }); return null; }
  drawExtra(ui) {
    const c = ui.ctx, P = this.pv(), g = this.game;
    drawCard(c, P.x - 2, P.y - 2, P.w + 4, P.h + 4, false);
    // the turning preview (it turns by itself unless dragged)
    if (!this.drag) this.yaw += 0.01;
    Skins.setPreview(this.look);
    const cv = g.renderer.playerPreview(g, ui, P.x, P.y, P.w, P.h, { yaw: this.yaw });
    Skins.setPreview(null);
    if (cv) { c.imageSmoothingEnabled = false; c.drawImage(cv, P.x, P.y, P.w, P.h); }
    // (on the prefix page: the name as others will see it)
    if (this.tab === 'pre' && typeof Cosmetics !== 'undefined') Font.center(c, fitText(Cosmetics.preChar(this.look.pre) + ((Account.loggedIn && Account.name) || '玩家'), P.w - 4), P.x + P.w / 2, P.y + 4, '#FFFFFF');
    Font.center(c, '拖动可以转动', P.x + P.w / 2, P.y + P.h + 4, '#808080');
    this.drawFields(ui);
    if (!Account.loggedIn) Font.center(c, fitText('登录后才能保存（换设备、联机时别人也能看到）', ui.w - 8), ui.w / 2, ui.h - 42, '#FFD24A');
  }
}
