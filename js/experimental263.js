'use strict';
// ---------------------------------------------------------------------------
// 26.3 experimental content ("Chaos" preview): poplar wood set, three poplar
// leaf colours, sapling, red shrub, shelf mushroom, straw bed, and the 16
// coloured wool / concrete slabs and stairs. Everything here is registered but
// only shown in the creative tabs of worlds that turned the experiment on
// (worldMeta.experiments.c263_test); blocks stay available to commands and
// world generation so an experimental world can use them everywhere.
// Textures come from the official 26.3 client and were appended to the atlas.
// ---------------------------------------------------------------------------
(() => {
  const EG = 3000; // block ids of the experimental set (MAX_BLOCKS is 4096; 3000-3999 is free)
  const COLS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const EX_KEYS = []; // creative lists only show these in experimental worlds
  const wood = (id, key, cn, tex, o = {}) => {
    defBlock(id, key, cn, Object.assign({ tex, hardness: 2, tool: 'axe', sound: 'wood', fuel: 300, flammable: true }, o));
    EX_KEYS.push(key); BID[key] = id;
  };

  // ---- poplar wood set -----------------------------------------------------
  defBlock(3000, 'poplar_log', '杨木原木', { tex: { top: 'poplar_log_top', side: 'poplar_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
  defBlock(3001, 'poplar_wood', '杨木', { tex: 'poplar_log', hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
  defBlock(3002, 'stripped_poplar_log', '去皮杨木原木', { tex: { top: 'stripped_poplar_log_top', side: 'stripped_poplar_log' }, hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
  defBlock(3003, 'stripped_poplar_wood', '去皮杨木', { tex: 'stripped_poplar_log', hardness: 2, tool: 'axe', sound: 'wood', axis: true, texFn: logTex, fuel: 300, flammable: true });
  wood(3004, 'poplar_planks', '杨木木板', 'poplar_planks');
  // stairs: vanilla 26.3 has poplar stairs (the generic meta stair layout the other wood sets use)
  defBlock(3005, 'poplar_stairs', '杨木楼梯', { shape: SH_BOXES, boxes: stairBoxes, tex: 'poplar_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', stairs: true, fuel: 300 });
  EX_KEYS.push('poplar_stairs');
  defBlock(3006, 'poplar_slab', '杨木台阶', { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], tex: 'poplar_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', slab: true, fuel: 150, drops: slabDrop('poplar_slab') });
  EX_KEYS.push('poplar_slab');
  defBlock(3007, 'poplar_fence', '杨木栅栏', { shape: SH_BOXES, boxes: fenceBoxes, collide: fenceCollide, tex: 'poplar_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', fence: 'wood', fuel: 300 });
  EX_KEYS.push('poplar_fence');
  defBlock(3008, 'poplar_fence_gate', '杨木栅栏门', { shape: SH_BOXES, boxes: (m) => (m & 4) ? [[0, 0, 6, 16, 16, 10]] : [[6, 0, 0, 10, 16, 16]], collide: gateCollide, tex: 'poplar_planks', render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', gate: true, fuel: 300 });
  EX_KEYS.push('poplar_fence_gate');
  defBlock(3009, 'poplar_door', '杨木门', { shape: SH_BOXES, boxes: (m) => { const f = (m & 3); return [[0, 0, 0, 3, 16, 16], [13, 0, 0, 16, 16, 16], [0, 0, 0, 16, 16, 3], [0, 0, 13, 16, 16, 16]][f]; }, tex: { top: 'poplar_door_top', bottom: 'poplar_door_top', side: 'poplar_door_bottom' }, render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', door: true, noItem: true, drops: (m) => (m & 8) ? [] : [['poplar_door', 1]] });
  defItem('poplar_door', '杨木门', { places: 'poplar_door', fuel: 200 }); EX_KEYS.push('poplar_door');
  defBlock(3010, 'poplar_trapdoor', '杨木活板门', { shape: SH_BOXES, boxes: (m) => (m & 4) ? [[0, 0, 13, 16, 16, 16]] : ((m & 8) ? [[0, 13, 0, 16, 16, 16]] : [[0, 0, 0, 16, 3, 16]]), tex: 'poplar_trapdoor', render: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', trapdoor: true, fuel: 300 });
  EX_KEYS.push('poplar_trapdoor');
  defBlock(3017, 'poplar_shelf', '杨木书架', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 16, 16]], tex: { top: 'poplar_shelf', side: 'poplar_shelf', bottom: 'poplar_planks' }, render: 'opaque', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
  EX_KEYS.push('poplar_shelf');

  // three leaf colours: the 26.3 poplar trees vary by tree, not by biome, so
  // like cherry leaves the textures carry their own colour and take no tint
  for (const [i, name] of ['orange', 'red', 'yellow'].entries()) {
    const key = name + '_poplar_leaves';
    defBlock(3011 + i, key, { orange: '橙色杨树树叶', red: '红色杨树树叶', yellow: '黄色杨树树叶' }[name],
      { tex: key, render: 'cutout', opaque: false, opacity: 1, hardness: 0.2, tool: 'hoe', sound: 'grass', leaves: true, drops: (m, r) => r() < 0.05 ? [['poplar_sapling', 1]] : [] });
    EX_KEYS.push(key);
  }
  defBlock(3014, 'poplar_sapling', '杨树树苗', { shape: SH_CROSS, tex: 'poplar_sapling', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drops: drop('poplar_sapling'), flatIcon: 'poplar_sapling' });
  EX_KEYS.push('poplar_sapling');
  defBlock(3015, 'red_shrub', '红色灌木', { shape: SH_CROSS, tex: 'red_shrub', solid: false, hardness: 0, sound: 'grass', needsSupport: true, drops: (m, r) => r() < 0.45 ? [['red_shrub', 1]] : [], flatIcon: 'red_shrub' });
  EX_KEYS.push('red_shrub');
  // shelf mushroom: two sizes, attached to the side of a poplar log; large drops two, bounces entities
  const SM_FACES = ['north', 'east', 'south', 'west'];
  const SM_STATES = [];
  for (let age = 0; age < 2; age++) for (const facing of SM_FACES) SM_STATES.push({ age: String(age), facing });
  const smBoxes = (m) => {
    const f = (m & 3), big = (m & 4) ? 1 : 0, top = big ? 16 : 12;
    return f === 0 ? [[0, 4, 0, 16, top, 4]] : f === 1 ? [[12, 4, 0, 16, top, 16]] : f === 2 ? [[0, 4, 12, 16, top, 16]] : [[0, 4, 0, 4, top, 16]];
  };
  const shelf = defBlock(3016, 'shelf_mushroom', '架生蘑菇', { shape: SH_BOXES, boxes: smBoxes, states: SM_STATES, tex: 'shelf_mushroom_stage0', solid: false, hardness: 0, sound: 'grass', needsSupport: true, bouncy: true, drops: (m, r) => [['shelf_mushroom', (m & 4) ? 2 : 1]], flatIcon: 'shelf_mushroom_stage0' });
  EX_KEYS.push('shelf_mushroom');
  // straw bed: a real two-half bed, one use only and no respawn point (see game.js trySleep)
  const SB_STATES = [];
  for (const facing of ['south', 'west', 'north', 'east']) for (const part of ['foot', 'head']) SB_STATES.push({ facing, part, occupied: 'false' });
  defBlock(3018, 'straw_bed', '草编床', { shape: SH_BOXES, boxes: () => [[0, 0, 0, 16, 6, 16]], states: SB_STATES, tex: 'straw_bed', render: 'cutout', hardness: 0.5, tool: 'hoe', sound: 'grass', bed: true, stack: 1, drops: (m) => (m & 4) ? [] : [['straw_bed', 1]] });
  EX_KEYS.push('straw_bed');

  // ---- 26.3 poplar signs / buttons / pressure plates / boats --------------
  // The 26.3 jar ships the same sign / button / plate geometry as oak; clone the oak models and
  // swap the texture names, then register the poplar blockstates against those models.
  const cloneBlockModels = (src, dst) => {
    const D = (typeof VM !== 'undefined' && VM.data) ? VM.data : null;
    if (!D || !D.blocks || !D.blocks[src]) return false;
    const texName = (t) => t === 'oak_planks' ? 'poplar_planks' : t === 'oak_sign' ? 'poplar_sign' : t === 'oak_hanging_sign' ? 'poplar_hanging_sign' : t.replace(/^oak_/, 'poplar_');
    const remap = new Map();
    const modelFor = (mi) => {
      if (remap.has(mi)) return remap.get(mi);
      const m = JSON.parse(JSON.stringify(D.models[mi]));
      m.name = m.name.replace(/oak(?=_|$)/, 'poplar');
      for (const el of (m.elements || [])) for (const f of Object.values(el.faces || {})) if (f.tex) f.tex = texName(f.tex);
      const ni = D.models.push(m) - 1; remap.set(mi, ni); return ni;
    };
    const bs = JSON.parse(JSON.stringify(D.blocks[src]));
    for (const [, list] of (bs.variants || [])) for (const v of list) v.m = modelFor(v.m);
    for (const [, list] of (bs.multipart || [])) for (const v of list) v.m = modelFor(v.m);
    D.blocks[dst] = bs;
    return true;
  };
  for (const [a, b] of [['oak_sign', 'poplar_sign'], ['oak_wall_sign', 'poplar_wall_sign'], ['oak_hanging_sign', 'poplar_hanging_sign'],
    ['oak_wall_hanging_sign', 'poplar_wall_hanging_sign'], ['oak_button', 'poplar_button'], ['oak_pressure_plate', 'poplar_pressure_plate']]) cloneBlockModels(a, b);
  // 26.3 also has a potted poplar sapling block state (flower pot + sapling model)
  cloneBlockModels('potted_oak_sapling', 'potted_poplar_sapling');
  defBlock(3096, 'potted_poplar_sapling', '花盆里的杨树树苗', { shape: SH_MODEL, solid: false, render: 'cutout', tex: 'flower_pot', hardness: 0.25, sound: 'stone', noItem: true, drops: drop('flower_pot'), boxes: () => [] });
  const deferredStates = [];
  const withStates = (id, key, cn, o, states) => { const b = defBlock(id, key, cn, o); if (states) b.states = states; if (!o.noItem) EX_KEYS.push(key); return b; };
  const signBlocks = (srcKey, dstKey, cn, noItem = false) => {
    const src = BLOCKS[BID[srcKey]];
    withStates(BID[dstKey] !== undefined ? BID[dstKey] : 3090 + (['poplar_sign', 'poplar_wall_sign', 'poplar_hanging_sign', 'poplar_wall_hanging_sign'].indexOf(dstKey)),
      dstKey, cn, { shape: SH_MODEL, solid: false, render: 'cutout', tex: dstKey.includes('hanging') ? 'poplar_hanging_sign' : 'poplar_sign',
        hardness: 1, tool: 'axe', sound: 'wood', needsSupport: !dstKey.includes('wall'), flammable: true, fuel: 200,
        drops: drop(dstKey), noItem, boxes: () => [] }, src && src.states);
    deferredStates.push([srcKey, dstKey]);
  };
  signBlocks('oak_sign', 'poplar_sign', '杨木告示牌');
  signBlocks('oak_wall_sign', 'poplar_wall_sign', '墙上的杨木告示牌', true);
  signBlocks('oak_hanging_sign', 'poplar_hanging_sign', '悬挂式杨木告示牌');
  signBlocks('oak_wall_hanging_sign', 'poplar_wall_hanging_sign', '墙上的悬挂式杨木告示牌', true);
  const plateStates = BLOCKS[BID.oak_pressure_plate] && BLOCKS[BID.oak_pressure_plate].states;
  const buttonStates = BLOCKS[BID.oak_button] && BLOCKS[BID.oak_button].states;
  deferredStates.push(['oak_button', 'poplar_button']);
  withStates(3094, 'poplar_button', '杨木按钮', { shape: SH_MODEL, render: 'cutout', tex: 'poplar_planks', hardness: 0.5, tool: 'axe', sound: 'wood', facing: true, flammable: true, fuel: 100, boxes: (m) => modelBoxes(BLOCKS[BID.poplar_button], m) }, buttonStates);
  deferredStates.push(['oak_pressure_plate', 'poplar_pressure_plate']);
  withStates(3095, 'poplar_pressure_plate', '杨木压力板', { shape: SH_MODEL, render: 'cutout', tex: 'poplar_planks', hardness: 0.5, tool: 'axe', sound: 'wood', flammable: true, fuel: 100, boxes: (m) => modelBoxes(BLOCKS[BID.poplar_pressure_plate], m) }, plateStates);

  // boats and chest boats: the entity renderer already keys its texture by wood name
  if (typeof BOAT_WOODS !== 'undefined' && !BOAT_WOODS.includes('poplar')) BOAT_WOODS.push('poplar');
  if (typeof BOAT_ITEM !== 'undefined') { BOAT_ITEM.poplar_boat = ['poplar', false]; BOAT_ITEM.poplar_chest_boat = ['poplar', true]; }
  if (typeof defItem === 'function') {
    if (ITEM_KEY.poplar_boat === undefined) defItem('poplar_boat', '杨木船', { tex: T('poplar_boat'), tab: 'tools_and_utilities' });
    if (ITEM_KEY.poplar_chest_boat === undefined) defItem('poplar_chest_boat', '杨木运输船', { tex: T('poplar_chest_boat'), tab: 'tools_and_utilities' });
    const d = (self.ITEM_DATA = self.ITEM_DATA || []);
    for (const key of ['poplar_sign', 'poplar_wall_sign', 'poplar_hanging_sign', 'poplar_wall_hanging_sign', 'poplar_button', 'poplar_pressure_plate', 'poplar_boat', 'poplar_chest_boat']) {
      if (!d.some(x => x.key === key)) d.push({ key, tab: key.includes('button') || key.includes('pressure_plate') ? 'redstone_blocks' : key.includes('boat') ? 'tools_and_utilities' : 'functional_blocks', exp: 'c263_test' });
    }
  }

  // ---- 16 coloured wool / concrete slabs and stairs (26.3) -----------------
  let id = 3020;
  const mat = (key) => key.endsWith('_wool') ? { sound: 'wool', tool: 'hoe' } : { sound: 'stone', tool: 'pickaxe', needsTool: true };
  for (const c of COLS) for (const suffix of ['wool', 'concrete']) {
    const base = c + '_' + suffix;
    const cn = { wool: '羊毛', concrete: '混凝土' }[suffix];
    const cnCol = { white: '白色', orange: '橙色', magenta: '品红色', light_blue: '淡蓝色', yellow: '黄色', lime: '黄绿色', pink: '粉红色', gray: '灰色', light_gray: '淡灰色', cyan: '青色', purple: '紫色', blue: '蓝色', brown: '棕色', green: '绿色', red: '红色', black: '黑色' }[c];
    const sid = id++, tid = id++;
    const o0 = Object.assign({ tex: base, render: 'opaque', hardness: suffix === 'wool' ? 0.8 : 1.8 }, mat(base));
    if (suffix === 'wool') o0.flammable = true;
    defBlock(sid, base + '_slab', cnCol + cn + '台阶', Object.assign({}, o0, { shape: SH_BOXES, boxes: (m) => SLAB_BOXES[m & 3], slab: true, drops: slabDrop(base + '_slab') }));
    defBlock(tid, base + '_stairs', cnCol + cn + '楼梯', Object.assign({}, o0, { shape: SH_BOXES, boxes: stairBoxes, stairs: true }));
    EX_KEYS.push(base + '_slab', base + '_stairs');
  }

  // ---- creative tabs -------------------------------------------------------
  const ITEM_TAB = (key) => /(leaves|sapling|shrub|mushroom|log|wood)$/.test(key) ? 'natural_blocks' : 'building_blocks';
  for (const key of EX_KEYS) {
    const d = (self.ITEM_DATA = self.ITEM_DATA || []);
    if (!d.some(x => x.key === key)) d.push({ key, tab: ITEM_TAB(key), exp: 'c263_test' });
  }
  window.EXP263_KEYS = EX_KEYS;

  // ---- recipes (planks, stairs, slabs, fence, gate, door, trapdoor, shelf) --
  if (typeof shaped === 'function') {
    shaped('poplar_planks', 4, ['#'], { '#': 'poplar_log' });
    shaped('poplar_planks', 4, ['#'], { '#': 'poplar_wood' });
    shaped('poplar_planks', 4, ['#'], { '#': 'stripped_poplar_log' });
    shaped('poplar_planks', 4, ['#'], { '#': 'stripped_poplar_wood' });
    shaped('poplar_stairs', 4, ['#  ', '## ', '###'], { '#': 'poplar_planks' });
    shaped('poplar_slab', 6, ['###'], { '#': 'poplar_planks' });
    shaped('poplar_fence', 3, ['#S#', '#S#'], { '#': 'poplar_planks', S: 'stick' });
    shaped('poplar_fence_gate', 1, ['#S#', '#S#'], { '#': 'poplar_planks', S: 'stick' });
    shaped('poplar_door', 3, ['##', '##', '##'], { '#': 'poplar_planks' });
    shaped('poplar_trapdoor', 2, ['###', '###'], { '#': 'poplar_planks' });
    shaped('poplar_shelf', 1, ['###', '   ', '###'], { '#': 'poplar_planks' });
    shaped('straw_bed', 4, ['###'], { '#': 'hay_block' });
    shaped('poplar_sign', 3, ['###', '###', ' X '], { '#': 'poplar_planks', X: 'stick' });
    shaped('poplar_hanging_sign', 1, ['# #', '###', '###'], { '#': 'poplar_planks' });
    shaped('poplar_button', 1, ['#'], { '#': 'poplar_planks' });
    shaped('poplar_pressure_plate', 1, ['##'], { '#': 'poplar_planks' });
    shaped('poplar_boat', 1, ['# #', '###'], { '#': 'poplar_planks' });
    shaped('poplar_chest_boat', 1, ['B', 'C'], { B: 'poplar_boat', C: 'chest' });
    for (const c of COLS) {
      shaped(c + '_wool_slab', 6, ['###'], { '#': c + '_wool' });
      shaped(c + '_wool_stairs', 4, ['#  ', '## ', '###'], { '#': c + '_wool' });
      shaped(c + '_concrete_slab', 6, ['###'], { '#': c + '_concrete' });
      shaped(c + '_concrete_stairs', 4, ['#  ', '## ', '###'], { '#': c + '_concrete' });
    }
  }

  // ---- behaviour: poplar sapling grows a poplar tree ------------------------
  // (the mesh worker only registers the blocks, it has no game/random-tick state)
  if (typeof BLOCK_RANDOM_TICK === 'undefined') return;
  BLOCK_RANDOM_TICK.poplar_sapling = (g, x, y, z) => {
    const w = g.world, l = w.getLight(x, y + 1, z);
    if ((l >> 4) < 9) return;
    if (Math.random() > 1 / 7) return;
    const h = 4 + (Math.random() * 4 | 0);
    // the cell above must be free for the trunk
    for (let i = 1; i <= h; i++) if (SOLIDCUBE[w.getBlock(x, y + i, z)]) return;
    const leafKey = ['orange_poplar_leaves', 'red_poplar_leaves', 'yellow_poplar_leaves'][Math.random() * 3 | 0];
    const leaf = BID[leafKey];
    w.setBlock(x, y, z, 0, 0);
    for (let i = 0; i < h; i++) w.setBlock(x, y + i, z, BID.poplar_log, 0);
    // a narrow, tall poplar crown: two wide layers near the top, a small cap
    const top = y + h;
    for (let dy = -3; dy <= 1; dy++) {
      const r = dy >= -1 ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        const yy = top + dy;
        if (w.getBlock(x + dx, yy, z + dz) === 0) w.setBlock(x + dx, yy, z + dz, leaf, 0);
      }
    }
    Sound.ev('block.grass.place', [x + 0.5, y + h / 2, z + 0.5], 1, 1);
  };

  // ---- 26.2 sulfur blocks: potent sulfur pools and spikes ------------------
  // Potent sulfur under up to four water blocks bubbles and, on the surface,
  // makes the nausea gas cloud vanilla describes (a nausea effect in the water
  // around it). It also clicks and sprays the occasional particle.
  BLOCK_RANDOM_TICK.potent_sulfur = (g, x, y, z) => {
    let up = 0;
    while (up < 4 && w_get(g, x, y + 1 + up, z) === BID.water) up++;
    if (!up && Math.random() > 0.35) return;
    if (Math.random() < 0.25) {
      try { g.particles && g.particles.bubble(x + 0.5, y + 1.2, z + 0.5, 2); } catch (e) { }
      if (Math.random() < 0.3) { try { Sound.ev('block.potent_sulfur.geyser_eruption', [x + 0.5, y + 1, z + 0.5], 0.7, 1); } catch (e) { } }
    }
    if (!up) return;
    // the gas spreads over adjacent source water (radius 3) and gives nausea
    const p = g.player;
    if (!p || p.dead) return;
    const dx = Math.floor(p.pos[0]) - x, dz = Math.floor(p.pos[2]) - z, py = p.pos[1];
    if (dx * dx + dz * dz <= 9 && py >= y + up - 1 && py <= y + up + 2 && Math.random() < 0.5) {
      p.addEffect('nausea', 0, 5 * 20);
      try { Sound.ev('block.potent_sulfur.noxious_gas', [x + 0.5, py, z + 0.5], 0.8, 1); } catch (e) { }
    }
  };
  function w_get(g, x, y, z) { const w = g.world; return w && w.getBlock ? w.getBlock(x, y, z) : 0; }

  // A sulfur spike that loses its support breaks off: a stalactite (placed
  // pointing down under a sulfur block) drops and hurts whoever stands below,
  // a stalagmite just breaks. Vanilla's sharpness applies to the falling one.
  BLOCK_RANDOM_TICK.sulfur_spike = (g, x, y, z, id, meta) => {
    const w = g.world, st = (BLOCKS[id].states && BLOCKS[id].states[meta]) || {};
    const down = st.vertical_direction === 'down', above = w.getBlock(x, y + 1, z), below = w.getBlock(x, y - 1, z);
    const support = down ? above : below;
    const ok = support === id || (BLOCKS[support] && BLOCKS[support].key === 'sulfur');
    if (ok) return;
    w.setBlock(x, y, z, 0, 0);
    g.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: ITEM_KEY.sulfur_spike, count: 1 });
    if (down) {
      const p = g.player;
      if (p && !p.dead && Math.abs(p.pos[0] - x - 0.5) < 0.7 && Math.abs(p.pos[2] - z - 0.5) < 0.7 && p.pos[1] < y && p.pos[1] > y - 6) {
        p.hurt(6, { type: 'sulfur_spike', knockFrom: [x + 0.5, y, z + 0.5] });
      }
      try { Sound.ev('block.sulfur_spike.land', [x + 0.5, y, z + 0.5], 0.8, 1); } catch (e) { }
    }
  };
  // walls forms were discovered in blocks.js before these ids existed: teach the placement code the pair,
  // and let a broken wall sign drop the standing sign item (wall forms have no item of their own)
  for (const [standing, wall] of [['poplar_sign', 'poplar_wall_sign'], ['poplar_hanging_sign', 'poplar_wall_hanging_sign']]) {
    if (BID[standing] !== undefined && BID[wall] !== undefined && typeof WALL_FORM !== 'undefined') {
      WALL_FORM[standing] = wall; IS_WALL_FORM.add(wall);
      const sb = BLOCKS[BID[standing]], wb = BLOCKS[BID[wall]];
      if (sb && wb && sb.noItem !== true) wb.drops = () => [[sb.id, 1]];
    }
  }
  // these blocks registered after js/world.js ran: rebuild the world's block tables so
  // non-full shapes (stairs, slabs, leaves, plants) get their real opacity and light.
  refreshBlockTables();
  // the generated block data (blockdata.js) gives oak_* their canonical state lists a moment after this file runs
  setTimeout(() => {
    for (const [src, dst] of deferredStates) {
      const a = BLOCKS[BID[src]], b = BLOCKS[BID[dst]];
      if (a && a.states && b && !b.states) b.states = a.states;
    }
  }, 0);
})();
