'use strict';
// ---------------------------------------------------------------------------
// 开发者调试菜单 + 两个内置模组（连锁挖掘 / 矿透视）+ 联机房间的逐人模组权限
// 这些开关只影响本机手感和显示：不写进世界存档，也不会改变服务端的玩法。
// ---------------------------------------------------------------------------
const MODPERM_CHAT = '[MODP]';
const MODPERM_KEYS = ['chain', 'ore'];

function modPermNormalize(p) {
  return { chain: !!(p && p.chain), ore: !!(p && p.ore) };
}
// 服务器房间没有自定义消息协议：房主用一条看不见的聊天消息把权限广播给同一房间的人。
// 只有房间房主发的消息会被采纳，普通玩家的聊天不会改变权限。
function applyModPermChat(g, text, from) {
  text = String(text || '');
  if (!text.startsWith(MODPERM_CHAT)) return false;
  try {
    const owner = g && g.net && g.net.room && g.net.room.owner;
    if (owner && from && String(from).toLowerCase() !== String(owner).toLowerCase()) return true; // 吃掉，但不采纳
    const p = JSON.parse(text.slice(MODPERM_CHAT.length));
    if (p && typeof p.n === 'string' && MODPERM_KEYS.includes(p.k)) {
      g.netModPerms = g.netModPerms || {};
      const cur = modPermNormalize(g.netModPerms[p.n.toLowerCase()]);
      cur[p.k] = !!p.v;
      g.netModPerms[p.n.toLowerCase()] = cur;
    }
  } catch (e) { }
  return true;
}
function sendNetModPerm(g, name, key, on) {
  if (!(g.net && g.net.room && g.net.room.isOwner)) return;
  g.netModPerms = g.netModPerms || {};
  const cur = modPermNormalize(g.netModPerms[String(name).toLowerCase()]);
  cur[key] = !!on;
  g.netModPerms[String(name).toLowerCase()] = cur;
  try { g.net.send({ t: 'chat', text: MODPERM_CHAT + JSON.stringify({ n: name, k: key, v: !!on }) }); } catch (e) { }
}

