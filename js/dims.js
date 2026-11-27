'use strict';
// ---------------------------------------------------------------------------
// Dimensions (Overworld / Nether / End), portals, fire, spawners, the dragon
// fight and the ending.
// ---------------------------------------------------------------------------
const DIM_CN = { overworld: '主世界', nether: '下界', end: '末地' };


Game.prototype.makeWorld = function (dim) {
  const w = new World(seed32(this.worldMeta ? this.worldMeta.seed : this.world.seed), dim);
  // gen-2 worlds: overworld and Nether come from the vanilla generator (the End keeps its own)
  if ((dim === 'overworld' || dim === 'nether') && this.worldMeta && this.worldMeta.gen === 2) { w.gen2 = true; w.minY = dim === 'overworld' ? MIN_Y : 0; w.seedStr = String(this.worldMeta.seed); }
  w.grassMap = this.renderer.grassMap; w.foliageMap = this.renderer.foliageMap;
  w.listener = this;
  // 世界预设（原版 WorldPresets）：normal / flat / flat_all_dimensions / large_biomes / amplified /
  // single_biome_surface / debug_all_block_states，逐维度落到生成器上
  const m = this.worldMeta || {};
  const wt = m.worldType || (m.flat ? 'flat' : 'normal');
  w.applyPreset(wt, m);
  // 新版超平坦底层对齐 1.18：内部 0 对应世界 -64，地表仍在世界 60；旧存档没有 flatBottom，保持原样
  if (w.flat && dim === 'overworld' && m.flatBottom === -64) w.minY = -64;
  w.experiments = m.experiments || {};
  w.structures = !this.worldMeta || this.worldMeta.structures !== false;
  return w;
};
Game.prototype.dimStoreId = function (dim) { return dim === 'overworld' ? this.worldMeta.id : this.worldMeta.id + '~' + dim; };

// Called from loadWorld: prepare the starting dimension
Game.prototype.initDims = async function (meta) {
  this.dimData = {};
  this.dim = meta.dim || 'overworld';
  meta.dims = meta.dims || {};
  if (!meta.dims.overworld) meta.dims.overworld = { blockEntities: meta.blockEntities || {}, mobs: meta.mobs || [] };
  meta.portals = meta.portals || { overworld: [], nether: [] };
  meta.end = meta.end || { dragonKilled: false, dragonSpawned: false, credits: false };
  const d = await this.loadDimData(this.dim);
  this.applyDim(d);
};
Game.prototype.loadDimData = async function (dim) {
  if (this.dimData[dim]) return this.dimData[dim];
  const w = this.makeWorld(dim);
  // 超平坦主世界：结构引擎是异步解压的，必须在开始生成区块前把原版村庄蓝图准备好
  if (dim === 'overworld' && w.flat) {
    try { await w.prepareFlatVillage(); } catch (e) { console.warn('flat village:', e); }
  }
  // which chunks have saved data; each record is read when its chunk loads (savedReady)
  w.savedStore = this.dimStoreId(dim);
  w.savedIndex = await DB.chunkKeys(w.savedStore);
  w.savedChunks = new Map();
  const md = this.worldMeta.dims[dim] || { blockEntities: {}, mobs: [] };
  const d = { dim, world: w, entities: [], blockEntities: new Map(Object.entries(md.blockEntities || {})), pendingMobs: (md.mobs || []).slice(), dirtySaved: new Set() };
  this.dimData[dim] = d;
  return d;
};
Game.prototype.applyDim = function (d) {
  this.dim = d.dim; this.world = d.world; this.entities = d.entities; this.blockEntities = d.blockEntities;
  this.pendingMobs = d.pendingMobs; this.dirtySaved = d.dirtySaved;
  this.genQueue = []; this._lastCC = null; this.particles.list = [];
  for (const e of this.entities) e.world = this.world;
};
// keep the current dimension in memory but release its chunks and GPU meshes
Game.prototype.stashDim = function () {
  const w = this.world, d = this.dimData[this.dim];
  for (const ch of w.chunks.values()) {
    if (ch.modified) { const k = ckey(ch.cx, ch.cz); w.savedChunks.set(k, encodeChunk(ch)); if (w.savedIndex) w.savedIndex.add(k); d.dirtySaved.add(k); }
    this.renderer.dropChunk(ch.cx, ch.cz);
  }
  w.chunks.clear();
  this.renderer.clearSections();
  d.entities = this.entities.filter(e => !e.dead && !(e instanceof ItemEntity && e.age > 5000));
  d.pendingMobs = this.pendingMobs;
};
// Switch dimension; `place` runs once the destination chunks are loaded and must position the player
Game.prototype.changeDimension = async function (target, pos, place) {
  if (this.state !== 'play') return;
  this.state = 'switching';
  const ls = new LoadingScreen(this, target === 'nether' ? '正在进入下界…' : target === 'end' ? '正在进入末地…' : '正在返回主世界…');
  ls.keepPointer = true;
  this.ui.open(ls);
  this.stashDim();
  const d = await this.loadDimData(target);
  this.applyDim(d);
  const p = this.player;
  p.world = this.world;
  p.pos = [...pos]; p.prev = [...pos]; p.vel = [0, 0, 0]; p.fallDist = 0; p.fire = 0;
  this.sleeping = null; this.breaking = null;
  this.onDimReady = place || null;
  this.state = 'loading';
  Sound.ev('block.portal.travel', null, 0.25, 0.8 + Math.random() * 0.4);
};

// ---- saving all dimensions --------------------------------------------------------------------
Game.prototype.collectDimSave = function () {
  const m = this.worldMeta, out = [];
  // current dimension: refresh in-memory data
  const cur = this.dimData[this.dim];
  cur.entities = this.entities; cur.pendingMobs = this.pendingMobs;
  for (const [dim, d] of Object.entries(this.dimData)) {
    const w = d.world, list = [];
    if (dim === this.dim) for (const ch of w.chunks.values()) if (ch.modified) { const rec = encodeChunk(ch), k = ckey(ch.cx, ch.cz); w.savedChunks.set(k, rec); if (w.savedIndex) w.savedIndex.add(k); list.push([ch.cx, ch.cz, rec]); ch.modified = false; }
    for (const k of d.dirtySaved) { const rec = w.savedChunks.get(k); if (rec) list.push([Math.floor(k / 65536) - 32768, (k % 65536) - 32768, rec]); }
    d.dirtySaved.clear();
    const ents = (dim === this.dim ? this.entities : d.entities);
    m.dims[dim] = {
      blockEntities: Object.fromEntries(d.blockEntities),
      mobs: ents.filter(e => !e.dead && this.isSavedEntity(e)).map(e => this.mobRecord(e)).concat(d.pendingMobs || []),
    };
    out.push([this.dimStoreId(dim), list]);
  }
  m.dim = this.dim;
  delete m.blockEntities; delete m.mobs;
  return out;
};

