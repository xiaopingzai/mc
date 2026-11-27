'use strict';
// ---------------------------------------------------------------------------
// Main-thread side of the vanilla structures (the worker places the blocks, see structgen.js):
// block entities with loot tables, template entities, structure references for /locate, and the
// vanilla loot-table evaluator used to fill structure chests.
// ---------------------------------------------------------------------------
const Loot = (function () {
  const strip = (s) => (typeof s === 'string' ? s.replace('minecraft:', '') : s);
  const num = (p, r) => {
    if (p === undefined) return 1;
    if (typeof p === 'number') return p;
    const t = strip(p.type || 'uniform');
    if (t === 'constant') return p.value;
    if (t === 'uniform') return num(p.min, r) + r() * (num(p.max, r) - num(p.min, r));
    if (t === 'binomial') { let n = 0; const k = num(p.n, r), q = num(p.p, r); for (let i = 0; i < k; i++) if (r() < q) n++; return n; }
    return 1;
  };
  const condOk = (conds, r, ctx) => !conds || conds.every((c) => {
    const t = strip(c.condition);
    if (t === 'random_chance') return r() < (typeof c.chance === 'number' ? c.chance : num(c.chance, r));
    if (t === 'inverted') return !condOk([c.term], r, ctx);
    // 26.3's camp-map entries are gated with an inverted location_check, so the
    // map for the biome the chest stands in is left out (as in vanilla)
    if (t === 'location_check') {
      const b = c.predicate && strip(c.predicate.biomes);
      return !!b && !!ctx && !!ctx.biome && (Array.isArray(b) ? b.includes(ctx.biome) : b === ctx.biome);
    }
    return true;
  });
  const itemId = (k) => { k = strip(k); return ITEM_KEY[k] !== undefined ? ITEM_KEY[k] : BID[k] !== undefined && ITEMS[BID[k]] ? BID[k] : null; };
  function applyFns(stack, fns, r, ctx) {
    for (const f of fns || []) {
      if (!condOk(f.conditions, r, ctx)) continue;
      const t = strip(f.function);
      if (t === 'set_count') stack.count = Math.max(0, Math.floor(f.add ? stack.count + num(f.count, r) : num(f.count, r)));
      else if (t === 'set_damage' && ITEMS[stack.id] && ITEMS[stack.id].durability) stack.dmg = Math.floor(ITEMS[stack.id].durability * (1 - num(f.damage, r)));
      else if (t === 'set_name') {
        const n = f.name;
        stack.name = typeof n === 'string' ? n : (n && (n.translate || n.text)) || stack.name;
      } else if (t === 'exploration_map') stack.exploration = { decoration: strip(f.decoration), destination: f.destination };
      else if (t === 'discard') stack.count = 0;
      // filtered only drops the item when a vanilla map id is absent; the map is
      // made after this function runs, so it must not discard it here.
      else if (t === 'filtered') { /* handled after exploration_map below */ }
    }
    return stack;
  }
  function expand(entry, r, out, ctx) {
    if (!condOk(entry.conditions, r, ctx)) return false;
    const t = strip(entry.type);
    switch (t) {
      case 'item': {
        const id = itemId(entry.name);
        if (id !== null) { const s = applyFns({ id, count: 1, dmg: 0 }, entry.functions, r, ctx); if (s.count > 0) out.push(s); }
        return true;
      }
      case 'empty': return true;
      case 'loot_table': { const v = typeof entry.value === 'string' ? strip(entry.value) : null; if (v) out.push(...roll(v, r, ctx)); return true; }
      case 'alternatives': for (const c of entry.children || []) if (expand(c, r, out, ctx)) return true; return false;
      case 'group': for (const c of entry.children || []) expand(c, r, out, ctx); return true;
      case 'sequence': for (const c of entry.children || []) if (!expand(c, r, out, ctx)) return false; return true;
    }
    return true;
  }
  function roll(name, r, ctx) {
    const T = self.STRUCT_DATA && self.STRUCT_DATA.loot[strip(name)];
    const out = [];
    if (!T) return out;
    for (const pool of T.pools || []) {
      if (!condOk(pool.conditions, r, ctx)) continue;
      const n = Math.floor(num(pool.rolls, r));
      for (let i = 0; i < n; i++) {
        const ents = pool.entries.filter((e) => condOk(e.conditions, () => 0.5, ctx));
        let tot = 0; for (const e of ents) tot += e.weight ?? 1;
        if (!tot) continue;
        let k = r() * tot, pick = ents[0];
        for (const e of ents) { k -= e.weight ?? 1; if (k < 0) { pick = e; break; } }
        const got = [];
        expand(pick, r, got, ctx);
        for (const s of got) out.push(applyFns(s, pool.functions, r, ctx));
      }
    }
    for (const s of out) applyFns(s, T.functions, r, ctx);
    return out.filter((s) => s.count > 0);
  }
  // LootTable.fill: split stacks over random empty slots
  function fill(slots, name, r, ctx) {
    const items = roll(name, r, ctx);
    for (const s of items) {
      if (!s.exploration) continue;
      const id = ctx && ctx.game && ctx.game.makeExplorationMap ? ctx.game.makeExplorationMap(ctx.x, ctx.z, ctx.biome) : null;
      delete s.exploration;
      if (id == null) { s.count = 0; continue; }
      s.id = ITEM_KEY.filled_map !== undefined ? ITEM_KEY.filled_map : itemId('filled_map'); s.mapId = id; s.count = 1;
      s.name = '营地探险地图';
    }
    const empty = [];
    for (let i = 0; i < slots.length; i++) if (!slots[i]) empty.push(i);
    for (let i = empty.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [empty[i], empty[j]] = [empty[j], empty[i]]; }
    const list = [];
    for (const s of items) { if (!s.count) continue; const max = maxStack(s.id); while (s.count > max) { list.push({ ...s, count: max }); s.count -= max; } list.push(s); }
    while (list.length < empty.length) {
      const big = list.filter((s) => s.count > 1);
      if (!big.length) break;
      const s = big[Math.floor(r() * big.length)], k = 1 + Math.floor(r() * (s.count / 2));
      s.count -= k; list.push({ ...s, count: k });
    }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    for (const s of list) { if (!empty.length) break; slots[empty.pop()] = s; }
  }
  return { roll, fill };
})();

