'use strict';
// ---------------------------------------------------------------------------
// 上一批“能放但不能用”方块的原版交互：刷怪笼、堆肥桶、炼药锅、蜂箱、雕纹书架、
// 饰纹陶罐、营火、潮涌核心、重生锚、制箭台、末地传送门框。界面尽量沿用原版容器/面板，
// 全部改动直接写方块实体和方块状态，因此能随存档保存。
// ---------------------------------------------------------------------------
(() => {
const keyOf = (st) => (st && ITEMS[st.id] ? ITEMS[st.id].key : '');
const one = (g, p) => { if (g.mode !== 'creative' && p.inv.held) { p.inv.held.count--; if (!p.inv.held.count) p.inv.slots[p.inv.sel] = null; } };
const prop = (w, x, y, z, k) => Features.propOf(w.getBlock(x, y, z), w.getMeta(x, y, z), k);
const setProp = (w, x, y, z, k, v) => { const id = w.getBlock(x, y, z); w.setBlock(x, y, z, id, Features.withProp(id, w.getMeta(x, y, z), k, v)); };

// ---- 小型容器：给雕纹书架、饰纹陶罐、营火用；不依赖原版 176×166 的贴图尺寸 ----
class SmallContainerScreen extends ContainerScreen {
  constructor(game, be, title, count, cols = 9) {
    const n = Math.max(1, count), c = Math.min(cols, n), rows = Math.ceil(n / c);
    super(game, null, 12 + c * 18, 26 + rows * 18 + 6 + 3 * 18 + 4 + 18 + 8, title);
    this.be = be; this.count = n; this.cols = c; this.rows = rows;
    for (let i = 0; i < n; i++) this.slots.push({
      x: 8 + (i % c) * 18, y: 18 + Math.floor(i / c) * 18,
      get: () => be.slots[i], set: (s) => { be.slots[i] = s; }, group: 'container', idx: i,
    });
    this.addPlayerSlots(26 + rows * 18 + 6, 26 + rows * 18 + 6 + 3 * 18 + 4);
  }
  drawBase(ui) {
    ui.dim(0.6);
    const c = ui.ctx, x = this.x, y = this.y;
    c.fillStyle = 'rgba(16,16,16,0.92)'; c.fillRect(x, y, this.gw, this.gh);
    c.strokeStyle = '#000'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, this.gw - 2, this.gh - 2);
    c.strokeStyle = '#5a5a5a'; c.lineWidth = 1; c.strokeRect(x + 2, y + 2, this.gw - 4, this.gh - 4);
    if (this.title) Font.draw(c, this.title, x + 8, y + 6, '#E0E0E0', false);
  }
  drawExtra(ui) { Font.draw(ui.ctx, '物品栏', this.x + 8, this.y + 26 + this.rows * 18, '#A0A0A0', false); }
  close() { this.game.markBlockEntity(this.be); }
}

// 雕纹书架：6 格；书放进去会改变纹理状态（这里只存物品，状态由 renderer 读方块实体）
if (BID.chiseled_bookshelf !== undefined) {
  BLOCKS[BID.chiseled_bookshelf].onUse = (g, x, y, z) => {
    const be = g.getBlockEntity(x, y, z, 'chiseled_bookshelf');
    if (!be.slots) be.slots = new Array(6).fill(null);
    g.ui.open(new SmallContainerScreen(g, be, '雕纹书架', 6, 6));
    Sound.ev('block.wood.hit', [x + .5, y + .5, z + .5], 1, 1); return true;
  };
}
// 饰纹陶罐：原版只有一个物品格（可被漏斗/发射器放入），右键打开查看
if (BID.decorated_pot !== undefined) {
  BLOCKS[BID.decorated_pot].onUse = (g, x, y, z) => {
    const be = g.getBlockEntity(x, y, z, 'decorated_pot');
    if (!be.slots) be.slots = [null];
    g.ui.open(new SmallContainerScreen(g, be, '饰纹陶罐', 1, 1));
    Sound.ev('block.stone.hit', [x + .5, y + .5, z + .5], 1, 1); return true;
  };
}

// 营火 / 灵魂营火：四个烹饪格；右键把食物放进去，空手取出
for (const k of ['campfire', 'soul_campfire']) {
  if (BID[k] === undefined) continue;
  BLOCKS[BID[k]].onUse = (g, x, y, z) => {
    const be = g.getBlockEntity(x, y, z, 'campfire');
    if (!be.slots) be.slots = new Array(4).fill(null);
    g.ui.open(new SmallContainerScreen(g, be, BLOCKS[BID[k]].cn, 4, 4));
    Sound.ev('block.fire.ambient', [x + .5, y + .5, z + .5], 1, 1); return true;
  };
}

// ---- 刷怪笼：原版界面里的“生成实体”一项；tickSpawners 读取方块实体里的 spawnEntity ----
class SpawnerScreen extends MenuScreen {
  constructor(game, x, y, z) {
    super(game, '刷怪笼'); this.x = x; this.y = y; this.z = z;
    const be = game.getBlockEntity(x, y, z, 'spawner'); this.type = be.spawnEntity || SPAWNER_MOBS[game.world.getMeta(x, y, z) & 7] || 'zombie'; this.note = '';
    this.layout();
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, types = ['zombie', 'skeleton', 'spider', 'blaze', 'cave_spider', 'silverfish'];
    this.widgets = types.map((t, i) => ({ x: cx - 150 + (i % 3) * 102, y: 50 + Math.floor(i / 3) * 26, w: 96, h: 20, gold: this.type === t,
      label: (TYPES_CN[t] || t), onClick: () => { this.type = t; this.layout(); } }));
    this.widgets.push({ x: cx - 150, y: u.h - 34, w: 140, h: 20, gold: true, label: '保存', onClick: () => this.save() },
      { x: cx + 10, y: u.h - 34, w: 140, h: 20, label: '返回', onClick: () => this.back() });
  }
  draw(ui) {
    ui.dim(.35); const c = ui.ctx, cx = ui.w / 2;
    c.fillStyle = 'rgba(12,12,12,.94)'; c.fillRect(cx - 170, 20, 340, 124);
    Font.center(c, '刷怪笼', cx, 30, '#FFFFFF');
    Font.center(c, '选择要生成的生物；走近后每 20 秒左右生成一批', cx, 42, '#A0A0A0');
    for (const w of this.widgets) ui.button(w);
    if (this.note) Font.center(c, this.note, cx, 130, '#80FF80');
  }
  save() {
    const be = this.game.getBlockEntity(this.x, this.y, this.z, 'spawner');
    be.type = 'spawner'; be.spawnEntity = this.type;
    const id = this.game.world.getBlock(this.x, this.y, this.z);
    if (id === BID.spawner) { const si = SPAWNER_MOBS.indexOf(this.type); this.game.world.setMeta(this.x, this.y, this.z, si >= 0 ? si : 0); }
    this.note = '已保存：' + (TYPES_CN[this.type] || this.type); Sound.click();
  }
  back() { this.game.ui.close(); }
  onEsc() { this.back(); }
}
const TYPES_CN = { zombie: '僵尸', skeleton: '骷髅', spider: '蜘蛛', blaze: '烈焰人', cave_spider: '洞穴蜘蛛', silverfish: '蠹虫' };
if (BID.spawner !== undefined) BLOCKS[BID.spawner].onUse = (g, x, y, z) => { g.ui.open(new SpawnerScreen(g, x, y, z)); return true; };

// 让 tickSpawners 优先读方块实体的 spawnEntity（原来只按 meta 的 0..3）
const _spawnTick = Game.prototype.tickSpawners;
Game.prototype.tickSpawners = function () {
  const w = this.world, p = this.player;
  if (w && p) for (let cx = (Math.floor(p.pos[0]) >> 4) - 1; cx <= (Math.floor(p.pos[0]) >> 4) + 1; cx++)
    for (let cz = (Math.floor(p.pos[2]) >> 4) - 1; cz <= (Math.floor(p.pos[2]) >> 4) + 1; cz++) {
      const ch = w.getChunk(cx, cz); if (!ch || !ch.findAll) continue;
      const list = ch.spawners || (ch.spawners = []);
      if (!list.length) ch.findAll([BID.spawner], (i) => list.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)]));
      for (const s of list) { const be = this.blockEntities.get(s.join(',')); if (be && be.spawnEntity) { const si = SPAWNER_MOBS.indexOf(be.spawnEntity); if (si >= 0) w.setMeta(s[0], s[1], s[2], si); } }
    }
  return _spawnTick.call(this);
};