// the entities a save keeps, and the record each is saved as (restoreMob reads it back)
Game.prototype.isSavedEntity = function (e) { return (e instanceof Mob && e.persistent) || e instanceof EnderDragon || e instanceof EndCrystal || e.isVehicle || e.keepSaved; };
Game.prototype.mobRecord = function (e) {
  return { type: e.type, pos: [...e.pos], yaw: e.yaw, health: e.health, sheared: e.sheared, wool: e.woolColor, baby: e.baby ? e.growT : 0, size: typeof e.size === 'number' ? e.size : undefined, x: e.saveData ? e.saveData() : undefined, ride: e.vehicleRef && !e.remote ? 1 : undefined };
};
// Chunks that unload take their entities with them, like vanilla's: the saved kinds go back to the pending
// list (restored when the chunk loads again, and saved from there), mobs that may despawn are dropped (they
// would despawn that far away anyway), and the rest - dropped items, orbs, arrows - wait in the world's
// parked list until their chunk comes back (they are not saved, as before). Until now they all stayed in the
// entity list without ticking, so they never despawned and wandering far piled them up for good.
Game.prototype.parkEntities = function (gone) {
  const p = this.player, w = this.world, keep = [];
  for (const e of this.entities) {
    const k = ckey(Math.floor(e.pos[0]) >> 4, Math.floor(e.pos[2]) >> 4);
    if (e.dead || e === p || e.alwaysTick || e.remote || !gone.has(k) || p.vehicle === e || e.leashHolder === p) { keep.push(e); continue; }
    if (this.isSavedEntity(e)) this.pendingMobs.push(this.mobRecord(e));
    else if (!(e instanceof Mob)) {
      const parked = w.parked || (w.parked = new Map());
      if (!parked.has(k)) parked.set(k, []);
      parked.get(k).push(e);
    }
  }
  this.entities = keep;
};

Game.prototype.restoreMob = function (m) {
  const e = createMob(this, m.type, m.pos[0], m.pos[1], m.pos[2]);
  e.yaw = m.yaw || 0;
  if (m.health != null && e.health != null) e.health = m.health;
  if (e instanceof Mob) {
    e.sheared = m.sheared; e.woolColor = m.wool || 0;
    if (m.baby) { e.makeBaby(); e.growT = m.baby; }
    if (m.size && e.setSize) { e.setSize(m.size); e.health = m.health; }
    if (m.x && e.loadData) e.loadData(m.x);
    if (m.ride) e.wantsRide = true; // (seatPassengers puts it back in its boat / minecart)
    e.persistent = true;
  } else if (m.x && e.loadData) e.loadData(m.x); // boats, minecarts
  return e;
};

// ---- environment per dimension ----------------------------------------------------------------
Game.prototype.dimEnv = function (env) {
  if (this.dim === 'nether') {
    // vanilla nether wastes fog #330808; the nether is "foggy": 5% .. 50% of the view distance.
    // Gen-2 Nethers take the fog colour of the surrounding biomes (blended over nearby quarts like vanilla)
    let fog = [51 / 255, 8 / 255, 8 / 255];
    const R = this.renderer.renderDist * 16, p = this.player;
    if (this.world.gen2 && p) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) {
        const v = this.vbiomeAt(Math.floor(p.pos[0]) + dx, Math.floor(p.pos[2]) + dz);
        if (v && v.fog) { r += v.fog[0]; g += v.fog[1]; b += v.fog[2]; n++; }
      }
      if (n) {
        const t = [r / n / 255, g / n / 255, b / n / 255], f = this._netherFog || t;
        this._netherFog = f.map((v, i) => v + (t[i] - v) * 0.05);
        fog = this._netherFog;
      }
    }
    return Object.assign(env, { day: 0, fogColor: fog, skyColor: fog, starBright: 0, sunAlpha: 0, rain: 0, fogNear: R * 0.05, fogFar: Math.min(R, 192) * 0.5, ambient: [0.55, 0.42, 0.38], nightTint: [1, 1, 1], cloudColor: [0, 0, 0], sky: 'none' });
  }
  if (this.dim === 'end') {
    // vanilla end fog: #A080A0 x 0.15, normal terrain fog band
    const fog = [160 / 255 * 0.15, 128 / 255 * 0.15, 160 / 255 * 0.15], R = this.renderer.renderDist * 16;
    return Object.assign(env, { day: 0, fogColor: fog, skyColor: fog, starBright: 0, sunAlpha: 0, rain: 0, fogNear: R - clamp(R / 10, 4, 64), fogFar: R, ambient: [0.36, 0.33, 0.4], nightTint: [1, 1, 1], cloudColor: [0, 0, 0], sky: 'end' });
  }
  env.ambient = [0.03 + 0.11 * this.renderer.gamma, 0.03 + 0.11 * this.renderer.gamma, 0.03 + 0.11 * this.renderer.gamma];
  env.sky = 'overworld';
  return env;
};