(() => {
  // ---- 模组总开关：单机/房主看本地设置，房客看房主给的权限 ----
  Game.prototype.modUse = function (key) {
    if (this.p2pGuest) return !!(this.guestModPerms && this.guestModPerms[key]);
    if (this.net && this.net.room && !this.net.room.isOwner) {
      const p = this.netModPerms && this.netModPerms[String(this.net.name || '').toLowerCase()];
      return !!(p && p[key]);
    }
    return !!(key === 'chain' ? this.settings.modChain : this.settings.modOre);
  };
  Game.prototype.modSet = function (key, on) {
    if (this.p2pGuest) { this.ui.message('联机房间里模组由房主控制：请房主在 房间 → 模组权限 里打开', '#FFAA00'); return; }
    if (this.net && this.net.room && !this.net.room.isOwner) { this.ui.message('服务器房间里模组由房主控制', '#FFAA00'); return; }
    if (key === 'chain') this.settings.modChain = !!on;
    else this.settings.modOre = !!on;
    this.saveSettings();
    if (on) this.ui.message(key === 'chain' ? '连锁挖掘已开启：挖矿或砍树会带掉附近同类方块' : '矿透视已开启：附近的矿石会隔墙显示轮廓', '#55FF55');
  };
  Game.prototype.applyDevState = function () {
    const p = this.player; if (!p) return;
    const s = this.settings;
    p.noClip = !!(s.devNoClip || this.mode === 'spectator');
    if (s.devFly && this.mode !== 'spectator') p.flying = true;
    else if (!s.devFly && this.mode !== 'spectator') p.flying = false;
  };
  Game.prototype.devSetSpeed = function (v) {
    this.settings.devSpeed = clamp(Number(v) || 1, 0.25, 5);
    this.saveSettings();
  };

  // 每 tick 把开发者菜单里的飞行/穿墙状态续上（死亡重生、切换维度后也保持）
  const tick = Game.prototype.tick;
  Game.prototype.tick = function () {
    if (this.state === 'play' && this.player) {
      const s = this.settings;
      if (s.devNoClip && !this.player.noClip) this.player.noClip = true;
      if (!s.devNoClip && this.mode !== 'spectator' && this.player.noClip) this.player.noClip = false;
      if (s.devFly && this.mode !== 'spectator' && !this.player.flying) this.player.flying = true;
    }
    return tick.call(this);
  };

  // ---- 连锁挖掘 ----
  const CHAIN_RE = /(^|_)(log|wood|stem|hyphae)$/;
  Game.prototype.modChainAfter = function (x, y, z, id, b) {
    if (!this.modUse('chain') || this._chainGuard || !b) return;
    const key = String(b.key || '');
    if (!key.endsWith('_ore') && !CHAIN_RE.test(key) && key !== 'ancient_debris') return;
    const w = this.world, R = clamp(Math.round(Number(this.settings.modChainR) || 4), 1, 8);
    const cap = typeof TouchDevice !== 'undefined' && TouchDevice.kind === 'phone' ? 32 : 64;
    const q = [[x, y, z]], seen = new Set([x + ',' + y + ',' + z]), out = [];
    this._chainGuard = true; this._chainFast = true;
    try {
      while (q.length && out.length < cap) {
        const [cx, cy, cz] = q.shift();
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dy && !dz) continue;
          const nx = cx + dx, ny = cy + dy, nz = cz + dz;
          if (Math.max(Math.abs(nx - x), Math.abs(ny - y), Math.abs(nz - z)) > R) continue;
          const k = nx + ',' + ny + ',' + nz;
          if (seen.has(k)) continue; seen.add(k);
          if (w.getBlock(nx, ny, nz) !== id) continue;
          q.push([nx, ny, nz]); out.push([nx, ny, nz]);
        }
      }
      for (const [nx, ny, nz] of out) {
        if (this.state !== 'play') break;
        this.breakBlock(nx, ny, nz, false, true, true);
      }
      if (out.length) this.ui.actionBar = { text: '连锁挖掘：+' + out.length + ' 个方块', t: performance.now(), color: '#80FF80' };
    } finally { this._chainGuard = false; this._chainFast = false; }
    if (out.length) this.flushMesh();
  };

  // ---- 矿透视：只扫描玩家附近已加载的区块，按矿石类型画隔墙线框 ----
  const ORE_COLORS = {
    diamond: [0.25, 1, 1, 0.85], emerald: [0.25, 1, 0.45, 0.85], gold: [1, 0.85, 0.2, 0.85],
    iron: [1, 0.65, 0.55, 0.75], coal: [0.75, 0.75, 0.75, 0.7], redstone: [1, 0.25, 0.25, 0.8],
    lapis: [0.3, 0.5, 1, 0.8], copper: [1, 0.55, 0.3, 0.75], quartz: [0.95, 0.9, 0.8, 0.7],
    ancient_debris: [0.75, 0.45, 0.3, 0.9], other: [0.55, 0.95, 1, 0.7],
  };
  let oreIds = null;
  function oreSet() {
    if (oreIds) return oreIds;
    oreIds = new Set();
    for (const k in BID) if (/_ore$/.test(k) || k === 'ancient_debris') oreIds.add(BID[k]);
    return oreIds;
  }
  function oreColor(key) {
    if (/diamond/.test(key)) return ORE_COLORS.diamond;
    if (/emerald/.test(key)) return ORE_COLORS.emerald;
    if (/gold/.test(key)) return ORE_COLORS.gold;
    if (/iron/.test(key)) return ORE_COLORS.iron;
    if (/coal/.test(key)) return ORE_COLORS.coal;
    if (/redstone/.test(key)) return ORE_COLORS.redstone;
    if (/lapis/.test(key)) return ORE_COLORS.lapis;
    if (/copper/.test(key)) return ORE_COLORS.copper;
    if (/quartz/.test(key)) return ORE_COLORS.quartz;
    if (/ancient_debris/.test(key)) return ORE_COLORS.ancient_debris;
    return ORE_COLORS.other;
  }
  Game.prototype.scanOres = function (force) {
    const now = performance.now();
    if (!force && now - (this._oreAt || 0) < (typeof TouchDevice !== 'undefined' && TouchDevice.kind === 'phone' ? 2200 : 1200)) return this._oreCache || [];
    this._oreAt = now;
    if (!this.modUse('ore') || !this.world || !this.player) { this._oreCache = []; return []; }
    const R = clamp(Math.round(Number(this.settings.modOreR) || 4), 2, 8);
    const pcx = Math.floor(this.player.pos[0] / 16), pcz = Math.floor(this.player.pos[2] / 16);
    const ids = oreSet(), found = [], cap = typeof TouchDevice !== 'undefined' && TouchDevice.kind === 'phone' ? 120 : 240;
    for (const ch of this.world.chunks.values()) {
      if (Math.abs(ch.cx - pcx) > R || Math.abs(ch.cz - pcz) > R || !ch.bs) continue;
      for (let s = 0; s < ch.bs.length && found.length < cap; s++) {
        const sec = ch.bs[s]; if (!sec) continue;
        const full = sec.n === -1;
        if (!full) {
          let has = false;
          for (let k = 0; k < sec.n; k++) if (ids.has(sec.p[k])) { has = true; break; }
          if (!has) continue;
        }
        for (let j = 0; j < 4096 && found.length < cap; j++) {
          const id = full ? sec.d[j] : sec.p[sec.d[j]];
          if (!ids.has(id)) continue;
          const y = s * 16 + (j >> 8), x = ch.cx * 16 + (j & 15), z = ch.cz * 16 + ((j >> 4) & 15);
          found.push([x, y, z, id]);
        }
      }
    }
    this._oreCache = found;
    return found;
  };
  Game.prototype.drawModOverlay = function () {
    if (!this.modUse('ore') || this.ui.hideHud || this.perspective === 2) return;
    const list = this.scanOres(false), r = this.renderer, gl = r.gl;
    if (!list || !list.length) return;
    const groups = new Map();
    for (const [x, y, z, id] of list) {
      const b = BLOCKS[id], key = b ? b.key : '';
      const col = oreColor(key).join(',');
      if (!groups.has(col)) groups.set(col, []);
      const v = groups.get(col), e = 0.004;
      const [cr, cg, cb, ca] = col.split(',').map(Number);
      const c = [[x - e, y - e, z - e], [x + 1 + e, y - e, z - e], [x + 1 + e, y - e, z + 1 + e], [x - e, y - e, z + 1 + e], [x - e, y + 1 + e, z - e], [x + 1 + e, y + 1 + e, z - e], [x + 1 + e, y + 1 + e, z + 1 + e], [x - e, y + 1 + e, z + 1 + e]];
      const L = (a, b2) => v.push(a[0], a[1], a[2], cr, cg, cb, ca, b2[0], b2[1], b2[2], cr, cg, cb, ca);
      for (let i = 0; i < 4; i++) { L(c[i], c[(i + 1) % 4]); L(c[i + 4], c[(i + 1) % 4 + 4]); L(c[i], c[i + 4]); }
    }
    gl.disable(gl.DEPTH_TEST);
    try { for (const [col, v] of groups) r.drawLines(v, [1, 1, 1, 1]); }
    finally { gl.enable(gl.DEPTH_TEST); }
  };

  // 开发者菜单的“矿透视”开关立即刷新缓存，关掉时下一帧立刻消失
  const modSet = Game.prototype.modSet;
  Game.prototype.modSet = function (key, on) { modSet.call(this, key, on); if (key === 'ore') this._oreCache = null; };

  // ---- 玩家改名（单机/房主；联机客人把新名字发给房主） ----
  class DevNameScreen extends FormScreen {
    constructor(game, parent) {
      super(game, '玩家名字', parent);
      this.titleY = 18; this.note = '';
      this.name = game.playerName || '玩家';
    }
    layout() {
      const u = this.game.ui, cx = u.w / 2;
      this.fields = {};
      this.addField('name', cx - 150, 54, 300, '显示名字（最多 16 个字）', 16);
      this.widgets = [
        { x: cx - 100, y: u.h - 52, w: 200, h: 20, gold: true, label: '保存名字', onClick: () => this.submit() },
        { x: cx - 100, y: u.h - 30, w: 200, h: 20, label: '返回', onClick: () => this.back() },
      ];
      this.focus('name');
    }
    drawExtra(ui) { this.drawFields(ui); Font.center(ui.ctx, '只改显示名字：聊天、命令和玩家名牌会跟着变', ui.w / 2, 98, '#A0A0A0'); }
    submit() {
      const g = this.game, n = String(this.name || '').trim().slice(0, 16) || '玩家';
      g.settings.devName = n === ((typeof Account !== 'undefined' && Account.loggedIn) ? Account.name : '') ? '' : n;
      g.playerName = n; g.saveSettings();
      if (g.p2pGuest) { g.p2pGuest.name = n; g.p2pGuest.send({ t: 'rename', name: n }); }
      if (g.p2pHost) { try { g.p2pHost.sendRoster(); } catch (e) { } }
      if (g.net) { g.net.name = n; try { g.net.send({ t: 'rename', name: n }); } catch (e) { } }
      g.ui.hideInput();
      g.ui.message('名字已改为：' + n, '#55FF55');
      g.ui.open(this.parent);
    }
    back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
    onEsc() { this.back(); }
  }

  class DeveloperScreen extends OptionsListScreen {
    constructor(game, parent) { super(game, parent, '开发者调试', 'dev'); this.titleY = 12; }
    // 调试菜单只给管理员（账号网的 xpz）打开；普通玩家的选项里不显示入口
    static allowed() { return typeof Account !== 'undefined' && !!Account.isAdmin; }
    options() {
      if (!DeveloperScreen.allowed()) return [];
      const g = this.game, s = g.settings, onoff = (v) => v ? '开' : '关';
      const sl = (label, val, set, tip) => ({ slider: true, wide: true, value: val, label, onChange: (v) => { set(v); g.saveSettings(); }, tip });
      const bt = (label, fn, extra) => ({ label, onClick: () => { fn(); g.saveSettings(); }, ...extra });
      const guest = !!(g.p2pGuest || (g.net && g.net.room && !g.net.room.isOwner));
      const canMod = !guest;
      const modLabel = (key, name) => {
        if (!canMod) {
          const p = g.p2pGuest ? g.guestModPerms : (g.netModPerms && g.netModPerms[String(g.net.name || '').toLowerCase()]);
          return name + '：' + ((p && p[key]) ? '已允许（房主）' : '房主未允许');
        }
        return name + '：' + onoff(key === 'chain' ? s.modChain : s.modOre);
      };
      return [
        { text: '调试选项只影响本机，不改存档世界', x: this.game.ui.w / 2, y: 21, color: '#FFFF80' },
        sl(() => '移动速度：' + Number((Number(s.devSpeed) || 1).toFixed(2)) + '×', ((Number(s.devSpeed) || 1) - 0.25) / 4.75, (v) => s.devSpeed = Math.round((0.25 + v * 4.75) * 100) / 100, ['0.25×～5×；1× 是原版速度；走路、疾跑和飞行都会变', '只在本机生效，联机时别人看到的速度不会变']),
        sl(() => '额外交互距离：+' + (Number(s.devReach) || 0) + ' 格', (Number(s.devReach) || 0) / 8, (v) => s.devReach = Math.round(v * 8), ['创造模式默认 5 格、其余 4.5 格；只影响本机的挖放和点击']),
        bt(() => '飞行：' + onoff(s.devFly) + (g.mode === 'spectator' ? '（旁观自动）' : ''), () => { s.devFly = !s.devFly; g.applyDevState(); }, { tip: ['生存 / 创造里也能飞；关掉后落地会恢复重力', '联机时请只在测试时用，不要影响别人的正常游戏'] }),
        bt(() => '穿墙：' + onoff(s.devNoClip), () => { s.devNoClip = !s.devNoClip; g.applyDevState(); }, { tip: ['可以直接穿过方块，用来检查地形和结构', '开启时仍然会被边界和维度逻辑限制'] }),
        bt(() => '无敌：' + onoff(s.devGod), () => s.devGod = !s.devGod, { tip: ['玩家自己不受伤害（包括掉落、岩浆和溺水）', '联机客人默认没有这个开关'] }),
        bt(() => '时间：' + ({ 1000: '白天', 6000: '正午', 13000: '傍晚', 18000: '夜晚' }[g.worldTime] || '自定义'), () => { g.worldTime = ({ 1000: 6000, 6000: 13000, 13000: 18000, 18000: 1000 }[g.worldTime] || 1000); }, { tip: ['房主改时间会同步给同一房间的客人'] }),
        bt(() => '玩家名字：' + (g.playerName || '玩家') + '…', () => g.ui.open(new DevNameScreen(g, this)), { wide: true, tip: ['聊天、命令和头顶名牌都会用这个名字'] }),
        bt(() => modLabel('chain', '连锁挖掘'), () => g.modSet('chain', !g.modUse('chain')), { enabled: canMod, tip: canMod ? ['挖矿石或原木时，把附近相连的同类方块一起挖掉', '手机默认最多 32 个，电脑最多 64 个'] : ['房主可以在 暂停 → 房间 → 模组权限 里逐个允许'] }),
        bt(() => modLabel('ore', '矿透视'), () => g.modSet('ore', !g.modUse('ore')), { enabled: canMod, tip: canMod ? ['附近已加载区块里的矿石会隔墙显示彩色轮廓', '不改变方块本身，也不会自动挖矿'] : ['房主可以在 暂停 → 房间 → 模组权限 里逐个允许'] }),
        { slider: true, wide: true, value: (clamp(Number(s.modChainR) || 4, 1, 8) - 1) / 7, label: () => '连锁范围：' + clamp(Math.round(Number(s.modChainR) || 4), 1, 8) + ' 格', enabled: canMod, onChange: (v) => { s.modChainR = Math.round(1 + v * 7); g.saveSettings(); }, tip: ['以挖掉的方块为中心，最多向外找这么多格'] },
        { slider: true, wide: true, value: (clamp(Number(s.modOreR) || 4, 2, 8) - 2) / 6, label: () => '矿透范围：' + clamp(Math.round(Number(s.modOreR) || 4), 2, 8) + ' 个区块', enabled: canMod, onChange: (v) => { s.modOreR = Math.round(2 + v * 6); g.saveSettings(); g._oreCache = null; }, tip: ['范围越大扫描越慢；手机上建议 3~4 个区块'] },
        bt(() => '苹果皮（食物信息）：' + onoff(s.modAppleSkin !== false), () => s.modAppleSkin = s.modAppleSkin === false, { wide: true, tip: ['食物提示里显示饥饿值、饱和度和食用效果概率', '饥饿条上用金色覆盖显示当前饱和度；纯客户端显示'] }),
        bt('恢复调试默认值', () => {
          s.devSpeed = 1; s.devReach = 0; s.devFly = false; s.devNoClip = false; s.devGod = false; s.devName = '';
          s.modAppleSkin = true;
          g.applyDevState(); if (g.playerName) g.playerName = (typeof Account !== 'undefined' && Account.loggedIn ? Account.name : '玩家');
          g.ui.message('调试选项已恢复默认', '#FFFF55');
        }, { wide: true }),
      ];
    }
    layout() {
      super.layout();
    }
    // OptionsListScreen.place() 会在滚动后重建按钮；上下箭头必须在重建之后补回，否则点一次就消失
    place() {
      super.place();
      const u = this.game.ui, cx = u.w / 2;
      this.widgets.push({ x: cx - 135, y: u.h - 27, w: 24, h: 20, label: '↑', onClick: () => { this.scroll -= 75; this.place(); } });
      this.widgets.push({ x: cx + 111, y: u.h - 27, w: 24, h: 20, label: '↓', onClick: () => { this.scroll += 75; this.place(); } });
    }
  }

  // 房主：逐个房客开关模组。P2P 房间走 modperm 消息；服务器房间走隐藏的房间聊天广播。
  class ModPermScreen extends MenuScreen {
    constructor(game, parent, roomScreen) { super(game, '模组权限'); this.parent = parent; this.room = roomScreen || null; this.pauses = false; this.titleY = 10; this.page = 0; this.note = ''; }
    get H() { return this.game.p2pHost; }
    get players() {
      if (this.H) return [...this.H.peers.values()].filter((p) => p.joined).map((p) => p.name);
      const I = this.room && this.room.info, R = this.game.net && this.game.net.room;
      const all = (I && I.players) || (R && R.players) || [], owner = (I && I.owner) || (R && R.owner) || '';
      return all.filter((n) => String(n).toLowerCase() !== String(owner).toLowerCase());
    }
    perm(name) {
      if (this.H) return modPermNormalize(this.H.modPerm(name));
      const p = this.game.netModPerms && this.game.netModPerms[String(name).toLowerCase()];
      return modPermNormalize(p);
    }
    set(name, key) {
      const cur = this.perm(name);
      if (this.H) this.H.setModPerm(name, key, !cur[key]);
      else sendNetModPerm(this.game, name, key, !cur[key]);
      this.layout();
    }
    rows() { return Math.max(1, Math.floor((this.game.ui.h - (TouchDevice.kind === 'phone' ? 86 : 94)) / 24)); }
    layout() {
      const u = this.game.ui, cx = u.w / 2, ps = this.players, n = this.rows(), pages = Math.max(1, Math.ceil(ps.length / n));
      this.page = clamp(this.page, 0, pages - 1);
      this.widgets = [];
      ps.slice(this.page * n, this.page * n + n).forEach((name, i) => {
        const y = 38 + i * 24, p = this.perm(name), w = u.w < 360 ? 62 : 70;
        this.widgets.push(
          { x: cx + 6, y, w, h: 18, label: () => '连锁：' + (p.chain ? '开' : '关'), onClick: () => this.set(name, 'chain') },
          { x: cx + 6 + w + 4, y, w, h: 18, label: () => '矿透：' + (p.ore ? '开' : '关'), onClick: () => this.set(name, 'ore') },
        );
      });
      if (pages > 1) this.widgets.push(
        { x: cx + 6, y: 22, w: 26, h: 14, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
        { x: cx + 38, y: 22, w: 26, h: 14, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } },
      );
      this.widgets.push(
        { x: cx - 155, y: u.h - 52, w: 150, h: 20, label: '全部允许', enabled: ps.length > 0, onClick: () => { for (const name of ps) { const p = this.perm(name); if (!p.chain) this.set(name, 'chain'); if (!p.ore) this.set(name, 'ore'); } this.note = '已允许所有人的连锁和矿透'; this.layout(); } },
        { x: cx + 5, y: u.h - 52, w: 150, h: 20, label: '全部禁止', enabled: ps.length > 0, onClick: () => { for (const name of ps) { const p = this.perm(name); if (p.chain) this.set(name, 'chain'); if (p.ore) this.set(name, 'ore'); } this.note = '已禁止所有人的连锁和矿透'; this.layout(); } },
        { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      );
    }
    drawExtra(ui) {
      const c = ui.ctx, cx = ui.w / 2, ps = this.players, n = this.rows();
      Font.draw(c, '房主逐人控制：', cx - 155, 25, '#FFFF55');
      Font.draw(c, this.H ? '本地联机房间' : '服务器房间', cx - 72, 25, '#A0A0A0');
      if (!ps.length) Font.center(c, '现在还没有房客；有人进来后会出现在这里', cx, 60, '#A0A0A0');
      ps.slice(this.page * n, this.page * n + n).forEach((name, i) => {
        const y = 38 + i * 24;
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 155, y, 320, 18);
        Font.draw(c, fitText(name, 140), cx - 151, y + 5, '#FFFFFF');
      });
      const pages = Math.max(1, Math.ceil(ps.length / n));
      if (pages > 1) Font.draw(c, `第 ${this.page + 1}/${pages} 页`, cx + 70, 26, '#A0A0A0');
      Font.center(c, '关闭后，房客的模组按钮会立即失效；房主自己的开关在 选项 → 开发者调试 里', cx, ui.h - 72, '#909090');
      if (this.note) Font.center(c, this.note, cx, ui.h - 38, '#80FF80');
    }
    onEsc() { this.game.ui.open(this.parent); }
  }

  // 选项菜单里增加入口（原来的“聊天设置…”本来就没有实现，用这个入口替换）
  const optLayout = OptionsScreen.prototype.layout;
  OptionsScreen.prototype.layout = function () {
    optLayout.call(this);
    // 只有管理员账号能看到并打开开发者调试；普通玩家保留原来的“聊天设置…”占位
    if (!DeveloperScreen.allowed()) return;
    for (const w of this.widgets) {
      if (w.label === '聊天设置…' || (typeof w.label === 'string' && w.label === '聊天设置…')) {
        Object.assign(w, { label: '开发者调试…', enabled: true, tip: ['移动速度、飞行、穿墙、改名，以及连锁挖掘 / 矿透视'], onClick: () => this.game.ui.open(new DeveloperScreen(this.game, this)) });
      }
    }
  };

  // P2P 房主：在“联机房间”界面加一个模组权限入口
  const lrLayout = LocalRoomStatusScreen.prototype.layout;
  LocalRoomStatusScreen.prototype.layout = function () {
    lrLayout.call(this);
    const u = this.game.ui, cx = u.w / 2, H = this.H;
    if (!H) return;
    const compact = u.h < 220, n = 5, gap = 3;
    const bw = Math.min(compact ? 56 : 64, Math.floor((u.w - 16 - gap * (n - 1)) / n));
    const x0 = Math.floor(cx - (bw * n + gap * (n - 1)) / 2);
    // 把原来的四个按钮改成五个：复制邀请 / 邀请码 / 模组 / 设置 / 关闭
    const row = this.widgets.filter((w) => w.y === (compact ? 22 : 30) && w.h === 18);
    row.slice(0, 4).forEach((w, i) => { w.x = x0 + i * (bw + gap); w.w = bw; });
    const settings = row[2], close = row[3];
    if (settings && close) {
      settings.x = x0 + 3 * (bw + gap); settings.w = bw; settings.label = '设置';
      close.x = x0 + 4 * (bw + gap); close.w = bw; close.label = '关闭';
      this.widgets.push({ x: x0 + 2 * (bw + gap), y: compact ? 22 : 30, w: bw, h: 18, label: '模组', tip: ['逐个房客开关连锁挖掘和矿透视'], onClick: () => this.game.ui.open(new ModPermScreen(this.game, this, null)) });
    }
  };

  window.MODPERM_CHAT = MODPERM_CHAT;
  window.DeveloperScreen = DeveloperScreen;
  window.ModPermScreen = ModPermScreen;
  window.DevNameScreen = DevNameScreen;
})();