// ---- 堆肥桶：可堆肥物品提高 level，满了收骨粉 ---- 
const COMPOST = /^(.*(sapling|leaves|seeds|wheat|carrot|potato|beetroot|kelp|melon|pumpkin|mushroom|vine|fern|grass|flower|bread|apple|berries|cactus|bamboo|lily_pad|hay_block|brown_mushroom|red_mushroom|nether_wart|chorus|egg|cookie|cake|pie)$)|.*_(wool| carpet)$/;
if (BID.composter !== undefined) BLOCKS[BID.composter].onUse = (g, x, y, z) => {
  const w = g.world, p = g.player, held = p.inv.held, k = keyOf(held), level = +prop(w, x, y, z, 'level') || 0;
  if (!held) { g.ui.message('堆肥桶等级：' + level + ' / 7', '#AAAAAA'); return true; }
  if (COMPOST.test(k)) {
    one(g, p); setProp(w, x, y, z, 'level', String(Math.min(7, level + 1)));
    Sound.ev('block.composter.fill_success', [x + .5, y + .5, z + .5], 1, 1);
    if (level + 1 >= 7) {
      setProp(w, x, y, z, 'level', '0');
      if (p.inv.add(makeStack('bone_meal', 1))) g.ui.message('堆肥完成，获得骨粉', '#55FF55');
    }
    p.swing(); return true;
  }
  if (k === 'bone_meal' && level >= 7) { one(g, p); setProp(w, x, y, z, 'level', '0'); g.dropItem(x + .5, y + 1, z + .5, makeStack('bone_meal', 1)); return true; }
  g.ui.message('这个物品不能堆肥', '#FF5555'); return true;
};