// ---- portals -----------------------------------------------------------------------------------
// Try to light a nether portal whose interior contains (x,y,z). Returns true on success.
Game.prototype.tryLightPortal = function (x, y, z) {
  const w = this.world;
  if (this.dim === 'end') return false;
  const isFrame = (id) => id === 28;
  const inner = (id) => id === 0 || id === 171;
  for (const axis of [0, 1]) {
    const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
    if (!inner(w.getBlock(x, y, z))) return false;
    let by = y; while (by > y - 22 && inner(w.getBlock(x, by - 1, z))) by--;
    if (!isFrame(w.getBlock(x, by - 1, z))) continue;
    let left = 0; while (left < 22 && inner(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) left++;
    if (!isFrame(w.getBlock(x - dx * (left + 1), by, z - dz * (left + 1)))) continue;
    const x0 = x - dx * left, z0 = z - dz * left;
    let width = 0; while (width < 22 && inner(w.getBlock(x0 + dx * width, by, z0 + dz * width))) width++;
    if (width < 2 || width > 21 || !isFrame(w.getBlock(x0 + dx * width, by, z0 + dz * width))) continue;
    let height = 0; while (height < 22 && inner(w.getBlock(x0, by + height, z0))) height++;
    if (height < 3 || height > 21) continue;
    let ok = true;
    for (let i = 0; i < width && ok; i++) {
      if (!isFrame(w.getBlock(x0 + dx * i, by - 1, z0 + dz * i)) || !isFrame(w.getBlock(x0 + dx * i, by + height, z0 + dz * i))) ok = false;
      for (let j = 0; j < height && ok; j++) if (!inner(w.getBlock(x0 + dx * i, by + j, z0 + dz * i))) ok = false;
    }
    for (let j = 0; j < height && ok; j++) if (!isFrame(w.getBlock(x0 - dx, by + j, z0 - dz)) || !isFrame(w.getBlock(x0 + dx * width, by + j, z0 + dz * width))) ok = false;
    if (!ok) continue;
    for (let i = 0; i < width; i++) for (let j = 0; j < height; j++) w.setBlock(x0 + dx * i, by + j, z0 + dz * i, 170, axis, 0);
    this.recordPortal(this.dim, [x0, by, z0, axis]);
    Sound.ev('block.portal.trigger', [x, y, z], 0.4, 1.4);
    this.flushMesh();
    return true;
  }
  return false;
};
Game.prototype.recordPortal = function (dim, p) {
  const list = this.worldMeta.portals[dim] || (this.worldMeta.portals[dim] = []);
  if (!list.some(q => Math.abs(q[0] - p[0]) < 4 && Math.abs(q[1] - p[1]) < 4 && Math.abs(q[2] - p[2]) < 4)) list.push(p);
};
Game.prototype.portalValid = function (x, y, z) {
  const w = this.world, axis = w.getMeta(x, y, z) & 1;
  const ok = (id) => id === 170 || id === 28;
  const dx = axis === 0 ? 1 : 0, dz = axis === 0 ? 0 : 1;
  return ok(w.getBlock(x, y + 1, z)) && ok(w.getBlock(x, y - 1, z)) && ok(w.getBlock(x + dx, y, z + dz)) && ok(w.getBlock(x - dx, y, z - dz));
};
// player standing in portal blocks
const END_GATEWAY = 2091;
Game.prototype.tickPortals = function () {
  const p = this.player, w = this.world, b = p.box();
  if (!p.portalT) p.portalT = 0;
  let inNether = false, inEnd = false, inGateway = false;
  for (let x = Math.floor(b[0]); x <= Math.floor(b[3]); x++) for (let y = Math.floor(b[1]); y <= Math.floor(b[4]); y++) for (let z = Math.floor(b[2]); z <= Math.floor(b[5]); z++) {
    const id = w.getBlock(x, y, z);
    if (id === 170) inNether = true;
    else if (id === 175 && b[1] < y + 0.75) inEnd = true;
    else if (id === END_GATEWAY) inGateway = true;
  }
  if (inGateway && this.dim === 'end' && !p.portalLock) { p.portalLock = true; this.enterEndGateway(); return; }
  if (inEnd && !p.portalLock) { p.portalLock = true; this.enterEndPortal(); return; }
  if (inNether && p.deathTime === 0) {
    if (!p.portalLock) {
      if (p.portalT === 0) Sound.ev('block.portal.trigger', null, 0.25, 0.8 + Math.random() * 0.4);
      p.portalT++;
      if (p.portalT >= (p.creative ? 1 : 80)) { p.portalLock = true; p.portalT = 0; this.useNetherPortal(); }
    }
  } else {
    p.portalT = Math.max(0, (p.portalT || 0) - 4);
    if (!inEnd && !inNether && !inGateway) p.portalLock = false;
  }
  this.portalOverlay = Math.min(1, (p.portalT || 0) / 80);
};
Game.prototype.useNetherPortal = function () {
  const p = this.player, toNether = this.dim === 'overworld';
  const target = toNether ? 'nether' : 'overworld', scale = toNether ? 1 / 8 : 8;
  const tx = Math.floor(p.pos[0] * scale), tz = Math.floor(p.pos[2] * scale);
  const list = this.worldMeta.portals[target] || [], range = toNether ? 16 : 128;
  let best = null, bd = 1e9;
  for (const q of list) { const d = Math.hypot(q[0] - tx, q[2] - tz); if (d < range && d < bd) { bd = d; best = q; } }
  const dest = best ? [best[0] + 0.5, best[1], best[2] + 0.5] : [tx + 0.5, (this.worldMeta.worldType === 'flat_all') ? (toNether ? 4 : -59) : (toNether ? 70 : 80), tz + 0.5];
  this.changeDimension(target, dest, () => {
    const w = this.world;
    if (best && w.getBlock(best[0], best[1], best[2]) === 170) this.placeAtPortal(best);
    else this.placeAtPortal(this.buildPortalNear(best ? best[0] : tx, best ? best[2] : tz));
    if (target === 'nether') { advFlag(this, 'netherEnter'); this.grant('nether/root'); this.grant('story/enter_the_nether'); this.checkAdvancements(); }
  });
};
Game.prototype.placeAtPortal = function (q) {
  const p = this.player, [x, y, z, axis] = q;
  p.pos = [x + (axis === 0 ? 1 : 0.5), y, z + (axis === 0 ? 0.5 : 1)]; p.prev = [...p.pos];
  p.yaw = axis === 0 ? 0 : Math.PI / 2; p.portalLock = true; p.portalT = 0;
};
// find a spot and build a 4x5 obsidian portal with platform; returns [x0,y,z0,axis]
Game.prototype.buildPortalNear = function (tx, tz) {
  const w = this.world, nether = this.dim === 'nether';
  const fits = (x, y, z) => {
    for (let i = -1; i <= 2; i++) for (let k = -1; k <= 1; k++) {
      if (!SOLIDCUBE[w.getBlock(x + i, y - 1, z + k)]) return false;
      for (let j = 0; j < 4; j++) { const id = w.getBlock(x + i, y + j, z + k); if (id && !REPLACEABLE[id]) return false; }
    }
    return true;
  };
  let spot = null;
  const flatNether = nether && w.flatAll;
  const flatBase = flatNether ? w.flatTopY() + (w.minY || 0) : 0;
  outer: for (let r = 0; r <= 12; r += 2) for (let a = 0; a < (r ? 8 : 1); a++) {
    const x = tx + Math.round(Math.cos(a / 8 * Math.PI * 2) * r), z = tz + Math.round(Math.sin(a / 8 * Math.PI * 2) * r);
    if (nether) {
      const y0 = flatNether ? flatBase + 4 : 100, y1 = flatNether ? flatBase + 1 : 33;
      for (let y = y0; y > y1 - 1; y--) if (fits(x, y, z)) { spot = [x, y, z]; break outer; }
    }
    else { const y = w.surfaceY(x, z) + 1; if (y > SEA && y < HEIGHT - 16 && fits(x, y, z)) { spot = [x, y, z]; break outer; } }
  }
  if (!spot) {
    let y = nether ? (flatNether ? flatBase + 1 : 70) : Math.max(SEA + 2, w.surfaceY(tx, tz) + 1);
    spot = [tx, y, tz];
    for (let i = -2; i <= 3; i++) for (let k = -2; k <= 2; k++) {
      w.setBlock(tx + i, y - 1, tz + k, 28, 0, 0);
      for (let j = 0; j < 5; j++) w.setBlock(tx + i, y + j, tz + k, 0, 0, 0);
    }
  }
  const [x, y, z] = spot;
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const edge = i === -1 || i === 2 || j === -1 || j === 3;
    w.setBlock(x + i, y + j, z, edge ? 28 : 170, 0, 0);
  }
  for (let i = -1; i <= 2; i++) for (const k of [-1, 1]) { if (!SOLIDCUBE[w.getBlock(x + i, y - 1, z + k)]) w.setBlock(x + i, y - 1, z + k, 28, 0, 0); for (let j = 0; j < 3; j++) if (w.getBlock(x + i, y + j, z + k) && !REPLACEABLE[w.getBlock(x + i, y + j, z + k)]) w.setBlock(x + i, y + j, z + k, 0, 0, 0); }
  const q = [x, y, z, 0];
  this.recordPortal(this.dim, q);
  return q;
};

