'use strict';
// ---------------------------------------------------------------------------
// Everyday right-click uses of items in single player: axes strip logs and scrape copper (oxidation, wax),
// shovels make dirt paths, honeycomb waxes copper, glass bottles fill with water, dye colours sheep; bottles
// o' enchanting, wind charges and coloured eggs are thrown; ominous bottles are drunk; fireworks fly from the
// ground. Also the drops vanilla gives that the block list left out (kelp, creaking hearts, mushroom blocks).
// ---------------------------------------------------------------------------
const IU_STAGES = ['', 'exposed_', 'weathered_', 'oxidized_'];
// a copper block's family: { stage 0-3, waxed, key(stage, waxed) }
function copperInfo(key) {
  const m = /^(waxed_)?(exposed_|weathered_|oxidized_)?(.*copper.*)$/.exec(key);
  if (!m) return null;
  const rest = m[3], stage = IU_STAGES.indexOf(m[2] || '');
  const name = (st, wx) => {
    let k = rest === 'copper' || rest === 'copper_block' ? (st === 0 ? 'copper_block' : IU_STAGES[st] + 'copper') : IU_STAGES[st] + rest;
    if (wx) k = 'waxed_' + k;
    return BID[k] !== undefined ? k : null;
  };
  if (!name(stage, !!m[1]) || (!name(1, false) && !name(0, true))) return null;
  return { stage, waxed: !!m[1], name };
}
// replace a block keeping its state (facing, axis, half ...)
Game.prototype.swapBlock = function (x, y, z, newKey) {
  const w = this.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z), b = BLOCKS[id], nid = BID[newKey];
  if (nid === undefined) return false;
  let nm = m;
  if (b.states && BLOCKS[nid].states) { const r = Features.stateOf({ Name: newKey, Properties: b.states[m] || {} }); if (r) nm = r[1]; }
  w.setBlock(x, y, z, nid, nm);
  // a door's other half too
  if (b.door) { const oy = (m & 8) ? y - 1 : y + 1; if (w.getBlock(x, oy, z) === id) w.setBlock(x, oy, z, nid, w.getMeta(x, oy, z)); }
  this.flushMesh();
  return true;
};
const STRIP = /^(.*_(log|wood|stem|hyphae)|bamboo_block)$/;
const PATHABLE = new Set(['grass_block', 'dirt', 'podzol', 'mycelium', 'coarse_dirt', 'rooted_dirt']);
const DYE_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