// ---- 炼药锅：水/熔岩/细雪桶装填，空桶取出，玻璃瓶取水瓶 ---- 
if (BID.cauldron !== undefined) {
  const use = (g, x, y, z) => {
    const w = g.world, p = g.player, held = p.inv.held, k = keyOf(held), own = BLOCKS[w.getBlock(x, y, z)].key;
    if (k === 'water_bucket') { one(g, p); w.setBlock(x, y, z, BID.water_cauldron, Features.withProp(BID.water_cauldron, 0, 'level', '3')); return true; }
    if (k === 'lava_bucket') { one(g, p); w.setBlock(x, y, z, BID.lava_cauldron, 0); return true; }
    if (k === 'powder_snow_bucket') { one(g, p); w.setBlock(x, y, z, BID.powder_snow_cauldron, Features.withProp(BID.powder_snow_cauldron, 0, 'level', '3')); return true; }
    if (k === 'bucket') {
      one(g, p);
      const out = own === 'water_cauldron' ? 'water_bucket' : own === 'lava_cauldron' ? 'lava_bucket' : own === 'powder_snow_cauldron' ? 'powder_snow_bucket' : null;
      const st = out && ITEM_KEY[out] !== undefined ? makeStack(out, 1) : null;
      if (st) { if (p.inv.add(st)) p.inv.slots[p.inv.sel] = st; } else p.inv.slots[p.inv.sel] = makeStack('bucket', 1);
      w.setBlock(x, y, z, BID.cauldron, 0); Sound.ev('item.bucket.empty', [x, y, z], 1, 1); return true;
    }
    if (k === 'glass_bottle' && own === 'water_cauldron') { one(g, p); p.inv.slots[p.inv.sel] = makeStack('potion', 1); g.ui.message('装了一瓶水', '#AAAAAA'); return true; }
    g.ui.message(own === 'cauldron' ? '空炼药锅' : '炼药锅：' + BLOCKS[BID[own]].cn, '#AAAAAA'); return true;
  };
  for (const k of ['cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron']) if (BID[k] !== undefined) BLOCKS[BID[k]].onUse = use;
}