// ---- End portal ----------------------------------------------------------------------------------
Game.prototype.fillEndFrame = function (x, y, z) {
  const w = this.world;
  w.setMeta(x, y, z, w.getMeta(x, y, z) | 4);
  Sound.ev('block.end_portal_frame.fill', [x, y, z], 1, 1);
  for (let i = 0; i < 12; i++) this.particles.spawn('smoke', x + 0.2 + Math.random() * 0.6, y + 1, z + 0.2 + Math.random() * 0.6, 0, 0.02, 0);
  const isEye = (a, b, c) => w.getBlock(a, b, c) === 174 && (w.getMeta(a, b, c) & 4);
  for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
    let ok = true;
    for (let k = -1; k <= 1 && ok; k++) ok = isEye(cx + k, y, cz - 2) && isEye(cx + k, y, cz + 2) && isEye(cx - 2, y, cz + k) && isEye(cx + 2, y, cz + k);
    if (!ok) continue;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) w.setBlock(cx + a, y, cz + b, 175, 0);
    Sound.ev('block.end_portal.spawn', null, 1, 1);
    this.ui.message('末地传送门已激活！', '#AA55FF');
    this.flushMesh();
    return;
  }
};
Game.prototype.enterEndPortal = function () {
  if (this.dim === 'end') { this.leaveEnd(); return; }
  const flatEnd = this.worldMeta.worldType === 'flat_all';
  const by = flatEnd ? 3 : 48, py = flatEnd ? 4 : 49;
  this.changeDimension('end', [100.5, py, 0.5], () => {
    const w = this.world;
    for (let x = 98; x <= 102; x++) for (let z = -2; z <= 2; z++) {
      w.setBlock(x, by, z, 28, 0, 0);
      for (let y = by + 1; y <= by + 3; y++) w.setBlock(x, y, z, 0, 0, 0);
    }
    const p = this.player; p.pos = [100.5, py, 0.5]; p.prev = [...p.pos]; p.yaw = Math.PI / 2;
    this.grant('story/enter_the_end'); this.grant('end/root'); this.checkAdvancements();
    this.setupDragonFight();
  });
};
// ---- 末地折跃门（中央岛 ↔ 外岛浮空岛） ----
Game.prototype.isOuterIsland = function () {
  const p = this.player, w = this.world;
  const d = Math.hypot(p.pos[0], p.pos[2]);
  // 与原版一致：外岛只出现在距原点 1024 格之外，1024 以内（含主岛周边虚空）都算中央岛一侧
  return d >= 1000;
};
Game.prototype.enterEndGateway = function () {
  advFlag(this, 'gateway');
  if (this.isOuterIsland()) this.travelToMainIsland();
  else this.travelToOuterIsland();
};
Game.prototype.travelToOuterIsland = function () {
  const w = this.world, p = this.player, dest = w.findEndIsland();
  const cx = Math.floor(dest[0] / 16), cz = Math.floor(dest[2] / 16);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.loadChunk(cx + a, cz + b);
  p.pos = [...dest]; p.prev = [...dest]; p.vel = [0, 0, 0]; p.fallDist = 0;
  let y = dest[1]; while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
  p.prev = [...p.pos];
  this.placeReturnGateway(dest);
  Sound.ev('block.portal.travel', null, 0.25, 0.8 + Math.random() * 0.4);
  advFlag(this, 'endCity'); this.checkAdvancements();
  this.ui.message('已折跃到末地外岛…', '#AA55FF');
  if (this.flushMesh) this.flushMesh();
};
Game.prototype.travelToMainIsland = function () {
  const w = this.world, p = this.player, dest = [0.5, w.endTop0 + 2, 0.5];
  const cx = Math.floor(dest[0] / 16), cz = Math.floor(dest[2] / 16);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) this.loadChunk(cx + a, cz + b);
  p.pos = [...dest]; p.prev = [...dest]; p.vel = [0, 0, 0]; p.fallDist = 0;
  let y = dest[1]; while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
  p.prev = [...p.pos];
  Sound.ev('block.portal.travel', null, 0.25, 0.8 + Math.random() * 0.4);
  this.ui.message('已返回末地中央岛', '#AA55FF');
  if (this.flushMesh) this.flushMesh();
};
// 原版 TheEndGatewayBlockEntity.triggerEvent + spawnGatewayPortal：
// 原版 EndGatewayFeature.place：3×5×3 范围逐格判定——中心一格 END_GATEWAY；同一层其余 8 格空气；
// 上下各两层里，一层是中心加四向的十字 5 格基岩，再一层只有中心一格基岩，其余全部清空成空气
Game.prototype.buildEndGateway = function (px, gy, pz) {
  const w = this.world, BED = BID.bedrock !== undefined ? BID.bedrock : 6;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) {
    const x = px + dx, y = gy + dy, z = pz + dz;
    if (y < 1 || y >= HEIGHT || !w.isLoaded(x, z)) continue;
    const sameX = dx === 0, sameY = dy === 0, sameZ = dz === 0, end = Math.abs(dy) === 2;
    let id = 0;
    if (sameX && sameY && sameZ) id = END_GATEWAY;
    else if (sameY) id = 0;
    else if (end && sameX && sameZ) id = BED;
    else if ((!sameX && !sameZ) || end) id = 0;
    else id = BED;
    w.setBlock(x, y, z, id, 0, 1);
  }
};
// 门放在「落点周围 16 格内最高的实心方块上方 10 格」，外形是 EndGatewayFeature 的 3×5×3 门座
// （中心一格折跃门、上下各 2 格基岩柱、四向十字基岩托架，其余清空）。
Game.prototype.placeReturnGateway = function (dest) {
  const w = this.world;
  const px = Math.round(dest[0]), pz = Math.round(dest[2]);
  if (!w.isLoaded(px, pz)) return;
  let top = Math.round(dest[1]) - 1;
  for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) {
    const x = px + dx, z = pz + dz;
    if (!w.isLoaded(x, z)) continue;
    for (let y = Math.min(HEIGHT - 1, 200); y > top; y--) {
      const id = w.getBlock(x, y, z);
      if (id && BLOCKS[id] && BLOCKS[id].solid) { top = y; break; }
    }
  }
  const gy = Math.min(HEIGHT - 8, top + 10);
  // 已经有一座门就只补光柱，不重复铺基岩
  if (w.getBlock(px, gy, pz) === END_GATEWAY) { this._gatewayBeam(px, gy, pz); return; }
  this.buildEndGateway(px, gy, pz);
  Sound.ev('block.end_gateway.spawn', [px, gy, pz], 1, 1);
  this._gatewayBeam(px, gy, pz);
};
// 折跃门瞬态光柱（原版 end_gateway_beam：出生 spawning 向上品红束，冷却 cooling 向下紫束，待机消失）
Game.prototype._gatewayBeam = function (x, y, z) {
  this.gatewayBeams = this.gatewayBeams || [];
  if (this.gatewayBeams.some(b => b.x === x && b.y === y && b.z === z)) return;
  this.gatewayBeams.push({ x: x, y: y, z: z, born: this.worldTime });
};
Game.prototype.drawGatewayBeams = function (a) {
  const beams = this.gatewayBeams;
  if (!beams || !beams.length) return;
  const r = this.renderer, cam = r.camPos, t = (this.worldTime % 40) + a;
  const R = (this.settings.renderDist || 12) * 16 + 32;
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i], age = this.worldTime - b.born;
    if (age < 0 || age > 100) { beams.splice(i, 1); continue; }
    if (Math.hypot(b.x + 0.5 - cam[0], b.z + 0.5 - cam[2]) > R) continue;
    const up = age < 50; // 前半段出生向上品红束，后半段冷却向下紫束
    const col = up ? [0.95, 0.25, 0.85, 0.8] : [0.55, 0.25, 0.8, 0.65];
    const lo = [b.x + 0.5, up ? b.y + 1 : b.y - 6, b.z + 0.5];
    const hi = [b.x + 0.5, up ? b.y + 20 : b.y, b.z + 0.5];
    r.drawBeam(lo, hi, 'end_gateway_beam', 0.16, col, -t * 0.2, 'alpha');
  }
};
Game.prototype.setupDragonFight = function () {
  const end = this.worldMeta.end, w = this.world;
  if (end.dragonKilled) return;
  if (!end.dragonSpawned) {
    end.dragonSpawned = true;
    for (const pl of (w.endPillars || [])) {
      // 原版 EndSpikeFeature.placeSpike：每一根黑曜石柱顶都有一块基岩，水晶坐在基岩正上方一格
      w.setBlock(pl.x, pl.h, pl.z, 6, 0, 1);
      const c = new EndCrystal(this, pl.x + 0.5, pl.h + 1, pl.z + 0.5);
      this.entities.push(c);
    }
    this.entities.push(new EnderDragon(this, 0, w.flatAll ? w.flatTopY() + (w.minY || 0) + 10 : 110, -60));
    this.ui.message('末影龙出现了……', '#AA55FF');
  }
};
Game.prototype.dragon = function () { return this.dim === 'end' ? this.entities.find(e => e instanceof EnderDragon && !e.dead) : null; };
Game.prototype.onDragonKilled = function (dr) {
  const w = this.world, end = this.worldMeta.end, first = !end.dragonKilled;
  end.dragonKilled = true;
  const yb = w.endTop0 + 1;
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const d = Math.hypot(x, z); if (d <= 2.5 && (x || z)) w.setBlock(x, yb + 1, z, 175, 0); }
  if (first) { w.setBlock(0, yb + 5, 0, 176, 0); this.dropXp(0.5, yb + 3, 0.5, 12000); } else this.dropXp(0.5, yb + 3, 0.5, 500);
  // 主岛出口折跃门：原版 EnderDragonFight——20 个位点，半径 96、y 固定 75，
  // 角度 2*(-PI + PI/20*idx)，位点顺序由世界种子洗牌决定，每击杀一次龙开启下一个
  let order = end.gatewayOrder;
  if (!order || order.length !== 20) {
    order = []; for (let i = 0; i < 20; i++) order.push(i);
    const r = RNG(hashStr(w.seed + ':gateways'));
    for (let i = 19; i > 0; i--) { const j = r.int(i + 1); const t0 = order[i]; order[i] = order[j]; order[j] = t0; }
    end.gatewayOrder = order;
  }
  const gi = end.gatewaysPlaced || 0;
  const idx = order[gi % 20];
  const a = 2 * (-Math.PI + (Math.PI / 20) * idx);
  const gx = Math.floor(96 * Math.cos(a)), gz = Math.floor(96 * Math.sin(a)), gy = 75;
  // 折跃门在半径 96 格，通常不在玩家当前加载的区块里；先把门周围 3×3 区块载入，
  // 否则 buildEndGateway 里的 isLoaded 检查会让整座门静默跳过（反馈：通往外岛的折跃门不会生成）
  const gcx = Math.floor(gx / 16), gcz = Math.floor(gz / 16);
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) this.loadChunk(gcx + ox, gcz + oz);
  end.gatewaysPlaced = gi + 1;
  this.buildEndGateway(gx, gy, gz);
  end.gateway = [gx, gy, gz];
  if (!end.gateways) end.gateways = [];
  if (!end.gateways.some(p => p[0] === gx && p[2] === gz)) end.gateways.push([gx, gy, gz]);
  Sound.ev('block.end_gateway.spawn', [gx, gy, gz], 1, 1);
  this._gatewayBeam(gx, gy, gz);
  advFlag(this, 'dragon'); this.grant('end/kill_dragon'); this.checkAdvancements();
  this.ui.message('末影龙被击败了！返回传送门与通往外岛的折跃门已经开启。', '#FFFF55');
  this.flushMesh();
};
// 重生仪式：返回传送门基座的四角站位（水晶实体落点）。
Game.prototype.endRespawnCorners = function () {
  const yb = this.world.endTop0 + 1;
  return [[-2, yb + 2, -2], [2, yb + 2, -2], [-2, yb + 2, 2], [2, yb + 2, 2]];
};
// 四角水晶齐套后复位战斗状态，重新刷出末影龙与柱顶治疗水晶。
Game.prototype.respawnDragon = function () {
  const w = this.world, end = this.worldMeta.end;
  for (const e of this.entities) if (e.type === 'end_crystal' && e.respawn) e.dead = true;
  end.respawnSlots = null;
  end.dragonKilled = false; end.dragonSpawned = true;
  for (const pl of (w.endPillars || [])) {
    w.setBlock(pl.x, pl.h, pl.z, 6, 0, 1);
    this.entities.push(new EndCrystal(this, pl.x + 0.5, pl.h + 1, pl.z + 0.5));
  }
  this.entities.push(new EnderDragon(this, 0, w.flatAll ? w.flatTopY() + (w.minY || 0) + 10 : 110, -60));
  advFlag(this, 'respawnDragon'); this.grant('end/respawn_dragon'); this.checkAdvancements();
  this.ui.message('末影龙借助水晶之力重生了……', '#AA55FF');
};
Game.prototype.leaveEnd = function () {
  const end = this.worldMeta.end;
  const go = () => {
    const s = this.player.spawn;
    this.changeDimension('overworld', [s[0] + 0.5, s[1], s[2] + 0.5], () => {
      const p = this.player;
      let y = s[1];
      while (p.collides(p.box()) && y < HEIGHT) { y++; p.pos[1] = y; }
      p.prev = [...p.pos];
    });
  };
  if (end.dragonKilled && !end.credits) { end.credits = true; this.ui.open(new CreditsScreen(this, go)); }
  else go();
};

