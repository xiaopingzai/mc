/* Nether fortress built from the vanilla 26.2 pieces.
   The block geometry comes from NetherFortressPieces.java: every template below was exported by
   running the real 26.2 piece classes against a chunk buffer, then the same piece weights,
   expansion rules and collision tests as the Java code are replayed here. */
(function () {
  const D = window.VF_DATA;
  if (!D) return;
  const DIRS = ['north', 'south', 'west', 'east'];
  const WEIGHTS = {
    bridge: [
      ['BridgeStraight', 30, 0, true],
      ['BridgeCrossing', 10, 4, false],
      ['RoomCrossing', 10, 4, false],
      ['StairsRoom', 10, 3, false],
      ['MonsterThrone', 5, 2, false],
      ['CastleEntrance', 5, 1, false]
    ],
    castle: [
      ['CastleSmallCorridorPiece', 25, 0, true],
      ['CastleSmallCorridorCrossingPiece', 15, 5, false],
      ['CastleSmallCorridorRightTurnPiece', 5, 10, false],
      ['CastleSmallCorridorLeftTurnPiece', 5, 10, false],
      ['CastleCorridorStairsPiece', 10, 3, true],
      ['CastleCorridorTBalconyPiece', 7, 2, false],
      ['CastleStalkRoom', 5, 2, false]
    ]
  };
  const BY_KEY = {};
  for (const t of D.templates) BY_KEY[t.k] = t;
  const stateCache = [];
  function stateAt(i) {
    if (stateCache[i]) return stateCache[i];
    let s = D.states[i], name = s, props = {};
    const p = s.indexOf('[');
    if (p >= 0) {
      name = s.slice(0, p);
      const body = s.slice(p + 1, -1);
      for (const kv of body.split(',')) { const q = kv.indexOf('='); if (q > 0) props[kv.slice(0, q)] = kv.slice(q + 1); }
    }
    let st = null;
    try { st = Features.stateOf({ Name: name, Properties: props }); } catch (e) { st = null; }
    if (!st) { const id = name === 'air' ? 0 : (typeof BID !== 'undefined' ? BID[name] : undefined); st = id === undefined ? null : [id, 0]; }
    stateCache[i] = st;
    return st;
  }
  function template(kind, dir, variant) { return BY_KEY[kind + '|' + dir + '|' + variant] || BY_KEY[kind + '|' + dir + '|0']; }
  function addBox(box, fx, fy, fz) { return [fx + box[0], fy + box[1], fz + box[2], fx + box[3], fy + box[4], fz + box[5]]; }
  function boxesHit(a, b) { return a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2]; }
  function startFoot(x, y, z, dir) {
    if (dir === 'north') return [x + 8, y + 3, z + 18];
    if (dir === 'south') return [x + 8, y + 3, z];
    if (dir === 'west') return [x + 18, y + 3, z + 8];
    return [x, y + 3, z + 8];
  }
  function hashSeed(w, f) {
    let h = 0n;
    const s = 'fortress:' + String(w.seed) + ':' + f.x + ':' + f.z;
    for (let i = 0; i < s.length; i++) h = BigInt.asIntN(64, h * 31n + BigInt(s.charCodeAt(i)));
    return h;
  }
  class Fortress {
    constructor(world, f) {
      this.w = world; this.f = f;
      this.r = new WG.JRand(hashSeed(world, f));
      this.pieces = []; this.pending = [];
      this.weights = { bridge: this.makeWeights(WEIGHTS.bridge), castle: this.makeWeights(WEIGHTS.castle) };
      this.previous = null;
    }
    makeWeights(list) { return list.map(x => ({ kind: x[0], weight: x[1], max: x[2], allow: x[3], count: 0 })); }
    totalWeight(list) {
      let total = 0, anyLimited = false;
      for (const p of list) { total += p.weight; if (p.max > 0 && p.count < p.max) anyLimited = true; }
      return anyLimited ? total : -1;
    }
    make(kind, dir, foot, depth, opt) {
      opt = opt || {};
      const variant = opt.variant || 0;
      const t = template(kind, dir, variant);
      if (!t) return null;
      const box = addBox(t.box, foot[0], foot[1], foot[2]);
      if (box[1] <= 10) return null;
      if (this.pieces.some(p => boxesHit(p.box, box))) return null;
      return { kind, dir, foot, box, depth, variant, tpl: t, isCastle: !!opt.isCastle };
    }
    endFiller(foot, dir, depth, castle) {
      const v = this.r.nextInt(8);
      return this.make('BridgeEndFiller', dir, foot, depth, { variant: v, isCastle: castle });
    }
    create(kind, dir, foot, depth, castle) {
      let variant = 0;
      if (kind === 'BridgeEndFiller') variant = this.r.nextInt(8);
      else if (kind === 'CastleSmallCorridorRightTurnPiece' || kind === 'CastleSmallCorridorLeftTurnPiece') variant = this.r.nextInt(3) === 0 ? 0 : 1;
      return this.make(kind, dir, foot, depth, { variant, isCastle: castle });
    }
    generatePiece(start, list, foot, dir, depth, castle) {
      const total = this.totalWeight(list);
      if (total <= 0 || depth > 30) return this.endFiller(foot, dir, depth, castle);
      let attempts = 0;
      while (attempts++ < 5) {
        let pick = this.r.nextInt(total), chosen = null;
        for (const p of list) { pick -= p.weight; if (pick < 0) { chosen = p; break; } }
        if (!chosen) break;
        if (!(chosen.max === 0 || chosen.count < chosen.max)) continue;
        if (chosen === this.previous && !chosen.allow) continue;
        const piece = this.create(chosen.kind, dir, foot, depth, castle);
        if (!piece) continue;
        chosen.count++;
        this.previous = chosen;
        if (chosen.max > 0 && chosen.count >= chosen.max) {
          const i = list.indexOf(chosen); if (i >= 0) list.splice(i, 1);
        }
        return piece;
      }
      return this.endFiller(foot, dir, depth, castle);
    }
    addPiece(p) { if (!p) return null; this.pieces.push(p); this.pending.push(p); return p; }
    generateAndAdd(foot, dir, depth, castle) {
      if (Math.abs(foot[0] - this.startBox[0]) > 112 || Math.abs(foot[2] - this.startBox[2]) > 112) return this.endFiller(foot, dir, depth, castle);
      const list = castle ? this.weights.castle : this.weights.bridge;
      const p = this.generatePiece(this.start, list, foot, dir, depth + 1, castle);
      if (!p) return null;
      this.addPiece(p);
      return p;
    }
    childForward(piece, xOff, yOff, castle) {
      const b = piece.box, d = piece.dir;
      if (d === 'north') return this.generateAndAdd([b[0] + xOff, b[1] + yOff, b[2] - 1], d, piece.depth, castle);
      if (d === 'south') return this.generateAndAdd([b[0] + xOff, b[1] + yOff, b[5] + 1], d, piece.depth, castle);
      if (d === 'west') return this.generateAndAdd([b[0] - 1, b[1] + yOff, b[2] + xOff], d, piece.depth, castle);
      return this.generateAndAdd([b[3] + 1, b[1] + yOff, b[2] + xOff], d, piece.depth, castle);
    }
    childLeft(piece, yOff, zOff, castle) {
      const b = piece.box, d = piece.dir;
      if (d === 'north' || d === 'south') return this.generateAndAdd([b[0] - 1, b[1] + yOff, b[2] + zOff], 'west', piece.depth, castle);
      return this.generateAndAdd([b[0] + zOff, b[1] + yOff, b[2] - 1], 'north', piece.depth, castle);
    }
    childRight(piece, yOff, zOff, castle) {
      const b = piece.box, d = piece.dir;
      if (d === 'north' || d === 'south') return this.generateAndAdd([b[3] + 1, b[1] + yOff, b[2] + zOff], 'east', piece.depth, castle);
      return this.generateAndAdd([b[0] + zOff, b[1] + yOff, b[5] + 1], 'south', piece.depth, castle);
    }
    children(piece) {
      const d = piece.dir, depth = piece.depth;
      switch (piece.kind) {
        case 'BridgeStraight': this.childForward(piece, 1, 3, false); break;
        case 'BridgeCrossing':
          this.childForward(piece, 8, 3, false);
          this.childLeft(piece, 3, 8, false);
          this.childRight(piece, 3, 8, false); break;
        case 'RoomCrossing':
          this.childForward(piece, 2, 0, false);
          this.childLeft(piece, 0, 2, false);
          this.childRight(piece, 0, 2, false); break;
        case 'StairsRoom': this.childRight(piece, 6, 2, false); break;
        case 'MonsterThrone': break;
        case 'CastleEntrance': this.childForward(piece, 5, 3, true); break;
        case 'CastleSmallCorridorPiece': this.childForward(piece, 1, 0, true); break;
        case 'CastleSmallCorridorRightTurnPiece': this.childRight(piece, 0, 1, true); break;
        case 'CastleSmallCorridorLeftTurnPiece': this.childLeft(piece, 0, 1, true); break;
        case 'CastleCorridorStairsPiece': this.childForward(piece, 1, 0, true); break;
        case 'CastleCorridorTBalconyPiece':
          {
            const zOff = (d === 'west' || d === 'north') ? 5 : 1;
            this.childLeft(piece, 0, zOff, this.r.nextInt(8) > 0);
            this.childRight(piece, 0, zOff, this.r.nextInt(8) > 0);
          } break;
        case 'CastleSmallCorridorCrossingPiece':
          this.childForward(piece, 1, 0, true);
          this.childLeft(piece, 0, 1, true);
          this.childRight(piece, 0, 1, true); break;
        case 'CastleStalkRoom':
          this.childForward(piece, 5, 3, true);
          this.childForward(piece, 5, 11, true); break;
        case 'BridgeEndFiller': break;
      }
    }
    build(f) {
      const dir = DIRS[this.r.nextInt(4)];
      const boxStart = [f.x, f.y, f.z];
      const foot = startFoot(f.x, f.y, f.z, dir);
      const t = template('BridgeCrossing', dir, 0);
      this.startBox = addBox(t.box, foot[0], foot[1], foot[2]);
      const start = this.make('BridgeCrossing', dir, foot, 0, { variant: 0 });
      if (!start) return null;
      this.start = start; this.dir = dir; this.pieces = [start]; this.pending = [];
      this.children(start);
      while (this.pending.length) {
        const idx = this.r.nextInt(this.pending.length), p = this.pending.splice(idx, 1)[0];
        this.children(p);
      }
      // all pieces have been generated; lay the exported blocks into the world
      const S = new StructBuilder();
      for (const p of this.pieces) {
        for (const b of p.tpl.blocks) {
          const st = stateAt(b[3]);
          if (!st) continue;
          S.set(p.foot[0] + b[0], p.foot[1] + b[1], p.foot[2] + b[2], st[0], st[1]);
        }
      }
      return S;
    }
  }
  window.VF = { Fortress, template, startFoot };
  window.buildVanillaFortress = function (world, f) {
    const fort = new Fortress(world, f);
    const S = fort.build(f);
    if (!S && typeof console !== 'undefined') console.warn('[fortress] generation failed', f);
    window.VF_LAST = fort;
    return S;
  };
})();