Game.prototype.useOnBlockItem = function (held, def) {
  const p = this.player, t = this.target, w = this.world, k = def.key;
  if (!t || p.sneaking && false) return false;
  const [x, y, z] = t.pos, tb = BLOCKS[t.id], tk = tb.key, c = [x + 0.5, y + 0.5, z + 0.5];
  // axes: strip logs, scrape a copper stage off, take wax off
  if (def.tool && def.tool.type === 'axe') {
    if (STRIP.test(tk) && !tk.startsWith('stripped_') && BID['stripped_' + tk] !== undefined) { this.swapBlock(x, y, z, 'stripped_' + tk); Sound.ev('item.axe.strip', c, 1, 1); this.damageHeld(1); p.swing(); return true; }
    const cu = copperInfo(tk);
    if (cu && cu.waxed) { this.swapBlock(x, y, z, cu.name(cu.stage, false)); Sound.ev('item.axe.wax_off', c, 1, 1); this.particles.spawn('crit', ...c, 0, 0.1, 0); this.damageHeld(1); p.swing(); return true; }
    if (cu && cu.stage > 0) { this.swapBlock(x, y, z, cu.name(cu.stage - 1, false)); Sound.ev('item.axe.scrape', c, 1, 1); this.damageHeld(1); p.swing(); return true; }
  }
  // shovels: a path from grass or dirt (with air above)
  if (def.tool && def.tool.type === 'shovel' && PATHABLE.has(tk) && t.face !== 2 && !w.getBlock(x, y + 1, z) && BID.dirt_path !== undefined) {
    w.setBlock(x, y, z, BID.dirt_path, 0); Sound.ev('item.shovel.flatten', c, 1, 1); this.damageHeld(1); p.swing(); this.flushMesh(); return true;
  }
  // honeycomb: wax copper
  if (k === 'honeycomb') {
    const cu = copperInfo(tk);
    if (cu && !cu.waxed && cu.name(cu.stage, true)) {
      this.swapBlock(x, y, z, cu.name(cu.stage, true)); Sound.ev('item.honeycomb.wax_on', c, 1, 1);
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      p.swing(); return true;
    }
  }
  return false;
};
// throwables: bottles o' enchanting, wind charges, coloured eggs
class Thrown extends Arrow {
  constructor(game, x, y, z, vel, shooter, kind) { super(game, x, y, z, vel, shooter); this.kind = kind; this.snowball = ITEM_KEY[kind]; this.gravity = kind === 'wind_charge' ? 0 : undefined; }
  tick() {
    const was = this.dead;
    if (this.kind === 'wind_charge') { this.vel[1] += 0.05; } // no gravity: Arrow's fall taken back (it falls 0.05 a tick)
    super.tick();
    if (!was && (this.dead || this.stuck)) this.burst();
  }
  breakSnowball() { this.burst(); }
  burst() {
    if (this.burst_) return; this.burst_ = true; this.dead = true;
    const g = this.game, [x, y, z] = this.pos;
    if (this.kind === 'experience_bottle') {
      Sound.ev('entity.splash_potion.break', this.pos, 1, 1);
      for (let i = 0; i < 12; i++) g.particles.spawn('effect', x, y, z, (Math.random() - 0.5) * 0.4, Math.random() * 0.3, (Math.random() - 0.5) * 0.4, { col: [60, 140, 255] });
      g.dropXp(x, y, z, 3 + Math.floor(Math.random() * 5) + Math.floor(Math.random() * 5));
    } else if (this.kind === 'wind_charge') {
      // a burst of wind: everything near is thrown away from it, no blocks broken
      Sound.ev('entity.wind_charge.wind_burst', this.pos, 1, 1);
      for (let i = 0; i < 16; i++) g.particles.spawn('poof', x, y, z, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6);
      for (const e of [g.player, ...g.entities]) {
        if (!e || e.dead || !e.vel) continue;
        const dx = e.pos[0] - x, dy = e.pos[1] + (e.h || 1) / 2 - y, dz = e.pos[2] - z, d = Math.hypot(dx, dy, dz);
        if (d > 2.4 || d < 1e-3) continue;
        const f = (1 - d / 2.4) * 1.22;
        e.vel[0] += dx / d * f; e.vel[1] += dy / d * f + 0.3; e.vel[2] += dz / d * f;
        if (e === g.player) e.fallDist = 0;
      }
    } else { // eggs: a chick now and then
      for (let i = 0; i < 8; i++) g.particles.spawn('poof', x, y, z, (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2);
      if (Math.random() < 0.125) { const ch = new Mob(g, 'chicken', x, y, z).makeBaby(); ch.persistent = true; g.addEntity(ch); }
    }
  }
}
const _iuUseEquipment = Game.prototype.useEquipment;
Game.prototype.useEquipment = function (held, def) {
  const p = this.player, k = def && def.key;
  if (!held) return _iuUseEquipment.call(this, held, def);
  if (this.useOnBlockItem(held, def)) return true;
  const throwIt = (kind, speed, sound) => {
    const d = this.lookDir();
    const a = new Thrown(this, p.pos[0], p.pos[1] + p.eye() - 0.1, p.pos[2], d.map(v => v * speed), p, kind);
    this.entities.push(a);
    Sound.ev(sound, p.pos, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing();
  };
  if (k === 'experience_bottle') { throwIt(k, 0.7, 'entity.experience_bottle.throw'); return true; }
  if (k === 'wind_charge') { if ((p.windCd || 0) > this.tickCount) return true; p.windCd = this.tickCount + 10; throwIt(k, 1.5, 'entity.wind_charge.throw'); return true; }
  if (k === 'blue_egg' || k === 'brown_egg') { throwIt(k, 1.5, 'entity.egg.throw'); return true; }
  // glass bottle: water from a source (or a water cauldron)
  if (k === 'glass_bottle') {
    const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]], ft = this.raycast(eye, this.lookDir(), this.reach(), true);
    const w = this.world;
    // 龙息云：对准残留的龙息云右键，玻璃瓶收集为龙息瓶（云不被消耗）
    const cloud = this.entities.find(e => e.type === 'area_cloud' && !e.dead &&
      Math.hypot(p.pos[0] - e.pos[0], p.pos[2] - e.pos[2]) < e.radius + 0.5 &&
      Math.abs(p.pos[1] - e.pos[1]) < 2);
    if (cloud) {
      const br = { id: ITEM_KEY.dragon_breath, count: 1, dmg: 0 };
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = br; else if (p.inv.add(br)) this.dropFromPlayer(br); }
      Sound.ev('item.bottle.fill', p.pos, 1, 1); p.swing();
      return true;
    }
    let ok = false;
    if (ft && ft.id === WATER) ok = true;
    else if (ft && BLOCKS[ft.id].key === 'water_cauldron') { const lv = +Features.propOf(ft.id, w.getMeta(...ft.pos), 'level') || 1; if (lv > 1) w.setMeta(...ft.pos, Features.withProp(ft.id, w.getMeta(...ft.pos), 'level', lv - 1)); else w.setBlock(...ft.pos, BID.cauldron, 0); ok = true; }
    if (ok) {
      const pot = { id: ITEM_KEY.potion, count: 1, dmg: 0, pot: 'water' };
      if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = pot; else if (p.inv.add(pot)) this.dropFromPlayer(pot); }
      Sound.ev('item.bottle.fill', p.pos, 1, 1); p.swing();
    }
    return true;
  }
  // ominous bottle: drunk (32 ticks), gives bad omen
  if (k === 'ominous_bottle') { this.startUsing(held, 'main'); return true; }
  // a firework from the ground: up it goes, and bursts
  if (k === 'firework_rocket' && !p.gliding && this.target) {
    const t = this.target, D = DIRS[t.face], pt = t.point || [t.pos[0] + 0.5, t.pos[1] + 1, t.pos[2] + 0.5];
    this.entities.push(new FireworkRocket(this, pt[0] + D[0] * 0.1, pt[1] + D[1] * 0.1, pt[2] + D[2] * 0.1, held));
    Sound.ev('entity.firework_rocket.launch', pt, 3, 1);
    if (this.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    p.swing(); return true;
  }
  return _iuUseEquipment.call(this, held, def);
};
const _iuUsingTick = Game.prototype.usingTick;
Game.prototype.usingTick = function (st) {
  _iuUsingTick.call(this, st);
  const p = this.player;
  if (ITEMS[st.id].key === 'ominous_bottle') {
    if (p.useT % 4 === 0 && p.useT > 6) Sound.ev('entity.generic.drink', p.pos, 0.5, 1);
    if (p.useT >= 32) {
      p.addEffect('bad_omen', st.amp || 0, 120000);
      Sound.ev('item.ominous_bottle.dispose', p.pos, 1, 1);
      if (this.mode !== 'creative') { st.count--; if (!st.count) p.inv.slots[p.inv.sel] = null; }
      p.usingItem = null; p.useT = 0;
    }
  }
};
// a firework rocket: flies up for its flight time, then bursts
class FireworkRocket extends Entity {
  constructor(game, x, y, z, stack) {
    super(game, x, y, z, 0.25, 0.25);
    this.life = 10 * ((stack && stack.flight) || 1) + 6 + Math.floor(Math.random() * 6) + Math.floor(Math.random() * 7);
    this.vel = [(Math.random() - 0.5) * 0.023, 0.05, (Math.random() - 0.5) * 0.023];
    this.spriteLayer = T('i_firework_rocket');
  }
  tick() {
    this.savePrev(); this.age++;
    this.vel[0] *= 1.15; this.vel[2] *= 1.15; this.vel[1] += 0.04;
    for (let i = 0; i < 3; i++) this.pos[i] += this.vel[i];
    if (this.age % 2 === 0) this.game.particles.spawn('smoke', this.pos[0], this.pos[1] - 0.3, this.pos[2], 0, -0.05, 0);
    if (this.age >= this.life || this.world.getBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1]), Math.floor(this.pos[2]))) {
      this.dead = true;
      Sound.ev('entity.firework_rocket.blast', this.pos, 3, 1);
      for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, b = Math.acos(Math.random() * 2 - 1), s = 0.3; this.game.particles.spawn('crit', ...this.pos, Math.sin(b) * Math.cos(a) * s, Math.cos(b) * s, Math.sin(b) * Math.sin(a) * s); }
    }
  }
}
// dye on a sheep
const _iuMobInteract = Mob.prototype.interact;
Mob.prototype.interact = function (p, held) {
  const k = held && ITEMS[held.id] ? ITEMS[held.id].key : '';
  if (this.type === 'sheep' && /_dye$/.test(k) && !this.sheared) {
    const c = DYE_COLORS.indexOf(k.replace(/_dye$/, ''));
    if (c >= 0 && this.woolColor !== c) {
      this.woolColor = c; Sound.ev('item.dye.use', this.pos, 1, 1);
      if (this.game.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
      return true;
    }
  }
  return _iuMobInteract ? _iuMobInteract.call(this, p, held) : false;
};
// drops the block list doesn't give: kelp drops kelp, a creaking heart 1-3 resin clumps, mushroom blocks 0-2 mushrooms
for (const [k, fn] of [
  ['kelp', () => [['kelp', 1]]], ['kelp_plant', () => [['kelp', 1]]],
  ['creaking_heart', (m, r) => [['resin_clump', 1 + Math.floor(r() * 3)]]],
  ['brown_mushroom_block', (m, r) => [['brown_mushroom', Math.max(0, Math.floor(r() * 9) - 6)]]],
  ['red_mushroom_block', (m, r) => [['red_mushroom', Math.max(0, Math.floor(r() * 9) - 6)]]],
]) if (BID[k] !== undefined && (k !== 'creaking_heart' || ITEM_KEY.resin_clump !== undefined)) BLOCKS[BID[k]].drops = fn;

// ---- cakes (vanilla CakeBlock / CandleCakeBlock): right-clicked with anything (empty hand or not) a slice is eaten
// when the player can eat (hungry, or in creative): 2 food, 0.4 saturation, bites 0 -> 6 and then gone. An uneaten
// cake takes a candle; a candle cake is eaten like a whole cake and drops its candle, its lit candle is blown out by
// an empty hand clicking it (the upper half); flint and steel / a fire charge go on to light it
function eatCake(g, x, y, z, bites) {
  const p = g.player;
  if (!(p.creative || p.food < 20)) return false;
  p.food = Math.min(20, p.food + 2); p.saturation = Math.min(p.food, p.saturation + 2 * 0.1 * 2);
  const cake = BID.cake;
  if (bites < 6) g.world.setBlock(x, y, z, cake, Features.withProp(cake, 0, 'bites', String(bites + 1)));
  else g.world.setBlock(x, y, z, 0, 0);
  g.flushMesh && g.flushMesh();
  return true;
}
if (BID.cake !== undefined) BLOCKS[BID.cake].onUse = (g, x, y, z) => {
  const p = g.player, held = p.inv.held, k = keyOfStack(held), w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  const bites = +Features.propOf(id, m, 'bites') || 0;
  if (k && /^(.+_)?candle$/.test(k) && BID[k + '_cake'] !== undefined) {
    if (bites !== 0) return false;
    w.setBlock(x, y, z, BID[k + '_cake'], Features.withProp(BID[k + '_cake'], 0, 'lit', 'false'));
    if (g.mode !== 'creative') { held.count--; if (!held.count) p.inv.slots[p.inv.sel] = null; }
    Sound.ev('block.cake.add_candle', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
    return true;
  }
  return eatCake(g, x, y, z, bites);
};
for (const k in BID) if (/^(.+_)?candle_cake$/.test(k)) BLOCKS[BID[k]].onUse = (g, x, y, z, t) => {
  const p = g.player, held = p.inv.held, hk = keyOfStack(held), w = g.world, id = w.getBlock(x, y, z), m = w.getMeta(x, y, z);
  if (hk === 'flint_and_steel' || hk === 'fire_charge') return false;
  if (!held && t && t.point && t.point[1] - y > 0.5 && Features.propOf(id, m, 'lit') === 'true') {
    w.setBlock(x, y, z, id, Features.withProp(id, m, 'lit', 'false'));
    Sound.ev('block.candle.extinguish', [x + 0.5, y + 0.5, z + 0.5], 1, 1);
    return true;
  }
  if (!eatCake(g, x, y, z, 0)) return false;
  g.dropItem(x + 0.5, y + 0.5, z + 0.5, makeStack(BLOCKS[id].key.replace(/_cake$/, ''), 1));
  return true;
};

// ---- 结构方块（会话内选区复制 / 粘贴） -------------------------------------------------------
// 说明：复刻版没有用户结构 NBT 物化与跨存档结构库，这里提供本次会话内可用的基础工具——
// 以结构方块为基点，按偏移与尺寸读取选区方块存入内存，再按旋转粘贴到目标位置。
// 限制：不复制方块实体与实体；结构只保留在本次会话，不随云存档持久化；粘贴只写入已加载区块。
// ---- 结构方块（原版 1.10+ 界面）：四个模式标签 / 结构名称 / 偏移 / 尺寸，保存与加载一个长方体区域 ----
// STRUCT_CACHE 活在本次会话；同时写 localStorage（键按世界种子分开），刷新后仍能加载
const STRUCT_CACHE = new Map();
const STRUCT_MODES = ['corner', 'data', 'load', 'save'];
const STRUCT_MODE_CN = { corner: '角落', data: '数据', load: '加载', save: '保存' };
const structInt = (v) => String(Math.max(-48, Math.min(48, parseInt(v.replace(/[^0-9-]/g, ''), 10) || 0)));
const structDim = (v) => String(Math.max(1, Math.min(48, parseInt(v.replace(/[^0-9]/g, ''), 10) || 1)));
const structName = (v) => v.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 24);
function structKey(g, n) { const w = g.world; return 'mcjs.struct.' + (w ? (w.seedStr || w.seed) : 0) + '.' + n; }

class StructureBlockScreen extends MenuScreen {
  constructor(game, x, y, z) {
    super(game, null);
    this.titleY = 8;
    this.x = x; this.y = y; this.z = z;
    const w = game.world, id = w.getBlock(x, y, z);
    this.mode = STRUCT_MODES.indexOf(Features.propOf(id, w.getMeta(x, y, z), 'mode'));
    if (this.mode < 0) this.mode = 3;
    this.name = 'structure';
    this.ox = '0'; this.oy = '0'; this.oz = '0';
    this.w = '5'; this.h = '5'; this.d = '5';
    this.rot = 0; this.showBox = true; this.showAir = true; this.includeEntities = true; this.strict = false; this.mirror = 0; this.data = '';
    this.note = ''; this.noteColor = '#A0A0A0';
    this.fields = {}; this.field = null; this.rows = []; this.loading = false;
    this.blurBg = false; this.bgDim = 0.35;
    this.layout();
    this.refresh();
  }
  panel() { const u = this.game.ui, w = Math.min(u.w - 8, 316), h = Math.min(u.h - 8, 238); return { x: (u.w - w) / 2, y: Math.max(1, (u.h - h) / 2), w, h }; }
  async refresh() {
    if (this.loading) return;
    this.loading = true;
    try { this.rows = await SF.list(); } catch (e) { this.rows = []; }
    this.loading = false;
    if (this.game.ui.screen === this) this.layout();
  }
  layout() {
    const u = this.game.ui, p = this.panel();
    const sx = p.w / 316, sy = p.h / 238;
    const X = (v) => p.x + v * sx, Y = (v) => p.y + v * sy, W = (v) => v * sx, H = (v) => v * sy;
    const F = {};
    // 原版 26.2 的 StructureBlockEditScreen：名称 40px，相对位置 80px，尺寸 120px，模式/旋转/按钮 185px，
    // 确定/取消 210px。手机窄屏按面板宽高等比缩，触控热区仍跟着面板走。
    const name = { x: X(8), y: Y(40), w: W(300), h: H(20), label: '结构名称', max: 24, f: structName };
    if (this.mode !== 1) F.name = name;
    if (this.mode === 3 || this.mode === 2) {
      F.ox = { x: X(8), y: Y(80), w: W(60), h: H(20), label: '相对 X', max: 4, f: structInt, numeric: true };
      F.oy = { x: X(76), y: Y(80), w: W(60), h: H(20), label: '相对 Y', max: 4, f: structInt, numeric: true };
      F.oz = { x: X(144), y: Y(80), w: W(60), h: H(20), label: '相对 Z', max: 4, f: structInt, numeric: true };
    }
    if (this.mode === 3) {
      F.w = { x: X(8), y: Y(120), w: W(60), h: H(20), label: '尺寸 X', max: 2, f: structDim, numeric: true };
      F.h = { x: X(76), y: Y(120), w: W(60), h: H(20), label: '尺寸 Y', max: 2, f: structDim, numeric: true };
      F.d = { x: X(144), y: Y(120), w: W(60), h: H(20), label: '尺寸 Z', max: 2, f: structDim, numeric: true };
    }
    if (this.mode === 1) {
      F.data = { x: X(8), y: Y(40), w: W(300), h: H(20), label: '结构数据', max: 200, f: (v) => v };
    }
    if (this.mode === 2) {
      F.integrity = { x: X(8), y: Y(120), w: W(96), h: H(20), label: '完整性', max: 4, f: (v) => v.replace(/[^0-9.]/g, '').slice(0, 4) };
      F.seed = { x: X(108), y: Y(120), w: W(96), h: H(20), label: '种子', max: 10, f: (v) => v.replace(/[^0-9-]/g, '').slice(0, 10) };
    }
    this.fields = F;
    const bt = [];
    bt.push({ x: X(8), y: Y(185), w: W(90), h: H(20), label: '模式：' + STRUCT_MODE_CN[STRUCT_MODES[this.mode]], onClick: () => { const ord = [3, 2, 0, 1]; this.setMode(ord[(ord.indexOf(this.mode) + 1) % 4]); } });
    if (this.mode === 3) {
      bt.push({ x: X(208), y: Y(185), w: W(96), h: H(20), gold: true, label: '保存', onClick: () => this.doSave() });
      bt.push({ x: X(208), y: Y(120), w: W(96), h: H(20), label: '检测尺寸', onClick: () => this.detectSize() });
      bt.push({ x: X(208), y: Y(80), w: W(96), h: H(20), label: () => '显示空气：' + (this.showAir ? '开' : '关'), onClick: () => { this.showAir = !this.showAir; this.layout(); } });
      bt.push({ x: X(8), y: Y(160), w: W(96), h: H(20), label: () => '包含实体：' + (this.includeEntities ? '开' : '关'), onClick: () => { this.includeEntities = !this.includeEntities; this.layout(); } });
    } else if (this.mode === 2) {
      bt.push({ x: X(208), y: Y(160), w: W(96), h: H(20), gold: true, label: '加载', onClick: () => this.doLoad() });
      bt.push({ x: X(208), y: Y(120), w: W(96), h: H(18), label: () => '包含实体：' + (this.includeEntities ? '开' : '关'), onClick: () => { this.includeEntities = !this.includeEntities; this.layout(); } });
      bt.push({ x: X(208), y: Y(140), w: W(96), h: H(18), label: () => '严格模式：' + (this.strict ? '开' : '关'), onClick: () => { this.strict = !this.strict; this.layout(); } });
      bt.push({ x: X(8), y: Y(160), w: W(96), h: H(20), label: () => '镜像：' + ['无', '左右', '前后'][this.mirror], onClick: () => { this.mirror = (this.mirror + 1) % 3; this.layout(); } });
      [0, 90, 180, 270].forEach((deg, i) => bt.push({ x: X(108 + i * 24), y: Y(160), w: W(22), h: H(20), gold: this.rot === i, label: String(deg), onClick: () => { this.rot = i; this.layout(); } }));
      bt.push({ x: X(208), y: Y(80), w: W(96), h: H(20), label: () => '显示边界：' + (this.showBox ? '开' : '关'), onClick: () => { this.showBox = !this.showBox; this.syncBox(); this.layout(); } });
    } else if (this.mode === 1) {
      bt.push({ x: X(208), y: Y(120), w: W(96), h: H(20), label: '导出结构库', onClick: () => this.doExport() });
    }
    bt.push({ x: X(8), y: Y(210), w: W(144), h: H(20), gold: true, label: '完成', onClick: () => this.back() });
    bt.push({ x: X(164), y: Y(210), w: W(144), h: H(20), label: '取消', onClick: () => this.back() });
    this.widgets = bt;
    this.syncBox();
  }
  detectSize() {
    // 原版结构方块的 Detect 按钮：从角落方块向外扫已加载的非空气，最大 48；扫不到就按原版上限 48
    const w = this.game.world; let x1 = this.x + 1, y1 = this.y + 1, z1 = this.z + 1;
    for (let dy = 0; dy < 48; dy++) for (let dz = 0; dz < 48; dz++) for (let dx = 0; dx < 48; dx++) {
      if (w.getBlock(this.x + dx, this.y + dy, this.z + dz)) { x1 = Math.max(x1, this.x + dx); y1 = Math.max(y1, this.y + dy); z1 = Math.max(z1, this.z + dz); }
    }
    this.w = String(Math.max(1, Math.min(48, x1 - this.x + 1)));
    this.h = String(Math.max(1, Math.min(48, y1 - this.y + 1)));
    this.d = String(Math.max(1, Math.min(48, z1 - this.z + 1)));
    this.say('检测尺寸：' + this.w + '×' + this.h + '×' + this.d);
    this.layout();
  }
  syncBox() {
    const g = this.game;
    if (!g) return;
    if (!this.showBox || this.mode === 0 || this.mode === 1) { g.structBox = null; return; }
    const [ox, oy, oz, sw, sh, sd] = this.dims();
    g.structBox = { x0: this.x + ox, y0: this.y + oy, z0: this.z + oz, x1: this.x + ox + sw - 1, y1: this.y + oy + sh - 1, z1: this.z + oz + sd - 1 };
  }
  focus(k) {
    const u = this.game.ui, b = this.fields[k]; if (!b) return;
    this.field = k;
    u.showInput(b.x + 4, b.y + 4, b.w - 8, 12, this[k], () => { this.field = null; u.hideInput(); this.syncBox(); }, {
      onInput: (v) => { this[k] = b.f ? b.f(v) : v; this.syncBox(); },
      onEsc: () => { this.field = null; u.hideInput(); },
      max: b.max, numeric: b.numeric, select: true,
    });
  }
  mouseDown(ui, mx, my, btn) {
    for (const k in this.fields) { const r = this.fields[k]; if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) { this.focus(k); return; } }
    super.mouseDown(ui, mx, my, btn);
  }
  drawPanel(ui) {
    const c = ui.ctx, p = this.panel();
    c.fillStyle = 'rgba(8,8,8,0.94)'; c.fillRect(p.x, p.y, p.w, p.h);
    c.strokeStyle = '#000'; c.lineWidth = 2; c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    c.strokeStyle = '#5a5a5a'; c.lineWidth = 1; c.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
    Font.center(c, '结构方块', ui.w / 2, p.y + 7, '#FFFFFF');
  }
  drawFields(ui) {
    const c = ui.ctx;
    for (const k in this.fields) {
      const r = this.fields[k];
      Font.draw(c, r.label, r.x, r.y - 9, '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, String(this[k] || ''), r.x + 4, r.y + 4, '#E0E0E0');
    }
    if (this.note) Font.center(c, this.note, ui.w / 2, this.panel().y + this.panel().h - 9, this.noteColor);
  }
  draw(ui) {
    if (this.bgDim) ui.dim(this.bgDim);
    this.drawPanel(ui);
    for (const w of this.widgets) ui.button(w);
    this.drawFields(ui);
    const p = this.panel(), cx = ui.w / 2;
    Font.center(ui.ctx, STRUCT_MODE_CN[STRUCT_MODES[this.mode]] + '模式 · 原版结构方块', cx, p.y + 25, '#909090');
    if (this.mode === 2) {
      if (this.rows[0]) Font.center(ui.ctx, '最近：' + this.rows[0].name + '（' + this.rows[0].w + '×' + this.rows[0].h + '×' + this.rows[0].d + '）', cx, p.y + 137, '#808080');
    }
    for (const w of this.widgets) if (w.tip && ui.hit(w)) ui.tooltip(w.tip.map(t => ({ text: t })), ui.mouse.x, ui.mouse.y);
  }
  say(text, bad) { this.note = text; this.noteColor = bad ? '#FF6060' : '#A0A0A0'; }
  setMode(i) {
    if (i === this.mode) return;
    this.mode = i;
    const w = this.game.world, id = w.getBlock(this.x, this.y, this.z);
    w.setMeta(this.x, this.y, this.z, Features.withProp(id, w.getMeta(this.x, this.y, this.z), 'mode', STRUCT_MODES[i]));
    if (this.game.flushMesh) this.game.flushMesh();
    this.layout();
  }
  back() { this.game.ui.close(); }
  onEsc() { this.back(); }
  close() { this.game.structBox = null; this.game.ui.hideInput(); }
  dims() {
    const ox = parseInt(this.ox, 10) || 0, oy = parseInt(this.oy, 10) || 0, oz = parseInt(this.oz, 10) || 0;
    const sw = clamp(parseInt(this.w, 10) || 1, 1, 48), sh = clamp(parseInt(this.h, 10) || 1, 1, 48), sd = clamp(parseInt(this.d, 10) || 1, 1, 48);
    return [ox, oy, oz, sw, sh, sd];
  }
  async doSave() {
    const g = this.game, w = g.world;
    try {
      const [ox, oy, oz, sw, sh, sd] = this.dims();
      const bx = this.x + ox, by = this.y + oy, bz = this.z + oz;
      const blocks = new Array(sw * sh * sd).fill(null).map(() => [0, 0]); let noChunk = 0;
      for (let j = 0; j < sh; j++) for (let k = 0; k < sd; k++) for (let i = 0; i < sw; i++) {
        const X = bx + i, Y = by + j, Z = bz + k;
        if (!w.getChunk(X >> 4, Z >> 4)) { noChunk++; continue; }
        blocks[(j * sd + k) * sw + i] = [w.getBlock(X, Y, Z), w.getMeta(X, Y, Z)];
      }
      const data = SF.makeNbt({ w: sw, h: sh, d: sd, blocks });
      const rec = await SF.put(this.name, data, sw, sh, sd);
      STRUCT_CACHE.set(this.name, { w: sw, h: sh, d: sd, blocks });
      this.say('已保存「' + this.name + '」（' + sw + '×' + sh + '×' + sd + '，' + (rec.size / 1024).toFixed(0) + ' KB，3 天后过期）' + (noChunk ? '，' + noChunk + ' 格未加载' : ''));
      await this.refresh();
    } catch (e) { this.say(e.message || String(e), true); }
    Sound.click();
  }
  async resolve(name) {
    let st = STRUCT_CACHE.get(name);
    if (st) return st;
    const rec = await SF.get(name);
    const data = rec.data;
    let buf = data;
    if (new Uint8Array(data)[0] === 0x1f && new Uint8Array(data)[1] === 0x8b) buf = await sfGunzip(data);
    st = SF.readNbt(buf);
    STRUCT_CACHE.set(name, st);
    return st;
  }
  async doLoad() {
    const g = this.game, w = g.world;
    try {
      const st = await this.resolve(this.name);
      const [ox, oy, oz] = this.dims();
      const bx = this.x + ox, by = this.y + oy, bz = this.z + oz;
      const rot = this.rot, ow = st.w, od = st.d;
      const tw = (rot === 1 || rot === 3) ? od : ow, td = (rot === 1 || rot === 3) ? ow : od;
      let placed = 0, skipped = 0;
      for (let j = 0; j < st.h; j++) for (let i = 0; i < ow; i++) for (let k = 0; k < od; k++) {
        let tx, tz;
        if (rot === 1) { tx = k; tz = ow - 1 - i; }
        else if (rot === 2) { tx = ow - 1 - i; tz = od - 1 - k; }
        else if (rot === 3) { tx = od - 1 - k; tz = i; }
        else { tx = i; tz = k; }
        const X = bx + tx, Y = by + j, Z = bz + tz;
        if (X < bx || Z < bz || X >= bx + tw || Z >= bz + td) continue;
        if (!w.getChunk(X >> 4, Z >> 4)) { skipped++; continue; }
        const cell = st.blocks[(j * od + k) * ow + i] || [0, 0];
        if (w.setBlock(X, Y, Z, cell[0], cell[1], 2)) placed++;
      }
      if (g.flushMesh) g.flushMesh();
      this.say('已加载「' + this.name + '」：' + placed + ' 格' + (skipped ? '（' + skipped + ' 格区块未加载）' : ''));
    } catch (e) { this.say(e.message || String(e), true); }
    Sound.click();
  }
  async doExport() {
    try {
      const r = await SF.exportFile(this.name);
      this.say('已导出 ' + SF.safeName(this.name) + '.nbt（' + (r.gz / 1024).toFixed(0) + ' KB gzip）');
    } catch (e) { this.say(e.message || String(e), true); }
    Sound.click();
  }
  async doImport() {
    try {
      this.say('选择结构文件…');
      const r = await SF.pickImport();
      if (!r) return;
      if (r.error) throw r.error;
      const data = SF.makeNbt(r.struct);
      const rec = await SF.put(r.name, data, r.struct.w, r.struct.h, r.struct.d);
      this.name = r.name;
      STRUCT_CACHE.set(r.name, r.struct);
      this.say('已导入「' + r.name + '」（' + r.struct.w + '×' + r.struct.h + '×' + r.struct.d + '，' + (rec.size / 1024).toFixed(0) + ' KB）');
      await this.refresh();
      this.layout();
    } catch (e) { this.say(e.message || String(e), true); }
    Sound.click();
  }
}
if (BID.structure_block !== undefined) BLOCKS[BID.structure_block].onUse = (g, x, y, z) => {
  g.ui.open(new StructureBlockScreen(g, x, y, z));
  return true;
};

// 结构方块界面里的"显示边界"：世界里的那个蓝色线框（game.js 每帧调）
Game.prototype.drawStructBox = function () {
  const b = this.structBox;
  if (!b) return;
  const r = this.renderer, v = [];
  const x0 = b.x0, y0 = b.y0, z0 = b.z0, x1 = b.x1 + 1, y1 = b.y1 + 1, z1 = b.z1 + 1;
  const L = (a, c) => v.push(a[0], a[1], a[2], 0.35, 0.7, 1, 1, c[0], c[1], c[2], 0.35, 0.7, 1, 1);
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  for (let i = 0; i < 4; i++) { L(c[i], c[(i + 1) % 4]); L(c[i + 4], c[(i + 1) % 4 + 4]); L(c[i], c[i + 4]); }
  r.gl.enable(r.gl.DEPTH_TEST);
  r.drawLines(v, [0.35, 0.7, 1, 0.95]);
};

// ---- 更多“能放但不能用”的方块：潜影盒 / 末影箱 / 唱片机 / 拼图方块 -------------------------
// 潜影盒：和箱子共用 27 格容器；方块实体按 chest 结构保存，破坏后 contents 仍随方块实体走。
for (const k in BID) if (/_shulker_box$/.test(k) || k === 'shulker_box') {
  BLOCKS[BID[k]].onUse = (g, x, y, z, t) => {
    const be = g.getBlockEntity(x, y, z, 'chest');
    g.ui.open(new ChestScreen(g, [be], BLOCKS[t.id].cn));
    Sound.chest([x + 0.5, y + 0.5, z + 0.5], true);
    return true;
  };
}
if (BID.ender_chest !== undefined) BLOCKS[BID.ender_chest].onUse = (g, x, y, z) => {
  if (!g.player.enderSlots) g.player.enderSlots = new Array(27).fill(null);
  const be = { type: 'ender_chest', pos: [x, y, z], slots: g.player.enderSlots };
  g.ui.open(new ChestScreen(g, [be], '末影箱'));
  Sound.chest([x + 0.5, y + 0.5, z + 0.5], true);
  return true;
};
if (BID.jukebox !== undefined) BLOCKS[BID.jukebox].onUse = (g, x, y, z) => {
  const be = g.getBlockEntity(x, y, z, 'jukebox');
  const held = g.player.inv.slots[g.player.inv.sel];
  const disc = held && ITEMS[held.id] && /^music_disc_/.test(ITEMS[held.id].key || '');
  if (disc) {
    if (be.disc) g.dropItem(x + 0.5, y + 1, z + 0.5, be.disc);
    be.disc = held; g.player.inv.slots[g.player.inv.sel] = null;
    g.ui.message('已放入唱片：' + ITEMS[held.id].cn, '#AAAAAA');
    Sound.click();
  } else if (be.disc) {
    g.dropItem(x + 0.5, y + 1, z + 0.5, be.disc); be.disc = null;
    g.ui.message('已取出唱片', '#AAAAAA'); Sound.click();
  } else g.ui.message('手里没有唱片', '#FF5555');
  return true;
};

// 拼图方块：原版 1.16+ 的 Jigsaw GUI，可编辑 name / target / pool / final_state / joint。
// 这里把值保存在方块实体里；结构引擎仍按模板生成，但玩家放置的拼图方块不再是“点了没反应”。
class JigsawBlockScreen extends MenuScreen {
  constructor(game, x, y, z) {
    super(game, null);
    this.x = x; this.y = y; this.z = z;
    const be = game.getBlockEntity(x, y, z, 'jigsaw');
    this.name = be.name || 'minecraft:empty';
    this.target = be.target || 'minecraft:empty';
    this.pool = be.pool || 'minecraft:empty';
    this.final_state = be.final_state || 'minecraft:air';
    this.joint = be.joint || 'aligned';
    this.note = ''; this.field = null; this.fields = {};
    this.bgDim = 0.3; this.blurBg = false;
    this.layout();
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y0 = 34;
    this.fields = {
      name: { x: cx - 144, y: y0 + 10, w: 288, label: '名称', max: 64 },
      target: { x: cx - 144, y: y0 + 42, w: 288, label: '目标', max: 64 },
      pool: { x: cx - 144, y: y0 + 74, w: 288, label: '目标池', max: 64 },
      final_state: { x: cx - 144, y: y0 + 106, w: 288, label: '最终状态', max: 64 },
      joint: { x: cx - 144, y: y0 + 138, w: 288, label: '拼接类型（aligned / rollable）', max: 16 },
    };
    this.widgets = [
      { x: cx - 144, y: y0 + 168, w: 140, h: 20, gold: true, label: '保存', onClick: () => this.save() },
      { x: cx + 4, y: y0 + 168, w: 140, h: 20, label: '< 返回', onClick: () => this.back() },
    ];
  }
  focus(k) {
    const u = this.game.ui, b = this.fields[k]; if (!b) return;
    this.field = k;
    u.showInput(b.x + 4, b.y + 4, b.w - 8, 12, this[k], () => { this.field = null; u.hideInput(); }, {
      onInput: (v) => { this[k] = v; }, onEsc: () => { this.field = null; u.hideInput(); }, max: b.max,
    });
  }
  mouseDown(ui, mx, my, btn) {
    for (const k in this.fields) { const r = this.fields[k]; if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) { this.focus(k); return; } }
    super.mouseDown(ui, mx, my, btn);
  }
  draw(ui) {
    if (this.bgDim) ui.dim(this.bgDim);
    const c = ui.ctx, cx = ui.w / 2, p = { x: cx - 158, y: 1, w: 316, h: 240 };
    c.fillStyle = 'rgba(8,8,8,0.94)'; c.fillRect(p.x, p.y, p.w, p.h);
    c.strokeStyle = '#000'; c.lineWidth = 2; c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
    c.strokeStyle = '#5a5a5a'; c.lineWidth = 1; c.strokeRect(p.x + 2, p.y + 2, p.w - 4, p.h - 4);
    Font.center(c, '拼图方块', cx, p.y + 8, '#FFFFFF');
    for (const k in this.fields) {
      const r = this.fields[k];
      Font.draw(c, r.label, r.x, r.y - 9, '#A0A0A0');
      ui.nine(this.field === k ? 'text_field_hl' : 'text_field', r.x, r.y, r.w, r.h, 1);
      if (this.field !== k) Font.draw(c, String(this[k] || ''), r.x + 4, r.y + 4, '#E0E0E0');
    }
    for (const w of this.widgets) ui.button(w);
    if (this.note) Font.center(c, this.note, cx, p.y + p.h - 10, '#A0A0A0');
  }
  save() {
    const be = this.game.getBlockEntity(this.x, this.y, this.z, 'jigsaw');
    Object.assign(be, { name: this.name, target: this.target, pool: this.pool, final_state: this.final_state, joint: this.joint });
    this.note = '已保存到拼图方块的方块实体';
    Sound.click();
  }
  back() { this.game.ui.close(); }
  onEsc() { this.back(); }
  close() { this.game.ui.hideInput(); }
}
if (BID.jigsaw !== undefined) BLOCKS[BID.jigsaw].onUse = (g, x, y, z) => { g.ui.open(new JigsawBlockScreen(g, x, y, z)); return true; };