// ---- fire --------------------------------------------------------------------------------------
const FLAMMABLE = new Set([5, 14, 15, 25, 26, 46, 47, 48, 49, 50, 51, 58, 60, 87, 104, 105, 106, 107, 115, 116, 178, 39, 40, 45, ...Array.from({ length: 16 }, (_, i) => 128 + i)]);
Game.prototype.fireSupported = function (x, y, z) {
  const w = this.world, below = w.getBlock(x, y - 1, z);
  if (SOLIDCUBE[below] || below === 119 || below === 120) return true;
  for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(x + D[0], y + D[1], z + D[2]))) return true;
  return false;
};
Game.prototype.fireTick = function (x, y, z) {
  const w = this.world, below = w.getBlock(x, y - 1, z);
  const eternal = below === 119 || below === 103 || (this.dim === 'end' && below === 6);
  if (!eternal && (this.dim === 'overworld' && this.weather > 0.5 && w.skyAt(x, y, z) >= 15 || Math.random() < 0.15)) {
    let fuel = false;
    for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(x + D[0], y + D[1], z + D[2]))) fuel = true;
    if (!fuel || Math.random() < 0.3) { w.setBlock(x, y, z, 0, 0); return; }
  }
  // spread: burn neighbours and ignite nearby air
  for (const D of DIRS) {
    const nx = x + D[0], ny = y + D[1], nz = z + D[2], id = w.getBlock(nx, ny, nz);
    if (FLAMMABLE.has(id) && Math.random() < 0.08) {
      if (id === 26) { w.setBlock(nx, ny, nz, 0, 0); this.addEntity(new PrimedTNT(this, nx, ny, nz, 40)); }
      else w.setBlock(nx, ny, nz, Math.random() < 0.6 ? 171 : 0, 0);
    }
  }
  for (let i = 0; i < 2; i++) {
    const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 4) | 0) - 1, nz = z + ((Math.random() * 3) | 0) - 1;
    if (w.getBlock(nx, ny, nz) === 0 && this.fireSupported(nx, ny, nz) && Math.random() < 0.3) {
      let fuel = false; for (const D of DIRS) if (FLAMMABLE.has(w.getBlock(nx + D[0], ny + D[1], nz + D[2]))) fuel = true;
      if (fuel) w.setBlock(nx, ny, nz, 171, 0);
    }
  }
};