// ---- 蜂箱 / 蜂巢：玻璃瓶取蜂蜜，剪刀取蜂巢，空手查看蜂蜜等级 ---- 
for (const k of ['beehive', 'bee_nest']) {
  if (BID[k] === undefined) continue;
  BLOCKS[BID[k]].onUse = (g, x, y, z) => {
    const w = g.world, p = g.player, held = p.inv.held, h = keyOf(held), lv = +prop(w, x, y, z, 'honey_level') || 0;
    if (h === 'glass_bottle' && lv >= 5) { one(g, p); p.inv.add({ ...makeStack('honey_bottle', 1) }); setProp(w, x, y, z, 'honey_level', '0'); Sound.ev('item.bottle.fill', [x, y, z], 1, 1); g.ui.message('装了一瓶蜂蜜', '#FFD24A'); return true; }
    if (h === 'shears' && lv >= 5) { g.damageHeld(1); p.inv.add(makeStack('honeycomb', 1)); setProp(w, x, y, z, 'honey_level', '0'); Sound.ev('block.beehive.shear', [x, y, z], 1, 1); return true; }
    g.ui.message('蜂蜜等级：' + lv + ' / 5' + (lv >= 5 ? '（可以用玻璃瓶或剪刀采集）' : ''), '#AAAAAA');
    return true;
  };
}

// ---- 潮涌核心：至少 16 个海晶石/海晶灯包围时激活，给附近玩家潮涌能量 ---- 
if (BID.conduit !== undefined) BLOCKS[BID.conduit].onUse = (g, x, y, z) => {
  const w = g.world; let n = 0;
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) {
    const id = w.getBlock(x + dx, y + dy, z + dz), k = BLOCKS[id] && BLOCKS[id].key;
    if (k && (k.includes('prismarine') || k === 'sea_lantern')) n++;
  }
  if (n >= 16) { g.ui.message('潮涌核心已激活（海晶石 ' + n + ' 块）', '#55FFFF'); if (g.player.addEffect) g.player.addEffect('conduit_power', 20 * 60, 0); }
  else g.ui.message('潮涌核心还需要海晶石框架：现在 ' + n + ' / 16 块', '#FF5555');
  return true;
};

// ---- 重生锚：荧石充能，主世界右键会爆炸；下界/末地可设置重生点 ---- 
if (BID.respawn_anchor !== undefined) BLOCKS[BID.respawn_anchor].onUse = (g, x, y, z) => {
  const w = g.world, p = g.player, held = p.inv.held, k = keyOf(held), c = +prop(w, x, y, z, 'charges') || 0;
  if (k === 'glowstone' || k === 'glowstone_dust') { if (c >= 4) { g.ui.message('重生锚已经充满', '#FF5555'); return true; } one(g, p); setProp(w, x, y, z, 'charges', String(c + 1)); Sound.ev('block.respawn_anchor.charge', [x, y, z], 1, 1); return true; }
  if (g.dim === 'overworld' && c > 0) { w.setBlock(x, y, z, 0, 0); g.explode(x + .5, y + .5, z + .5, 5); return true; }
  if (c > 0) { p.spawn = [x + .5, y + 1, z + .5]; p.bedSpawn = p.spawn; g.ui.message('重生点已设置', '#55FF55'); return true; }
  g.ui.message('先用荧石给重生锚充能', '#FF5555'); return true;
};

