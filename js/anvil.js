'use strict';
// ---------------------------------------------------------------------------
// Importing vanilla Java worlds. Reads the seed, level.dat (name/spawn/time/mode/difficulty)
// and the Anvil region files of the three dimensions, turning every finished chunk into a
// saved chunk of a new world with the same seed. Chunks the server never generated come from
// this game's own generator, so the land around the imported area matches. Chests and furnaces
// keep their contents.
//   - 1.18+ : sections[].block_states.palette + packed indices (gen-2, 384 tall)
//   - 1.12.2 and earlier : Level.Sections[].Blocks (legacy numeric id bytes) + Data (nibble meta),
//     mapped through the legacy id table to modern state names (gen-1, 256 tall).
// Region layout: 26.x dimensions/minecraft/<dim>/region, or older region, DIM-1/region, DIM1/region.
// ---------------------------------------------------------------------------
const VanillaImport = (() => {
  const DIMS = [
    { dim: 'overworld', minY: -64, paths: ['dimensions/minecraft/overworld/region/', 'region/'] },
    { dim: 'nether', minY: 0, paths: ['dimensions/minecraft/the_nether/region/', 'DIM-1/region/'] },
    { dim: 'end', minY: 0, paths: ['dimensions/minecraft/the_end/region/', 'DIM1/region/'] },
  ];
  const strip = (s) => String(s).replace(/^minecraft:/, '');

  // ---- reading the picked files: a folder (File objects with webkitRelativePath) or a .zip ----
  // entries: Map of path inside the world folder -> () => Promise<Uint8Array>
  async function fromFileList(files) {
    const list = [...files];
    if (list.length === 1 && /\.zip$/i.test(list[0].name)) return fromZip(list[0]);
    const all = new Map();
    for (const f of list) all.set((f.webkitRelativePath || f.name).replace(/\\/g, '/'), () => f.arrayBuffer().then(b => new Uint8Array(b)));
    return rootAt(all);
  }
  // the world folder is the one holding level.dat (the shallowest, if a zip or folder holds more)
  function rootAt(all) {
    let root = null;
    for (const p of all.keys()) if (/(^|\/)level\.dat$/.test(p)) { const r = p.slice(0, -'level.dat'.length); if (root === null || r.length < root.length) root = r; }
    if (root === null) throw new Error('没有找到 level.dat：请选择原版存档的世界文件夹（里面有 level.dat 和 region 或 dimensions）');
    const out = new Map();
    for (const [p, get] of all) if (p.startsWith(root)) out.set(p.slice(root.length), get);
    return out;
  }
  // zip: the central directory, then each entry (stored, or deflate through DecompressionStream)
  async function fromZip(file) {
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('不是有效的 zip 文件');
    let n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    const all = new Map(), td = new TextDecoder();
    while (n-- > 0) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = td.decode(buf.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
      p += 46 + nlen + elen + clen;
      if (name.endsWith('/')) continue;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), data = buf.subarray(start, start + csize);
      if (method === 0) all.set(name, async () => data);
      else if (method === 8) all.set(name, () => NBT.inflate(data, 'deflate-raw'));
    }
    return rootAt(all);
  }
  async function readNbt(entries, path) {
    const get = entries.get(path);
    if (!get) return null;
    let b = await get();
    if (b[0] === 0x1f && b[1] === 0x8b) b = await NBT.inflate(b, 'gzip');
    return NBT.parse(b);
  }

  // ---- block states and items ----
  const stateCache = new Map(), missing = new Map(), substituted = new Map();
  // vanilla blocks this game shows as another one
  const SUBSTITUTE = { bubble_column: 'water' };
  // ---- 1.12.2 及更早旧版：数字方块 id -> 新版状态名（缺映射的方块由 near 兜底或落空气）----
  // 编号依据 Java 版扁平化前官方方块 ID 表（1.12.2）
  const LEGACY_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const LEGACY_WOOD = ['oak', 'spruce', 'birch', 'jungle'];
  const LEGACY_WOOD2 = ['acacia', 'dark_oak'];
  const LEGACY_BLOCK = {
    1: 'stone', 2: 'grass_block', 3: 'dirt', 4: 'cobblestone', 7: 'bedrock',
    8: 'water', 9: 'water', 10: 'lava', 11: 'lava', 12: 'sand', 13: 'gravel', 14: 'gold_ore',
    15: 'iron_ore', 16: 'coal_ore', 19: 'sponge', 20: 'glass', 21: 'lapis_ore', 22: 'lapis_block',
    23: 'dispenser', 24: 'sandstone', 25: 'note_block', 27: 'golden_rail', 28: 'detector_rail',
    29: 'sticky_piston', 30: 'cobweb', 31: 'short_grass', 32: 'dead_bush', 33: 'piston', 34: 'piston_head', 37: 'dandelion', 38: 'poppy',
    39: 'brown_mushroom', 40: 'red_mushroom', 41: 'gold_block', 42: 'iron_block', 43: 'stone_slab',
    44: 'stone_slab', 45: 'bricks', 46: 'tnt', 47: 'bookshelf', 48: 'mossy_cobblestone', 49: 'obsidian',
    50: 'torch', 51: 'fire', 52: 'spawner', 53: 'oak_stairs', 54: 'chest', 55: 'redstone_wire',
    56: 'diamond_ore', 57: 'diamond_block', 58: 'crafting_table', 59: 'wheat', 60: 'farmland',
    61: 'furnace', 62: 'furnace', 63: 'oak_sign', 64: 'oak_door', 65: 'ladder', 66: 'rail',
    67: 'cobblestone_stairs', 68: 'oak_wall_sign', 69: 'lever', 70: 'stone_pressure_plate',
    71: 'iron_door', 72: 'oak_pressure_plate', 73: 'redstone_ore', 74: 'redstone_ore',
    75: 'redstone_torch', 76: 'redstone_torch', 77: 'stone_button', 78: 'snow', 79: 'ice',
    80: 'snow_block', 81: 'cactus', 82: 'clay', 83: 'sugar_cane', 84: 'jukebox', 85: 'oak_fence',
    86: 'pumpkin', 87: 'netherrack', 88: 'soul_sand', 89: 'glowstone', 90: 'nether_portal',
    91: 'jack_o_lantern', 92: 'cake', 93: 'repeater', 94: 'repeater', 96: 'oak_trapdoor', 97: 'stone',
    98: 'stone_bricks', 99: 'brown_mushroom_block', 100: 'red_mushroom_block', 101: 'iron_bars',
    102: 'glass_pane', 103: 'melon', 104: 'pumpkin_stem', 105: 'melon_stem', 106: 'vine',
    107: 'oak_fence_gate', 108: 'brick_stairs', 109: 'stone_brick_stairs', 110: 'mycelium',
    111: 'lily_pad', 112: 'nether_bricks', 113: 'nether_brick_fence', 114: 'nether_brick_stairs',
    115: 'nether_wart', 116: 'enchanting_table', 117: 'brewing_stand', 118: 'cauldron', 119: 'end_portal',
    120: 'end_portal_frame', 121: 'end_stone', 122: 'dragon_egg', 123: 'redstone_lamp', 124: 'redstone_lamp',
    127: 'cocoa', 128: 'sandstone_stairs', 129: 'emerald_ore', 130: 'ender_chest', 131: 'tripwire_hook',
    132: 'tripwire', 133: 'emerald_block', 134: 'spruce_stairs', 135: 'birch_stairs', 136: 'jungle_stairs',
    137: 'command_block', 138: 'beacon', 139: 'cobblestone_wall', 140: 'flower_pot', 141: 'carrots',
    142: 'potatoes', 143: 'oak_button', 145: 'anvil', 146: 'trapped_chest', 149: 'comparator',
    150: 'comparator', 151: 'daylight_detector', 152: 'redstone_block', 153: 'nether_quartz_ore',
    154: 'hopper', 155: 'quartz_block', 156: 'quartz_stairs', 157: 'activator_rail', 158: 'dropper',
    163: 'acacia_stairs', 164: 'dark_oak_stairs', 165: 'slime_block', 166: 'barrier', 167: 'iron_trapdoor',
    168: 'prismarine', 169: 'sea_lantern', 170: 'hay_block', 172: 'terracotta', 173: 'coal_block',
    174: 'packed_ice', 179: 'red_sandstone', 180: 'red_sandstone_stairs', 183: 'spruce_fence_gate',
    184: 'birch_fence_gate', 185: 'jungle_fence_gate', 186: 'dark_oak_fence_gate', 187: 'acacia_fence_gate',
    188: 'spruce_fence', 189: 'birch_fence', 190: 'jungle_fence', 191: 'dark_oak_fence', 192: 'acacia_fence',
    193: 'spruce_door', 194: 'birch_door', 195: 'jungle_door', 196: 'acacia_door', 197: 'dark_oak_door',
    198: 'end_rod', 199: 'chorus_plant', 200: 'chorus_flower', 201: 'purpur_block', 202: 'purpur_pillar',
    203: 'purpur_stairs', 205: 'purpur_slab', 206: 'end_stone_bricks', 207: 'beetroots', 208: 'dirt_path', 213: 'magma_block',
    214: 'nether_wart_block', 215: 'red_nether_bricks', 216: 'bone_block',
  };
  // 旧数字 id + 半字节 meta -> 新版状态串；返回 null 视为空气
  function legacyState(id, meta) {
    if (id === 0) return null;
    switch (id) {
      case 5: return LEGACY_WOOD[meta & 3] + '_planks';
      case 17: return LEGACY_WOOD[(meta >> 2) & 3] + '_log';
      case 18: return LEGACY_WOOD[(meta >> 2) & 3] + '_leaves';
      case 161: return LEGACY_WOOD2[(meta >> 2) & 1] + '_leaves';
      case 162: return LEGACY_WOOD2[(meta >> 2) & 1] + '_log';
      case 26: return LEGACY_COLORS[meta & 15] + '_bed';
      case 35: return LEGACY_COLORS[meta & 15] + '_wool';
      case 95: return LEGACY_COLORS[meta & 15] + '_stained_glass';
      case 159: return LEGACY_COLORS[meta & 15] + '_terracotta';
      case 160: return LEGACY_COLORS[meta & 15] + '_stained_glass_pane';
      case 171: return LEGACY_COLORS[meta & 15] + '_carpet';
      case 125: case 126: return LEGACY_WOOD[meta & 3] + '_slab';
      case 175: return (['sunflower', 'lilac', 'tall_grass', 'large_fern', 'rose_bush', 'peony'][meta & 7]) || 'short_grass';
      case 176: return LEGACY_COLORS[meta & 15] + '_banner';
      case 177: return LEGACY_COLORS[meta & 15] + '_wall_banner';
      default: return LEGACY_BLOCK[id] || null;
    }
  }
  function stateOf(e) {
    let key = SUBSTITUTE[strip(e.Name)] || strip(e.Name);
    if (e.Properties) { const ks = Object.keys(e.Properties).sort(); if (ks.length) key += '[' + ks.map(k => k + '=' + e.Properties[k]).join(',') + ']'; }
    let r = stateCache.get(key);
    if (r !== undefined && r[3]) { const n = strip(e.Name), M = r[3] === 'missing' ? missing : substituted; M.set(n, (M.get(n) || 0) + 1); }
    if (r === undefined) {
      r = mapVanillaStateNear(key); // blocks this game lacks: the closest one it has, or air
      if (!r) r = [0, 0, false, 'missing'];
      else if (r[2]) r = [r[0], r[1], true, 'near'];
      stateCache.set(key, r);
      if (r[3]) { const n = strip(e.Name), M = r[3] === 'missing' ? missing : substituted; M.set(n, (M.get(n) || 0) + 1); }
    }
    return r;
  }
  const stackOf = (it) => {
    const id = ITEM_KEY[strip(it.id)];
    if (id === undefined) return null;
    const s = makeStack(id, it.count ?? it.Count ?? 1);
    const dmg = it.components && it.components['minecraft:damage'];
    if (dmg) s.dmg = dmg;
    return s;
  };

  // ---- one chunk: block states (palette + packed indices) -> flat block / meta arrays ----
  function convertChunk(nbt, minY, H, bes, stats) {
    const L = nbt.Level || null;
    if (L && L.Sections && L.Sections.some(s => s.Blocks)) return convertLegacyChunk(L, minY, H, bes, stats);
    if (nbt.Level || !nbt.sections) { stats.old++; return null; } // 1.13–1.17 旧包裹格式暂不解析
    const st = strip(nbt.Status || '');
    if (st !== 'full') { stats.partial++; return null; } // the generator makes the rest
    const B = new Uint16Array(256 * H), M = new Uint8Array(256 * H), WL = [];
    for (const sec of nbt.sections) {
      const bs = sec.block_states;
      if (!bs || !bs.palette || !bs.palette.length) continue;
      const base = (sec.Y * 16 - minY) * 256;
      if (base < 0 || base + 4096 > B.length) continue;
      // waterlogged=true: the cell keeps its water (a block this game can't fill with water, or doesn't have, gives
      // way to the water)
      const pal = bs.palette.map(e => {
        const s = stateOf(e);
        if (!(e.Properties && e.Properties.waterlogged === 'true')) return s;
        return !s[0] ? [WATER, 0] : canWaterlog(s[0], s[1]) ? [s[0], s[1], s[2], s[3], true] : s;
      });
      if (pal.length === 1 || !bs.data) {
        const [id, m, , , wl] = pal[0];
        if (id) { B.fill(id, base, base + 4096); M.fill(m, base, base + 4096); }
        if (wl) for (let i = 0; i < 4096; i++) WL.push(base + i);
        continue;
      }
      // indices: max(4, bits for the palette) bits each, as many as fit in a long, never split across longs
      const bits = Math.max(4, 32 - Math.clz32(pal.length - 1)), per = Math.floor(64 / bits), mask = (1 << bits) - 1, L = bs.data;
      for (let i = 0; i < 4096; i++) {
        const li = (i / per) | 0, o = (i - li * per) * bits, lo = L.lo(li), hi = L.hi(li);
        const v = o >= 32 ? (hi >>> (o - 32)) & mask : o + bits <= 32 ? (lo >>> o) & mask : ((lo >>> o) | (hi << (32 - o))) & mask;
        const s = pal[v] || pal[0];
        B[base + i] = s[0]; M[base + i] = s[1];
        if (s[4]) WL.push(base + i);
      }
    }
    // containers: chests / barrels (27 slots) and furnaces, where this game has the same kind of block
    for (const be of nbt.block_entities || []) placeContainer(bes, B, H, be, minY, stats);
    const rec = { b: new Uint16Array(rleEncode(B)), m: new Uint16Array(rleEncode(M)) };
    if (WL.length) { rec.w = Uint32Array.from(WL); stats.waterlogged = (stats.waterlogged || 0) + WL.length; }
    return rec;
  }

  // chest / furnace 容器还原（新旧格式共用）
  function placeContainer(bes, B, H, be, minY, stats) {
    const t = strip(be.id), x = be.x, y = be.y - minY, z = be.z;
    if (y < 0 || y >= H) return;
    const items = be.Items || [];
    const at = BLOCKS[B[(y << 8) | ((z & 15) << 4) | (x & 15)]];
    if (!at) return;
    if ((t === 'chest' || t === 'trapped_chest' || t === 'barrel') && at.key === 'chest') {
      const slots = new Array(27).fill(null);
      for (const it of items) { const s = stackOf(it); if (s && it.Slot >= 0 && it.Slot < 27) slots[it.Slot] = s; }
      const chest = { type: 'chest', pos: [x, y, z], slots };
      // a structure chest nobody has opened only names its loot table: filled when it is opened, as in vanilla
      if (!items.length && be.LootTable) chest.loot = strip(be.LootTable);
      bes[`${x},${y},${z}`] = chest;
      stats.containers++;
    } else if ((t === 'furnace' || t === 'blast_furnace' || t === 'smoker') && at.onUse === 'furnace') {
      const f = { type: 'furnace', pos: [x, y, z], input: null, fuel: null, output: null, burn: 0, burnMax: 0, cook: 0 };
      for (const it of items) { const s = stackOf(it); if (it.Slot === 0) f.input = s; else if (it.Slot === 1) f.fuel = s; else if (it.Slot === 2) f.output = s; }
      bes[`${x},${y},${z}`] = f;
      stats.containers++;
    }
  }

  // 1.12.2 及更早旧格式：Level.Sections[].Blocks（旧数字 id 字节）+ Data（半字节 meta）
  function convertLegacyChunk(L, minY, H, bes, stats) {
    const B = new Uint16Array(256 * H), M = new Uint8Array(256 * H);
    for (const sec of L.Sections || []) {
      const Bb = sec.Blocks; if (!Bb || Bb.length !== 4096) continue;
      const Dd = sec.Data;
      const base = ((sec.Y || 0) * 16 - minY) * 256;
      if (base < 0 || base + 4096 > B.length) continue;
      for (let i = 0; i < 4096; i++) {
        const id = Bb[i] & 0xff, meta = Dd ? ((Dd[i >> 1] >> ((i & 1) * 4)) & 15) : 0;
        const key = legacyState(id, meta);
        if (!key) continue;
        const s = mapVanillaStateNear(key);
        if (!s || !s[0]) { stats.missingLegacy = (stats.missingLegacy || 0) + 1; continue; }
        B[base + i] = s[0]; M[base + i] = s[1];
      }
    }
    for (const be of L.TileEntities || []) placeContainer(bes, B, H, be, minY, stats);
    return { b: new Uint16Array(rleEncode(B)), m: new Uint16Array(rleEncode(M)) };
  }

  // ---- a region file: 1024 chunk slots, each at a 4 KB sector offset with length + compression ----
  async function regionChunks(bytes, dir, entries, fn) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 1024; i++) {
      const loc = dv.getUint32(i * 4), off = (loc >>> 8) * 4096;
      if (!off || off + 5 > bytes.length) continue;
      const len = dv.getUint32(off), type = bytes[off + 4];
      let data = bytes.subarray(off + 5, off + 4 + len);
      if (type & 128) { // stored outside the region file (c.X.Z.mcc)
        const get = entries.get(dir + `c.${i & 31}.${i >> 5}.mcc`);
        if (!get) { await fn(null, 'external'); continue; }
        data = await get();
      }
      const c = type & 127;
      try {
        if (c === 1) data = await NBT.inflate(data, 'gzip');
        else if (c === 2) data = await NBT.inflate(data, 'deflate');
        else if (c !== 3) { await fn(null, 'compression ' + c); continue; } // LZ4 / custom: not supported
        await fn(NBT.parse(data), null);
      } catch (e) { await fn(null, 'error'); }
    }
  }

  // ---- entities (entities/r.X.Z.mca, 1.17+) -> the records the game keeps per dimension (dims.js mobRecord),
  // restored when their chunk loads: mobs, boats and minecarts, item frames, paintings, armor stands. Left out: dropped
  // items, orbs and arrows (the game doesn't keep them either) and hostile mobs that would despawn
  const FACING3 = [2, 3, 4, 5, 0, 1]; // vanilla Direction (down up north south west east) -> DIRS
  const FACING2 = [5, 0, 4, 1]; // a painting's 2D facing (south west north east)
  const kindOk = new Map();
  const slotsOf = (list, n) => { const s = new Array(n).fill(null); for (const it of list || []) { const st = stackOf(it); if (st && it.Slot >= 0 && it.Slot < n) s[it.Slot] = st; } return s; };
  const blockPosOf = (e, minY) => {
    const b = e.block_pos || (e.TileX !== undefined ? [e.TileX, e.TileY, e.TileZ] : null);
    return b ? [Number(b[0]), Number(b[1]) - minY, Number(b[2])] : null;
  };
  function entityRecord(game, e, minY, stats) {
    const t = strip(e.id || '').toLowerCase(), P = e.Pos;
    if (!P) return null;
    const pos = [Number(P[0]), Number(P[1]) - minY, Number(P[2])];
    const yaw = e.Rotation ? Math.PI - Number(e.Rotation[0]) * Math.PI / 180 : 0;
    let m = /^(.+?)_(chest_)?(boat|raft)$/.exec(t);
    if (m) return { type: (m[2] ? 'chest_boat:' : 'boat:') + m[1], pos, yaw, x: { yaw, slots: m[2] ? slotsOf(e.Items, 27) : undefined, loot: e.LootTable ? strip(e.LootTable) : undefined } };
    m = /^(?:(chest|furnace|tnt|hopper)_)?minecart$/.exec(t);
    if (m) {
      const kind = m[1] || '', slots = kind === 'chest' ? slotsOf(e.Items, 27) : kind === 'hopper' ? slotsOf(e.Items, 5) : undefined;
      return { type: 'minecart:' + kind, pos, yaw, x: { yaw, slots, fuel: Number(e.Fuel || 0), enabled: e.Enabled === undefined ? undefined : !!e.Enabled, loot: e.LootTable ? strip(e.LootTable) : undefined } };
    }
    if (t === 'item_frame' || t === 'glow_item_frame') {
      const b = blockPosOf(e, minY); if (!b) return null;
      return { type: t, pos: [b[0] + 0.5, b[1], b[2] + 0.5], yaw: 0, x: { b, f: FACING3[Number(e.Facing) || 0] ?? 4, it: e.Item ? stackOf(e.Item) : null, r: Number(e.ItemRotation || 0), t } };
    }
    if (t === 'painting') {
      const b = blockPosOf(e, minY); if (!b) return null;
      return { type: t, pos: [b[0] + 0.5, b[1], b[2] + 0.5], yaw: 0, x: { b, f: FACING2[Number(e.facing ?? e.Facing) & 3], v: strip(e.variant || e.Motive || '') } };
    }
    if (t === 'armor_stand') {
      const q = e.equipment || {}, A = e.ArmorItems || [], H = e.HandItems || [];
      const st = (o) => o && o.id ? stackOf(o) : null;
      const g = [st(q.feet || A[0]), st(q.legs || A[1]), st(q.chest || A[2]), st(q.head || A[3]), st(q.mainhand || H[0]), st(q.offhand || H[1])];
      return { type: t, pos, yaw, x: { g, s: !!e.Small, a: !!e.ShowArms, y: yaw } };
    }
    // mobs this game has (worked out once per kind)
    if (!kindOk.has(t)) {
      let mob = null;
      try { mob = createMob(game, t, 0, -1000, 0); } catch (err) { mob = null; }
      kindOk.set(t, mob && mob.type === t && mob instanceof Mob ? { hostile: !!(mob.T && mob.T.hostile) } : null);
    }
    const k = kindOk.get(t);
    if (!k) { if (!/^(item|experience_orb|arrow|spectral_arrow|trident|falling_block|tnt|marker|area_effect_cloud|interaction|.*_display|lightning_bolt)$/.test(t)) stats.entitiesMissing.set(t, (stats.entitiesMissing.get(t) || 0) + 1); return null; }
    if (k.hostile && !e.PersistenceRequired && !e.CustomName) return null;
    const age = Number(e.Age || 0);
    return {
      type: t, pos, yaw, health: e.Health !== undefined ? Number(e.Health) : undefined,
      sheared: !!e.Sheared, wool: Number(e.Color || 0),
      baby: age < 0 || e.IsBaby ? Math.max(1, Math.min(6000, Math.ceil(-age / 4) || 6000)) : 0,
      size: e.Size !== undefined ? Number(e.Size) + 1 : undefined,
    };
  }

  // ---- the whole import ----
  async function run(game, files, progress) {
    const entries = await fromFileList(files);
    const level = await readNbt(entries, 'level.dat');
    if (!level || !level.Data) throw new Error('level.dat 读取失败');
    const D = level.Data;
    const dvId = Number(D.DataVersion ?? (D.Version && D.Version.Id) ?? 0);
    const legacy = dvId > 0 && dvId < 1519; // 1.13 之前：旧 Level/Blocks/Data 数字 id 格式
    setWorldFormat(legacy ? 1 : 2);
    const H = HEIGHT;
    const wgs = await readNbt(entries, 'dimensions/minecraft/overworld/data/minecraft/world_gen_settings.dat');
    const seed = (wgs && wgs.data && wgs.data.seed) ?? (D.WorldGenSettings && D.WorldGenSettings.seed) ?? D.RandomSeed;
    if (seed === undefined) throw new Error('找不到世界种子');
    const version = (D.Version && D.Version.Name) || '未知版本';
    let spawn = null;
    if (D.spawn && D.spawn.pos) spawn = [D.spawn.pos[0], D.spawn.pos[1], D.spawn.pos[2]];
    else if (D.SpawnX !== undefined) spawn = [D.SpawnX, D.SpawnY, D.SpawnZ];
    const id = 'w' + Date.now().toString(36);
    const stats = { chunks: 0, old: 0, partial: 0, skipped: 0, containers: 0, regions: 0, entities: 0, missingLegacy: 0, perDim: {} };
    missing.clear(); substituted.clear();
    const dims = {};
    // the region files of each dimension
    const jobs = [];
    for (const d of DIMS) {
      const dir = d.paths.find(pre => [...entries.keys()].some(p => p.startsWith(pre) && p.endsWith('.mca')));
      if (!dir) continue;
      for (const p of entries.keys()) if (p.startsWith(dir) && /^r\.-?\d+\.-?\d+\.mca$/.test(p.slice(dir.length))) jobs.push({ d, dir, p });
    }
    if (!jobs.some(j => j.d.dim === 'overworld')) throw new Error('存档里没有主世界的区域文件（region/*.mca）');
    let done = 0, lastYield = performance.now();
    for (const job of jobs) {
      const { d, dir, p } = job, sid = d.dim === 'overworld' ? id : id + '~' + d.dim;
      const bes = (dims[d.dim] || (dims[d.dim] = { blockEntities: {}, mobs: [] })).blockEntities;
      const bytes = await entries.get(p)();
      let batch = [];
      await regionChunks(bytes, dir, entries, async (nbt, err) => {
        if (!nbt) { stats.skipped++; return; }
        const L = nbt.Level || null;
        const minY = legacy ? 0 : d.minY;
        const rec = convertChunk(nbt, minY, H, bes, stats);
        if (!rec) return;
        const cx = nbt.xPos ?? (L && L.xPos), cz = nbt.zPos ?? (L && L.zPos);
        batch.push([cx, cz, rec]);
        stats.chunks++; stats.perDim[d.dim] = (stats.perDim[d.dim] || 0) + 1;
        // 旧格式实体随区块存放（1.17+ 才分离到 entities/*.mca）
        if (legacy && L) {
          const mobs = dims[d.dim].mobs;
          for (const e of L.Entities || []) {
            let r = null;
            try { r = entityRecord(game, e, minY, stats); } catch (err) { r = null; }
            if (r) { mobs.push(r); stats.entities++; }
          }
        }
        if (batch.length >= 64) { await DB.putChunks(sid, batch); batch = []; }
        if (performance.now() - lastYield > 50) { lastYield = performance.now(); progress && progress(done / jobs.length, stats); await new Promise(r => setTimeout(r, 0)); }
      });
      if (batch.length) await DB.putChunks(sid, batch);
      stats.regions++; done++;
      progress && progress(done / jobs.length, stats);
    }
    // entities, kept apart from the blocks since 1.17（旧格式实体已随区块收集）
    if (!legacy) stats.entities = 0;
    stats.entitiesMissing = new Map();
    for (const d of DIMS) {
      if (legacy) continue;
      const dir = d.paths.map(pre => pre.replace(/region\/$/, 'entities/')).find(pre => [...entries.keys()].some(p => p.startsWith(pre) && p.endsWith('.mca')));
      if (!dir || !dims[d.dim]) continue;
      const mobs = dims[d.dim].mobs;
      for (const p of entries.keys()) {
        if (!p.startsWith(dir) || !/^r\.-?\d+\.-?\d+\.mca$/.test(p.slice(dir.length))) continue;
        await regionChunks(await entries.get(p)(), dir, entries, async (nbt) => {
          for (const e of (nbt && nbt.Entities) || []) {
            let r = null;
            try { r = entityRecord(game, e, d.minY, stats); } catch (err) { r = null; }
            if (r) { mobs.push(r); stats.entities++; }
          }
        });
        if (performance.now() - lastYield > 50) { lastYield = performance.now(); await new Promise(r => setTimeout(r, 0)); }
      }
    }
    stats.entitiesMissing = [...stats.entitiesMissing].sort((a, b) => b[1] - a[1]);
    const mode = ['survival', 'creative', 'survival', 'spectator'][D.GameType ?? 0] || 'survival';
    const meta = {
      id, name: (D.LevelName || '导入的世界') + '（导入）', seed: String(seed), gen: legacy ? 1 : 2, mode, flat: false,
      created: Date.now(), lastPlayed: Date.now(), time: Number(D.DayTime ?? D.Time ?? 1000n) || 1000, player: null,
      hardcore: !!(D.hardcore || (D.difficulty_settings && D.difficulty_settings.hardcore)), difficulty: { peaceful: 0, easy: 1, normal: 2, hard: 3 }[D.difficulty_settings && D.difficulty_settings.difficulty] ?? (D.Difficulty ?? 2),
      cheats: true, structures: true, bonus: false,
      spawn: spawn ? [spawn[0], spawn[1] - MIN_Y, spawn[2]] : null,
      dims, imported: { version, dataVersion: dvId, chunks: stats.chunks, perDim: stats.perDim, at: Date.now() },
    };
    await DB.putWorld(meta);
    stats.missing = [...missing].sort((a, b) => b[1] - a[1]);
    stats.substituted = [...substituted].sort((a, b) => b[1] - a[1]);
    return { meta, stats };
  }
  return { run, fromFileList, convertChunk, regionChunks, stateOf, missing };
})();