// ---- spawners ------------------------------------------------------------------------------------
// Vanilla stronghold end-portal rooms put a silverfish spawner here; index 5 is that silverfish.
// Indices 0..4 stay in the old order so existing saves/other spawners keep their mob.
var SPAWNER_MOBS = ['zombie', 'skeleton', 'spider', 'blaze', 'cave_spider', 'silverfish'];
Game.prototype.tickSpawners = function () {
  const p = this.player, w = this.world, px = Math.floor(p.pos[0]), py = Math.floor(p.pos[1]), pz = Math.floor(p.pos[2]);
  this.spawnerT = this.spawnerT || new Map();
  for (let cx = (px >> 4) - 1; cx <= (px >> 4) + 1; cx++) for (let cz = (pz >> 4) - 1; cz <= (pz >> 4) + 1; cz++) {
    const ch = w.getChunk(cx, cz); if (!ch) continue;
    if (!ch.spawners) { ch.spawners = []; ch.findAll([127], (i) => ch.spawners.push([cx * 16 + (i & 15), i >> 8, cz * 16 + ((i >> 4) & 15)])); }
    for (const s of ch.spawners) {
      const [x, y, z] = s;
      if (w.getBlock(x, y, z) !== 127) continue;
      if (Math.hypot(x - px, y - py, z - pz) > 16) continue;
      if (Math.random() < 0.3) this.particles.spawn('flame', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0.01, 0);
      const k = s.join(',');
      let t = this.spawnerT.get(k);
      if (t === undefined) t = 20;
      t -= 20; // called once every 20 ticks
      if (t > 0) { this.spawnerT.set(k, t); continue; }
      this.spawnerT.set(k, 200 + Math.random() * 600);
      const type = SPAWNER_MOBS[w.getMeta(x, y, z) & 7] || 'zombie';
      const near = this.entities.filter(e => e instanceof Mob && e.type === type && e.distTo({ pos: [x, y, z] }) < 9).length;
      if (near >= 6) continue;
      for (let n = 0; n < 4; n++) {
        const sx = x + (Math.random() - 0.5) * 8, sy0 = y + ((Math.random() * 3) | 0) - 1, sz = z + (Math.random() - 0.5) * 8;
        // 要塞传送门房间的刷怪笼嵌在两层石砖之间，正下方不一定是实心方块；直接按 sy-1
        // 判定会把所有候选都拒掉（实测 15 秒一只僵尸也没有）。向下找最多 4 格地板，
        // 找到就把怪放在地板上，找不到才放弃。
        let sy = sy0;
        if (!MOB_TYPES[type] || !MOB_TYPES[type].flying) {
          let fy = Math.floor(sy0) - 1;
          while (fy > sy0 - 5 && !BLOCKS[w.getBlock(Math.floor(sx), fy, Math.floor(sz))].solid) fy--;
          if (!BLOCKS[w.getBlock(Math.floor(sx), fy, Math.floor(sz))].solid) continue;
          sy = fy + 1;
        }
        const m = createMob(this, type, Math.floor(sx) + 0.5, sy, Math.floor(sz) + 0.5);
        if (m.collides(m.box())) continue;
        m.persistent = false;
        this.entities.push(m);
        for (let i = 0; i < 10; i++) this.particles.spawn('smoke', m.pos[0] + (Math.random() - 0.5), m.pos[1] + Math.random() * m.h, m.pos[2] + (Math.random() - 0.5), 0, 0.02, 0);
      }
    }
  }
};