// 紫颂花只有死亡花（age 5）掉落自身，活花破坏不掉落 —— 原版 ChorusFlowerBlock.getDrops
if (typeof BID !== 'undefined' && BID.chorus_flower !== undefined && BLOCKS[BID.chorus_flower]) {
  BLOCKS[BID.chorus_flower].drops = (meta) => (meta >= 5 ? [[ITEM_KEY.chorus_flower, 1]] : []);
}

// block entities / entities / references the worker reported for a finished chunk
Game.prototype.structureExtras = function (ch, saved) {
  const w = this.world, sx = ch.sx;
  ch.sx = null;
  if (saved || !sx) return;
  const cell = (ci) => { if (ch.blocks && ch.blocks.length) return ch.blocks[ci] || 0; try { return ch.getB ? (ch.getB(ci) || 0) : 0; } catch (e) { return 0; } };
  for (const [x, vy, z, type, data] of (sx.loot || [])) {
    const y = vy, ci = (y << 8) | ((z & 15) << 4) | (x & 15), id = cell(ci), b = BLOCKS[id];
    if (!b) continue;
    if (type === 'loot' && (b.key === 'chest' || b.key === 'barrel' || b.key === 'trapped_chest')) {
      const k = `${x},${y},${z}`;
      if (!this.blockEntities.has(k)) this.blockEntities.set(k, { type: 'chest', pos: [x, y, z], slots: new Array(27).fill(null), loot: data });
      if (b.key === 'chest') ch.setM(ci, ch.getM(ci) | 8);
    }
  }
  // 结构里的酿造台：把瓶子摆进方块实体，并同步 has_bottle_0..2 的外观（末地船那瓶是 strong_healing）
  for (const [x, vy, z, key, data] of (sx.be || [])) {
    const y = vy, ci = (y << 8) | ((z & 15) << 4) | (x & 15);
    if (key !== 'brewing_stand' || !BLOCKS[cell(ci)]) continue;
    const k = `${x},${y},${z}`;
    let be = this.blockEntities.get(k);
    if (!be) { be = { type: 'brewing', pos: [x, y, z], bottles: [null, null, null], ingredient: null, fuel: null, fuelLeft: 0, brewTime: 0 }; this.blockEntities.set(k, be); }
    let mask = 0;
    for (const [slot, pot] of ((data && data.bottles) || [])) {
      if (slot < 0 || slot > 2) continue;
      const st = makeStack('potion', 1); st.pot = pot;
      be.bottles[slot] = st; mask |= 1 << slot;
    }
    ch.setM(ci, mask);
  }
  // the chunk is saved from now on, so its structure mobs are not spawned again when it reloads
  if ((sx.ent || []).length) ch.modified = true;
  for (const [x, vy, z, type, data] of (sx.ent || [])) {
    const y = vy;
    if (type === 'item_frame') {
      // 末地船里的鞘翅展示框：面朝墙的朝向已按结构旋转换算好（data.face）。
      // 注意 structureExtras 是在 finishChunk 把区块放进 world.chunks 之前调用的，
      // 此时 isLoaded/getBlock 都还是 false/空气，会把展示框永久跳过；这里直接读当前区块的方块。
      const ci = (y << 8) | ((z & 15) << 4) | (x & 15);
      if ((ch.blocks ? ch.blocks[ci] : ch.getB(ci)) !== 0) continue;
      const fr = new ItemFrame(this, x, y, z, (data && data.face) !== undefined ? data.face : 4, false);
      if (data && data.item) fr.item = makeStack(data.item, 1);
      fr.savePrev && fr.savePrev();
      this.entities.push(fr);
      continue;
    }
    if (!MOB_TYPES[type]) continue;
    const m = createMob(this, type, x, y, z);
    if (!m) continue;
    m.persistent = true;
    if (data && data.profession) m.profession = data.profession;
    if (data && data.type) m.vtype = data.type;
    this.entities.push(m);
  }
};
// structure-feature elements (village decorations, ...) for one chunk, placed in its decoration step
Game.prototype.structureFeatures = function (ch, ctx, rand, place) {
  if (!ch.sx || !ch.sx.feat) return;
  for (const [x, y, z, f] of ch.sx.feat) place(ctx, f, rand, [x, y, z], f);
};
// nearest structure of a kind (from the references seen so far)
Game.prototype.nearestStructure = function (kind, x, z) {
  let best = null, bd = Infinity;
  for (const r of (this.world.structRefs || new Map()).values()) {
    if (kind && !r.name.startsWith(kind)) continue;
    const cx = (r.box[0] + r.box[3]) / 2, cz = (r.box[2] + r.box[5]) / 2, d = Math.hypot(cx - x, cz - z);
    if (d < bd) { bd = d; best = { name: r.name, x: Math.round(cx), z: Math.round(cz), d }; }
  }
  return best;
};