// ---- 制箭台：打开 3×3 工作台（箭、弓、弩等配方都在同一张配方表里） ---- 
if (BID.fletching_table !== undefined) BLOCKS[BID.fletching_table].onUse = (g) => { g.ui.open(new CraftingScreen(g, 3)); return true; };

// ---- 末地传送门框：放入末影之眼，十二个框都装好后生成 3×3 传送门 ---- 
if (BID.end_portal_frame !== undefined) {
  BLOCKS[BID.end_portal_frame].onUse = (g, x, y, z) => {
    const w = g.world, p = g.player, held = p.inv.held, k = keyOf(held);
    const eyeAt = (ax, ay, az) => (w.getMeta(ax, ay, az) & 4) !== 0;
    // an already filled frame does not stop the check: if all 12 were filled before (or a portal
    // failed to open), clicking any frame again must still complete the ring
    if (!eyeAt(x, y, z)) {
      if (k !== 'ender_eye' && k !== 'eye_of_ender') { g.ui.message('需要末影之眼', '#FF5555'); return true; }
      one(g, p); w.setMeta(x, y, z, w.getMeta(x, y, z) | 4); Sound.ev('block.end_portal_frame.fill', [x, y, z], 1, 1);
    }
    // 找出与这个框连成一片的框架，用整圈框架的包围盒当中心。旧代码把刚点的框当中心，
    // 再按 5×5 去角去数，框永远数不够，于是 12 个眼都装好也不会开门。
    const group = [], seen = new Set(), queue = [[x, z]];
    seen.add(x + ',' + z);
    while (queue.length) {
      const [ax, az] = queue.pop();
      group.push([ax, az]);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = ax + dx, nz = az + dz, key = nx + ',' + nz;
        if (seen.has(key) || Math.abs(nx - x) > 5 || Math.abs(nz - z) > 5) continue;
        if (w.getBlock(nx, y, nz) === BID.end_portal_frame) { seen.add(key); queue.push([nx, nz]); }
      }
    }
    let x0 = x, x1 = x, z0 = z, z1 = z, eyes = 0;
    for (const [ax, az] of group) {
      if (ax < x0) x0 = ax; if (ax > x1) x1 = ax; if (az < z0) z0 = az; if (az > z1) z1 = az;
      if (eyeAt(ax, y, az)) eyes++;
    }
    const fw = x1 - x0 + 1, fd = z1 - z0 + 1;
    // Two closed shapes are accepted: vanilla's 5×5 ring with the four corners left open (12 frames),
    // and a full 4×4 ring (also 12 frames, the compact one players build by hand). No frame inside.
    let ring = false;
    const inside = (ax, az) => ax > x0 && ax < x1 && az > z0 && az < z1;
    if (fw === 5 && fd === 5) {
      ring = group.length === 12;
      if (ring) for (const [ax, az] of group) if ((ax === x0 || ax === x1) && (az === z0 || az === z1)) { ring = false; break; }
    } else ring = fw >= 3 && fd >= 3 && group.length === 2 * fw + 2 * fd - 4;
    if (ring) for (const [ax, az] of group) if (inside(ax, az)) { ring = false; break; }
    if (ring && eyes >= group.length && group.length >= 12) {
      for (let ax = x0 + 1; ax < x1; ax++) for (let az = z0 + 1; az < z1; az++) if (BID.end_portal !== undefined) w.setBlock(ax, y, az, BID.end_portal, 0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      g.ui.message('末地传送门已开启', '#AA00AA'); Sound.ev('block.end_portal.spawn', [cx, y, cz], 1, 1);
    } else if (ring) g.ui.message(`末地传送门框：${eyes} / ${group.length} 个眼`, '#AAAAAA');
    else g.ui.message('末地传送门框要围成一整圈（至少 12 个框）', '#FF5555');    return true;
  };
}

// 传送门方块：右键去末地
if (BID.end_portal !== undefined) BLOCKS[BID.end_portal].onUse = (g) => { g.changeDimension('end'); return true; };

})();