// ---- per-dimension mob spawning ------------------------------------------------------------------
Game.prototype.spawnMobsDim = function () {
  const p = this.player, w = this.world;
  if (this.difficulty === 0) return;
  if (this.dim === 'nether' && w.gen2 && this.spawnNetherV) return this.spawnNetherV();
  const hostiles = this.entities.filter(e => e instanceof Mob && e.T.hostile).length;
  if (this.dim === 'end') {
    if (hostiles >= 24) return;
    for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2, d = 16 + Math.random() * 40;
      const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
      if (!w.isLoaded(x, z)) continue;
      const y = w.surfaceY(x, z) + 1;
      if (y < 10 || w.getBlock(x, y - 1, z) !== 172) continue;
      const m = new Enderman(this, x + 0.5, y, z + 0.5);
      if (!m.collides(m.box())) this.entities.push(m);
    }
    return;
  }
  if (this.dim !== 'nether' || hostiles >= 24) return;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = Math.random() * Math.PI * 2, d = 20 + Math.random() * 40;
    const x = Math.floor(p.pos[0] + Math.sin(a) * d), z = Math.floor(p.pos[2] + Math.cos(a) * d);
    if (!w.isLoaded(x, z)) continue;
    let y = Math.floor(p.pos[1]) + ((Math.random() * 40) | 0) - 20;
    y = clamp(y, 32, 120);
    while (y > 31 && w.getBlock(x, y, z) !== 0) y++;
    while (y > 31 && w.getBlock(x, y - 1, z) === 0) y--;
    if (y <= 31 || w.getBlock(x, y + 1, z) !== 0 || !SOLIDCUBE[w.getBlock(x, y - 1, z)]) continue;
    const r = Math.random();
    let type;
    if (w.inFortress(x, y, z) && r < 0.5) type = 'blaze';
    else if (r < 0.55) type = 'zombified_piglin';
    else if (r < 0.7) type = 'magma_cube';
    else if (r < 0.82) type = 'ghast';
    else if (r < 0.88) type = 'enderman';
    else continue;
    if (type === 'ghast') {
      let ok = true;
      for (let dy = 2; dy < 8 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx += 2) for (let dz = -2; dz <= 2 && ok; dz += 2) if (w.getBlock(x + dx, y + dy, z + dz) !== 0) ok = false;
      if (!ok || this.entities.filter(e => e instanceof Ghast).length >= 3) continue;
      this.entities.push(new Ghast(this, x + 0.5, y + 3, z + 0.5));
      continue;
    }
    const n = type === 'zombified_piglin' ? 2 + ((Math.random() * 3) | 0) : 1;
    for (let i = 0; i < n; i++) {
      const m = createMob(this, type, x + 0.5 + (i ? (Math.random() - 0.5) * 3 : 0), y, z + 0.5 + (i ? (Math.random() - 0.5) * 3 : 0));
      if (type === 'magma_cube') m.setSize([1, 2, 4][(Math.random() * 3) | 0]);
      if (!m.collides(m.box())) this.entities.push(m);
    }
  }
};

// endermen notice being stared at
Game.prototype.checkEnderStare = function () {
  const p = this.player;
  if (p.creative || p.deathTime > 0) return;
  const eye = [p.pos[0], p.pos[1] + p.eye(), p.pos[2]], dir = this.lookDir();
  for (const e of this.entities) {
    if (!(e instanceof Enderman) || e.angry || e.deathTime > 0) continue;
    const hx = e.pos[0] - eye[0], hy = e.pos[1] + 2.6 - eye[1], hz = e.pos[2] - eye[2], d = Math.hypot(hx, hy, hz);
    if (d > 64 || d < 0.5) continue;
    // (vanilla isLookingAtMe: 1 - 0.025 / d - it was half as wide again: angry without being looked at, feedback 2026-11-01/02)
    if ((hx * dir[0] + hy * dir[1] + hz * dir[2]) / d > 1 - 0.025 / d && e.canSee(p)) {
      if (p.inv.slots[36] && ITEMS[p.inv.slots[36].id].key === 'carved_pumpkin') continue;
      e.provoke(p);
      Sound.ev('entity.enderman.stare', e.pos, 1, 1);
      if (d > 8) teleportEntity(e, p.pos[0] + (Math.random() - 0.5) * 4, p.pos[1] + 1, p.pos[2] + (Math.random() - 0.5) * 4);
    }
  }
};

