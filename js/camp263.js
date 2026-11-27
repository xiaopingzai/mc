'use strict';
// ---------------------------------------------------------------------------
// 26.3 "Wilderness Bound": abandoned camps, cushions and explorer maps.
// The camp templates and loot tables are the official 26.3 NBT/JSON data,
// converted to plain arrays by tools (see camp263data.js / camp263loot.js).
// Camps use the normal structure generator; cushions are low blocks you can sit
// on; abandoned camp maps become ordinary filled maps with a target marker.
// ---------------------------------------------------------------------------
(function () {
  const D = self.STRUCT_DATA;
  if (!D || !self.CAMP263_DATA || !self.CAMP263_STATES) return;

  // ---- state table, loot tables, structure definition ----------------------
  const stateIndex = new Map(D.states.map((s, i) => [s, i]));
  const GS = self.CAMP263_STATES.map((s) => {
    let i = stateIndex.get(s);
    if (i === undefined) {
      i = D.states.length; D.states.push(s); stateIndex.set(s, i);
      D.rot.push([i, i, i, i]); D.mir.push([i, i]);
    }
    return i;
  });
  self.CAMP263_GSTATES = GS;
  for (const k in (self.CAMP263_LOOT || {})) if (!D.loot[k]) D.loot[k] = self.CAMP263_LOOT[k];

  const CAMP_BIOMES = ['meadow', 'cherry_grove', 'forest', 'birch_forest', 'old_growth_birch_forest', 'flower_forest',
    'windswept_forest', 'dappled_forest', 'taiga', 'snowy_taiga', 'old_growth_spruce_taiga', 'old_growth_pine_taiga',
    'sparse_jungle', 'bamboo_jungle', 'swamp', 'savanna', 'wooded_badlands', 'pale_garden'];
  D.structure.abandoned_camp = {
    type: 'minecraft:abandoned_camp', biomes: '#minecraft:has_structure/abandoned_camp',
    max_distance_from_center: 80, size: 2, spawn_overrides: {}, step: 'surface_structures',
    terrain_adaptation: 'beard_thin',
  };
  D.biome_tags['has_structure/abandoned_camp'] = CAMP_BIOMES;
  D.structure_set.abandoned_camp = {
    placement: { type: 'minecraft:random_spread', salt: 91231127, spacing: 37, separation: 8, spread_type: 'linear' },
    structures: [{ structure: 'minecraft:abandoned_camp', weight: 1 }],
  };

  // ---- camp structure type (generation worker / inline generator) ----------
  const H = self.SG && self.SG.helpers, ST = self.SG && self.SG.TYPES;
  if (H && ST) {
    const AIR = 'air';
    ST.abandoned_camp = (gen, name, def, cx, cz, r) => {
      const x = cx * 16 + 8, z = cz * 16 + 8;
      let y = gen.baseHeight(x, z);
      if (y < gen.sea) return null;
      const biome = gen.biomeAt(x, y, z);
      const data = self.CAMP263_DATA[biome] || self.CAMP263_DATA.forest;
      if (!data || !data.tents.length || !data.camps.length) return null;
      const tent = data.tents[r.nextInt(data.tents.length)];
      const camp = data.camps[r.nextInt(data.camps.length)];
      const cw = camp.s[0] - 1, W = tent.s[0] + cw, Dp = Math.max(tent.s[2], camp.s[2] + 1);
      const P = H.scattered(x - Math.floor(W / 2), 64, z - Math.floor(Dp / 2), 0, W, 14, Dp);
      const dy = H.avgGround(gen, P.box) - P.box[1];
      P.box[1] += dy; P.box[4] += dy;
      const put = (B, t, ox, oz) => {
        const b = t.b, p = t.p;
        for (let i = 0; i < b.length; i += 4) {
          const st = self.CAMP263_STATES[p[b[i + 3]]];
          if (st && st !== AIR) B.set(b[i] + ox, b[i + 1], b[i + 2] + oz, st);
        }
        for (let i = 0; i < t.l.length; i += 5) B.chest(t.l[i] + ox, t.l[i + 1], t.l[i + 2] + oz, t.l[i + 3], t.l[i + 4]);
      };
      return H.start(name, def, [H.codePiece(P, (B) => {
        put(B, tent, 0, 0);
        put(B, camp, -cw, -1);
        // the tent's corner posts reach down to the ground (the vanilla structure's
        // terrain adaptation would otherwise leave them hanging over a slope)
        for (const [lx, lz] of [[0, 0], [tent.s[0] - 1, 0], [0, tent.s[2] - 1], [tent.s[0] - 1, tent.s[2] - 1]]) B.down(lx, -1, lz, 'dirt');
      })], 'beard_thin');
    };
  }

  // worker side stops here: it has no block/item/game registries
  if (typeof defBlock !== 'function' || typeof ITEMS === 'undefined' || typeof BID === 'undefined') return;

  // ---- 16 cushions (low blocks, right-click to sit) ------------------------
  const COLS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const CN = { white: '白色', orange: '橙色', magenta: '品红色', light_blue: '淡蓝色', yellow: '黄色', lime: '黄绿色', pink: '粉红色', gray: '灰色', light_gray: '淡灰色', cyan: '青色', purple: '紫色', blue: '蓝色', brown: '棕色', green: '绿色', red: '红色', black: '黑色' };
  const CUSHION_KEYS = [];
  for (let i = 0; i < COLS.length; i++) {
    const c = COLS[i], key = c + '_cushion';
    const b = defBlock(3100 + i, key, CN[c] + '坐垫', {
      shape: SH_BOXES, boxes: () => [[1, 0, 1, 15, 3, 15]], tex: c + '_wool',
      render: 'opaque', hardness: 0.4, sound: 'wool', flammable: true, onUse: 'cushion', stack: 1,
    });
    CUSHION_KEYS.push(key);
    if (ITEM_DATA) ITEM_DATA.push({ key, tab: 'building_blocks', exp: 'c263_test', id: 3100 + i, cn: CN[c] + '坐垫' });
    if (typeof shaped === 'function') shaped(key, 1, ['###'], { '#': c + '_wool_slab' });
  }
  self.CUSHION_KEYS = CUSHION_KEYS;

  // a small invisible seat entity, so the existing riding animation and the
  // sneak-to-leave behaviour are reused instead of inventing a second pose
  class CushionSeat extends Vehicle {
    constructor(g, x, y, z, blockId) {
      super(g, x + 0.5, y, z + 0.5, 0.6, 0.2);
      this.isVehicle = false; this.hittable = false; this.keepSaved = false;
      this.cushionId = blockId; this.cushionKey = x + ',' + y + ',' + z;
      this.seatY = y + 0.20;
    }
    seat() { return [this.pos[0], this.seatY, this.pos[2]]; }
    tick() {
      if (!this.rider) { this.dead = true; return; }
      const w = this.game.world, bx = Math.floor(this.pos[0]), by = Math.floor(this.seatY - 0.2), bz = Math.floor(this.pos[2]);
      if (w.getBlock(bx, by, bz) !== this.cushionId) { this.rider.dismount(); this.dead = true; }
    }
    drawSelf() { /* invisible */ }
  }
  self.CushionSeat = CushionSeat;

  Game.prototype.sitCushion = function (x, y, z, id) {
    const p = this.player, key = x + ',' + y + ',' + z;
    if (p.vehicle && p.vehicle.cushionKey === key) { p.dismount(); return true; }
    const seat = new CushionSeat(this, x, y, z, id);
    this.entities.push(seat); p.mount(seat); return true;
  };

  // ---- explorer map item ----------------------------------------------------
  const MAP_ID = 3600;
  if (!ITEMS[MAP_ID]) {
    ITEMS[MAP_ID] = { id: MAP_ID, key: 'abandoned_camp_map', cn: '营地探险地图', stack: 1, tex: T('i_filled_map'), flat: 'i_filled_map' };
    ITEM_KEY.abandoned_camp_map = MAP_ID;
  }
  if (ITEM_DATA && !ITEM_DATA.some((x) => x.key === 'abandoned_camp_map')) {
    ITEM_DATA.push({ key: 'abandoned_camp_map', tab: 'tools_and_utilities', id: MAP_ID, cn: '营地探险地图', stack: 1, tex: 'i_filled_map' });
  }

  const biomeAt = (g, x, z) => (g.vbiomeAt && g.vbiomeAt(Math.floor(x), Math.floor(z))) || null;
  Game.prototype.makeExplorationMap = function (ox, oz, biome) {
    let target = this.nearestStructure('abandoned_camp', ox, oz);
    if (!target || Math.hypot(target.x - ox, target.z - oz) < 48) {
      target = this.nearestStructure('abandoned_camp', ox + 2048, oz + 2048) || target;
    }
    const tx = target ? target.x : Math.floor(ox) + 512, tz = target ? target.z : Math.floor(oz) + 512;
    const M = this.worldMeta.maps || (this.worldMeta.maps = {});
    const id = (this.worldMeta.nextMap = (this.worldMeta.nextMap || 0) + 1) - 1;
    const m = M[id] = { cx: tx, cz: tz, scale: 0, dim: 'overworld', locked: false, px: new Uint8Array(16384), icons: [['target_point', 0, 0, 0]] };
    // draw the country around the target immediately, so the map is useful
    // when it is first opened rather than staying blank until the player walks
    try {
      const w = this.world, s = 1;
      for (let px = 0; px < 128; px++) for (let pz = 0; pz < 128; pz++) {
        const wx = m.cx + (px - 64) * s, wz = m.cz + (pz - 64) * s;
        if (!w.isLoaded(wx, wz)) continue;
        let y = w.surfaceY(wx, wz) + 1, idb = 0;
        do { y--; idb = w.getBlock(wx, y, wz); } while (y > -64 && (idb === 0 || mapColorOf(idb, 0) === 0));
        const col = mapColorOf(idb, w.getMeta(wx, y, wz));
        m.px[pz * 128 + px] = col * 4 + 1;
      }
      m.dirty = true;
    } catch (e) { /* a damaged/edge chunk must not break opening a chest */ }
    return id;
  };

  // name in the inventory/tooltip, and let loot maps target the right biome
  if (typeof UI !== 'undefined') {
    const _itemLines = UI.prototype.itemLines;
    UI.prototype.itemLines = function (st) {
      const L = _itemLines.call(this, st);
      if (st && st.name && typeof st.name === 'string' && L && L.length) L[0] = { ...L[0], text: st.name };
      return L;
    };
  }
})();