// ---- locate helpers -------------------------------------------------------------------------------
Game.prototype.nearestStronghold = function () {
  const p = this.player;
  let best = null, bd = 1e9;
  const w = this.dim === 'overworld' ? this.world : this.dimData.overworld && this.dimData.overworld.world;
  if (!w) return null;
  for (const s of w.strongholds()) { const d = Math.hypot(s.x - p.pos[0], s.z - p.pos[2]); if (d < bd) { bd = d; best = s; } }
  return best;
};

// ---- bed explosions ---------------------------------------------------------------------------------
Game.prototype.bedExplode = function (x, y, z) {
  const w = this.world, meta = w.getMeta(x, y, z);
  const R = [4, 1, 5, 0][meta & 3], D2 = DIRS[(meta & 4) ? OPP[R] : R];
  w.setBlock(x + D2[0], y, z + D2[2], 0, 0, 0);
  w.setBlock(x, y, z, 0, 0);
  this.explode(x + 0.5, y + 0.5, z + 0.5, 5, null, false, true);
};

// ---- credits ---------------------------------------------------------------------------------------
class CreditsScreen extends MenuScreen {
  constructor(game, onDone) {
    super(game, null); this.onDone = onDone; this.pauses = true; this.t = 0; this.last = performance.now(); this.bgDim = 0; this.blurBg = false;
    const lines = [];
    const T = window.MC_TEXTS || {};
    const fmt = (s) => s.replace(/PLAYERNAME/g, '玩家');
    for (let i = 0; i < 6; i++) lines.push({ t: '' });
    lines.push({ logo: true }, { t: '' }, { t: '' });
    if (T['end.txt']) {
      for (const raw of T['end.txt'].split('\n')) {
        let col = '#FFFFFF', s = fmt(raw);
        const m = s.match(/^§(.)/);
        if (m) { col = { '2': '#00AA00', '3': '#00AAAA', 'f': '#FFFFFF', '7': '#AAAAAA' }[m[1]] || '#FFFFFF'; }
        s = s.replace(/§k([^§]*)/g, (a, b) => '\u0001' + b + '\u0002').replace(/§./g, '');
        for (const w of this.wrap(s, 274)) lines.push({ t: w, col });
        lines.push({ t: '' });
      }
    }
    for (let i = 0; i < 4; i++) lines.push({ t: '' });
    try {
      const credits = JSON.parse(T['credits.json'] || '[]');
      for (const sec of credits) {
        lines.push({ t: '' }, { t: '============', col: '#FFFFFF', center: true }, { t: sec.section, col: '#FFFF55', center: true }, { t: '============', col: '#FFFFFF', center: true }, { t: '' });
        for (const d of sec.disciplines || []) {
          if (d.discipline) lines.push({ t: d.discipline, col: '#AAAAAA', center: true }, { t: '' });
          for (const ti of d.titles || []) {
            lines.push({ t: ti.title, col: '#777777', center: true });
            for (const n of ti.names || []) lines.push({ t: n, col: '#FFFFFF', center: true });
            lines.push({ t: '' });
          }
        }
      }
    } catch (e) { }
    if (T['postcredits.txt']) for (const raw of T['postcredits.txt'].split('\n')) for (const w of this.wrap(raw.replace(/§./g, ''), 274)) lines.push({ t: w, col: '#FFFFFF', center: true });
    lines.push({ t: '' }, { t: '本作品为非官方复刻 · 感谢游玩！', col: '#FFFF55', center: true });
    this.lines = lines;
  }
  wrap(s, maxW) {
    const out = []; let cur = '';
    for (const word of s.split(' ')) {
      const test = cur ? cur + ' ' + word : word;
      if (Font.width(test.replace(/[\u0001\u0002]/g, '')) > maxW && cur) { out.push(cur); cur = word; } else cur = test;
    }
    out.push(cur);
    return out;
  }
  layout() { }
  draw(ui) {
    const c = ui.ctx, now = performance.now(), dt = Math.min(100, now - this.last); this.last = now;
    const h = this.held || {}, fast = h.Space || h.ControlLeft || h.ControlRight;
    this.t += dt * (fast ? 0.12 : 0.025);
    c.fillStyle = '#000'; c.fillRect(0, 0, ui.w, ui.h);
    const x0 = Math.floor(ui.w / 2 - 137);
    let y = ui.h - this.t;
    for (const L of this.lines) {
      if (y > -20 && y < ui.h + 10) {
        if (L.logo) { c.imageSmoothingEnabled = true; c.drawImage(ui.img.logo, 0, 0, 1024, 256, ui.w / 2 - 137, y - 10, 274, 68); c.imageSmoothingEnabled = false; }
        else if (L.t) {
          let s = L.t;
          if (s.includes('\u0001')) s = s.replace(/\u0001([^\u0002]*)\u0002/g, (a, b) => b.split('').map(ch => ch === ' ' ? ' ' : String.fromCharCode(33 + ((Math.random() * 90) | 0))).join(''));
          if (L.center) Font.center(c, s, ui.w / 2, y, L.col || '#FFFFFF'); else Font.draw(c, s, x0, y, L.col || '#FFFFFF');
        }
      }
      y += L.logo ? 80 : 12;
    }
    if (y < -20) this.finish();
    Font.draw(c, '按住空格加速 · Esc 跳过', 4, ui.h - 12, '#555555');
  }
  finish() {
    if (this.done) return; this.done = true;
    removeEventListener('keyup', this.unhold); removeEventListener('blur', this.unhold);
    this.game.ui.screen = null; this.onDone();
  }
  // (the touch close button: through onEsc - ui.close() left the player in the End)
  onEsc() { this.finish(); }
  // speeding up while space or ctrl is held (vanilla WinScreen): every key stops here, so game.keys never had them -
  // the keys are kept here, let go of on keyup / leaving the window
  key(ui, ev) {
    if (ev.key === 'Escape') { this.finish(); return true; }
    if (ev.code === 'Space' || ev.code === 'ControlLeft' || ev.code === 'ControlRight') {
      if (!this.unhold) { this.unhold = (e) => { if (e.type === 'blur') this.held = {}; else if (this.held) delete this.held[e.code]; }; addEventListener('keyup', this.unhold); addEventListener('blur', this.unhold); }
      (this.held || (this.held = {}))[ev.code] = true;
    }
    return true;
  }
  mouseDown() { }
}
