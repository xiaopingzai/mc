// -----------------------------------------------------------------------------
// 26.2 原版要塞（StrongholdPieces）JavaScript 移植
// 逐部件对照 net.minecraft.world.level.levelgen.structure.structures.StrongholdPieces
// 不是简化版：StartPiece / Straight / PrisonHall / LeftTurn / RightTurn /
// RoomCrossing / StraightStairsDown / StairsDown / FiveCrossing / ChestCorridor /
// Library / PortalRoom / FillerCorridor 全部参与随机拼装。
// 坐标采用原版局部坐标 + BoundingBox.orientBox + getWorldPos 的方向映射。
// -----------------------------------------------------------------------------
(function () {
  'use strict';

  const DIRV = {
    north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
  };
  const OPP = { north: 'south', south: 'north', west: 'east', east: 'west' };

  function idOf(name, fallback) {
    return (typeof BID !== 'undefined' && BID[name] !== undefined) ? BID[name] : fallback;
  }
  const ID = {
    air: 0,
    stone: idOf('stone', 1),
    cobblestone: idOf('cobblestone', 4),
    oakPlanks: idOf('oak_planks', 5),
    stoneBricks: idOf('stone_bricks', 23),
    cracked: idOf('cracked_stone_bricks', 93),
    mossy: idOf('mossy_stone_bricks', 94),
    infested: idOf('infested_stone_bricks', 23),
    bookshelf: idOf('bookshelf', 25),
    cobweb: idOf('cobweb', 177),
    smoothSlab: idOf('smooth_stone_slab', 57),
    brickSlab: idOf('stone_brick_slab', 113),
    brickStairs: idOf('stone_brick_stairs', 62),
    cobbleStairs: idOf('cobblestone_stairs', 61),
    wallTorch: idOf('wall_torch', 1929),
    torch: idOf('torch', 21),
    ironBars: idOf('iron_bars', 1381),
    ironDoor: idOf('iron_door', 1332),
    oakDoor: idOf('oak_door', 69),
    button: idOf('stone_button', 1447),
    ladder: idOf('ladder', 68),
    oakFence: idOf('oak_fence', 178),
    chest: idOf('chest', 52),
    spawner: idOf('spawner', 127),
    frame: idOf('end_portal_frame', 174),
    portal: idOf('end_portal', 175),
    lava: idOf('lava', 8),
    water: idOf('water', 7),
  };

  function stateOf(name, props) {
    // 26.2 资源包状态下表能给出正确 meta；没有时退化为方块 id + 0
    try {
      if (typeof Features !== 'undefined' && Features.stateOf) {
        const r = Features.stateOf({ Name: name, Properties: props || {} });
        if (r) return r;
      }
    } catch (e) { /* ignore */ }
    return [idOf(name, 0), 0];
  }
  function stairsState(facing) {
    return stateOf('stone_brick_stairs', { facing: facing, half: 'bottom', shape: 'straight' });
  }
  function wallTorchState(facing) {
    return stateOf('wall_torch', { facing: facing });
  }
  function ladderState(facing) {
    return stateOf('ladder', { facing: facing });
  }
  function doorState(name, facing, upper) {
    return stateOf(name, { facing: facing, half: upper ? 'upper' : 'lower', hinge: 'left', open: 'false' });
  }
  const DOOR_FACE_META = { east: 0, west: 1, south: 2, north: 3 };

  function orientBox(footX, footY, footZ, offX, offY, offZ, width, height, depth, dir) {
    if (dir === 'north') return [footX + offX, footY + offY, footZ - depth + 1 + offZ, footX + width - 1 + offX, footY + height - 1 + offY, footZ + offZ];
    if (dir === 'west') return [footX - depth + 1 + offZ, footY + offY, footZ + offX, footX + offZ, footY + height - 1 + offY, footZ + width - 1 + offX];
    if (dir === 'east') return [footX + offZ, footY + offY, footZ + offX, footX + depth - 1 + offZ, footY + height - 1 + offY, footZ + width - 1 + offX];
    return [footX + offX, footY + offY, footZ + offZ, footX + width - 1 + offX, footY + height - 1 + offY, footZ + depth - 1 + offZ];
  }
  function makeBoundingBox(x, y, z, dir, width, height, depth) {
    if (dir === 'north' || dir === 'south') return [x, y, z, x + width - 1, y + height - 1, z + depth - 1];
    return [x, y, z, x + depth - 1, y + height - 1, z + width - 1];
  }
  function intersects(a, b) {
    return a[3] >= b[0] && a[0] <= b[3] && a[5] >= b[2] && a[2] <= b[5] && a[4] >= b[1] && a[1] <= b[4];
  }
  function boxInside(b, x, y, z) {
    return x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5];
  }

  class Piece {
    constructor(type, depth, box, dir, r) {
      this.type = type; this.depth = depth; this.box = box; this.dir = dir; this.r = r;
      this.entryDoor = 'opening';
      this.leftChild = false; this.rightChild = false;
      this.crossType = 0;
      this.isSource = false;
      this.leftLow = false; this.leftHigh = false; this.rightLow = false; this.rightHigh = false;
      this.isTall = false;
      this.hasPlacedChest = false;
      this.hasPlacedSpawner = false;
      this.steps = 0;
      this.eyes = null;
    }

    // 原版 StructurePiece.getWorldPos()：局部坐标 -> 世界坐标
    world(lx, ly, lz) {
      const b = this.box, d = this.dir;
      let x, z;
      if (d === 'north' || d === 'south') x = b[0] + lx;
      else if (d === 'west') x = b[3] - lz;
      else x = b[0] + lz;
      if (d === 'north') z = b[5] - lz;
      else if (d === 'south') z = b[2] + lz;
      else z = b[2] + lx;
      return [x, b[1] + ly, z];
    }

    // 局部方向 -> 世界方向（与 getWorldX/getWorldZ 的坐标轴一致）
    localDir(d) {
      const v = DIRV[d] || [0, 0];
      let x = v[0], z = v[1];
      if (this.dir === 'north') { x = v[0]; z = -v[1]; }
      else if (this.dir === 'south') { x = v[0]; z = v[1]; }
      else if (this.dir === 'west') { x = -v[1]; z = v[0]; }
      else if (this.dir === 'east') { x = v[1]; z = v[0]; }
      if (x > 0) return 'east'; if (x < 0) return 'west';
      if (z > 0) return 'south'; if (z < 0) return 'north';
      return d;
    }
  }

  class Gen {
    constructor(w, h) {
      this.w = w; this.h = h; this.S = new StructBuilder(this.h.baseY || 0);
      this.r = null; this.pieces = []; this.pending = [];
      this.weights = []; this.imposed = null;
      this.start = null; this.portal = null;
      this.dx = 0; this.dy = 0; this.dz = 0;
    }

    resetWeights() {
      this.weights = [
        { name: 'Straight', w: 40, m: 0, c: 0 },
        { name: 'PrisonHall', w: 5, m: 5, c: 0 },
        { name: 'LeftTurn', w: 20, m: 0, c: 0 },
        { name: 'RightTurn', w: 20, m: 0, c: 0 },
        { name: 'RoomCrossing', w: 10, m: 6, c: 0 },
        { name: 'StraightStairsDown', w: 5, m: 5, c: 0 },
        { name: 'StairsDown', w: 5, m: 5, c: 0 },
        { name: 'FiveCrossing', w: 5, m: 4, c: 0 },
        { name: 'ChestCorridor', w: 5, m: 4, c: 0 },
        { name: 'Library', w: 10, m: 2, c: 0, minDepth: 4 },
        { name: 'PortalRoom', w: 20, m: 1, c: 0, minDepth: 5 },
      ];
      this.imposed = null;
    }

    weightValid(pw, depth) {
      if (pw.m !== 0 && pw.c >= pw.m) return false;
      if (pw.minDepth !== undefined && !(depth > pw.minDepth)) return false;
      return true;
    }

    collision(box) {
      for (const p of this.pieces) if (intersects(p.box, box)) return p;
      return null;
    }

    add(p) {
      if (!p) return null;
      this.pieces.push(p);
      this.pending.push(p);
      if (p.type === 'PortalRoom') { this.portal = p; this.start.portal = p; }
      return p;
    }

    create(name, footX, footY, footZ, dir, depth) {
      let box;
      let extra = {};
      if (name === 'Straight') {
        box = orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, 7, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r);
        p.entryDoor = this.randomDoor();
        p.leftChild = this.r() < 0.5;
        p.rightChild = this.r() < 0.5;
        return p;
      }
      if (name === 'PrisonHall') {
        box = orientBox(footX, footY, footZ, -1, -1, 0, 9, 5, 11, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); return p;
      }
      if (name === 'LeftTurn' || name === 'RightTurn') {
        box = orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, 5, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); return p;
      }
      if (name === 'RoomCrossing') {
        box = orientBox(footX, footY, footZ, -4, -1, 0, 11, 7, 11, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r);
        p.entryDoor = this.randomDoor(); p.crossType = this.r.int(5); return p;
      }
      if (name === 'StraightStairsDown') {
        box = orientBox(footX, footY, footZ, -1, -7, 0, 5, 11, 8, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); return p;
      }
      if (name === 'StairsDown') {
        box = orientBox(footX, footY, footZ, -1, -7, 0, 5, 11, 5, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); return p;
      }
      if (name === 'FiveCrossing') {
        box = orientBox(footX, footY, footZ, -4, -3, 0, 10, 9, 11, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r);
        p.entryDoor = this.randomDoor();
        p.leftLow = this.r() < 0.5; p.leftHigh = this.r() < 0.5;
        p.rightLow = this.r() < 0.5; p.rightHigh = this.r.int(3) > 0;
        return p;
      }
      if (name === 'ChestCorridor') {
        box = orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, 7, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); return p;
      }
      if (name === 'Library') {
        // 先试 11 格高的高图书馆，放不下再试 6 格高的矮图书馆
        let tall = true;
        box = orientBox(footX, footY, footZ, -4, -1, 0, 14, 11, 15, dir);
        if (box[1] <= 10 || this.collision(box)) {
          tall = false;
          box = orientBox(footX, footY, footZ, -4, -1, 0, 14, 6, 15, dir);
          if (box[1] <= 10 || this.collision(box)) return null;
        }
        const p = new Piece(name, depth, box, dir, this.r); p.entryDoor = this.randomDoor(); p.isTall = tall; return p;
      }
      if (name === 'PortalRoom') {
        box = orientBox(footX, footY, footZ, -4, -1, 0, 11, 8, 16, dir);
        if (box[1] <= 10 || this.collision(box)) return null;
        return new Piece(name, depth, box, dir, this.r);
      }
      return null;
    }

    randomDoor() {
      const n = this.r.int(5);
      return n === 2 ? 'wood' : n === 3 ? 'grates' : n === 4 ? 'iron' : 'opening';
    }

    // 对照原版 generatePieceFromSmallDoor：权重、imposedPiece、5 次尝试、Filler 回退
    createFromDoor(footX, footY, footZ, dir, depth) {
      let total = 0, hasAny = false;
      for (const pw of this.weights) { total += pw.w; if (pw.m > 0 && pw.c < pw.m) hasAny = true; }
      if (!hasAny) return null;
      if (this.imposed) {
        const name = this.imposed; this.imposed = null;
        const p = this.create(name, footX, footY, footZ, dir, depth);
        if (p) return p;
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        let sel = this.r.int(total);
        for (const pw of this.weights) {
          sel -= pw.w;
          if (sel >= 0) continue;
          if (!this.weightValid(pw, depth) || pw === this.start.previous) break;
          const p = this.create(pw.name, footX, footY, footZ, dir, depth);
          if (!p) break;
          pw.c++;
          this.start.previous = pw;
          if (!(pw.m === 0 || pw.c < pw.m)) this.weights.splice(this.weights.indexOf(pw), 1);
          return p;
        }
      }
      const fbox = this.fillerBox(footX, footY, footZ, dir);
      if (fbox && fbox[1] > 1) {
        const p = new Piece('FillerCorridor', depth, fbox, dir, this.r);
        p.steps = (dir === 'north' || dir === 'south') ? (fbox[5] - fbox[2] + 1) : (fbox[3] - fbox[0] + 1);
        return p;
      }
      return null;
    }

    fillerBox(footX, footY, footZ, dir) {
      let box = orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, 4, dir);
      const cp = this.collision(box);
      if (!cp) return null;
      if (cp.box[1] === box[1]) {
        for (let depth = 2; depth >= 1; depth--) {
          box = orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, depth, dir);
          if (!intersects(cp.box, box)) return orientBox(footX, footY, footZ, -1, -1, 0, 5, 5, depth + 1, dir);
        }
      }
      return null;
    }

    addChild(footX, footY, footZ, dir, depth) {
      if (depth > 50) return null;
      const sb = this.start.box;
      if (Math.abs(footX - sb[0]) > 112 || Math.abs(footZ - sb[2]) > 112) return null;
      const p = this.createFromDoor(footX, footY, footZ, dir, depth + 1);
      if (p) this.add(p);
      return p;
    }

    // 对照原版 generateSmallDoorChildForward/Left/Right
    childForward(p, xOff, yOff) {
      const b = p.box, d = p.dir;
      if (d === 'north') return this.addChild(b[0] + xOff, b[1] + yOff, b[2] - 1, d, p.depth);
      if (d === 'south') return this.addChild(b[0] + xOff, b[1] + yOff, b[5] + 1, d, p.depth);
      if (d === 'west') return this.addChild(b[0] - 1, b[1] + yOff, b[2] + xOff, d, p.depth);
      if (d === 'east') return this.addChild(b[3] + 1, b[1] + yOff, b[2] + xOff, d, p.depth);
      return null;
    }
    childLeft(p, yOff, zOff) {
      const b = p.box, d = p.dir;
      if (d === 'north' || d === 'south') return this.addChild(b[0] - 1, b[1] + yOff, b[2] + zOff, 'west', p.depth);
      if (d === 'west' || d === 'east') return this.addChild(b[0] + zOff, b[1] + yOff, b[2] - 1, 'north', p.depth);
      return null;
    }
    childRight(p, yOff, zOff) {
      const b = p.box, d = p.dir;
      if (d === 'north' || d === 'south') return this.addChild(b[3] + 1, b[1] + yOff, b[2] + zOff, 'east', p.depth);
      if (d === 'west' || d === 'east') return this.addChild(b[0] + zOff, b[1] + yOff, b[5] + 1, 'south', p.depth);
      return null;
    }

    addChildren(p) {
      if (p.type === 'StartPiece') {
        this.imposed = 'FiveCrossing';
        this.childForward(p, 1, 1);
        return;
      }
      if (p.type === 'Straight') {
        this.childForward(p, 1, 1);
        if (p.leftChild) this.childLeft(p, 1, 2);
        if (p.rightChild) this.childRight(p, 1, 2);
      } else if (p.type === 'PrisonHall') {
        this.childForward(p, 1, 1);
      } else if (p.type === 'LeftTurn') {
        if (p.dir === 'north' || p.dir === 'east') this.childLeft(p, 1, 1);
        else this.childRight(p, 1, 1);
      } else if (p.type === 'RightTurn') {
        if (p.dir === 'north' || p.dir === 'east') this.childRight(p, 1, 1);
        else this.childLeft(p, 1, 1);
      } else if (p.type === 'RoomCrossing') {
        this.childForward(p, 4, 1); this.childLeft(p, 1, 4); this.childRight(p, 1, 4);
      } else if (p.type === 'StraightStairsDown' || p.type === 'StairsDown' || p.type === 'ChestCorridor') {
        this.childForward(p, 1, 1);
      } else if (p.type === 'FiveCrossing') {
        let a = 3, b = 5;
        if (p.dir === 'west' || p.dir === 'north') { a = 8 - a; b = 8 - b; }
        this.childForward(p, 5, 1);
        if (p.leftLow) this.childLeft(p, a, 1);
        if (p.leftHigh) this.childLeft(p, b, 7);
        if (p.rightLow) this.childRight(p, a, 1);
        if (p.rightHigh) this.childRight(p, b, 7);
      } else if (p.type === 'PortalRoom') {
        this.start.portal = p;
      }
      // Library / FillerCorridor 没有子门
    }

    makeStart(dir) {
      const box = makeBoundingBox(this.h.x, 64, this.h.z, dir, 5, 11, 5);
      const p = new Piece('StartPiece', 0, box, dir, this.r);
      p.isSource = true; p.entryDoor = 'opening';
      return p;
    }

    generateLayout() {
      for (let attempt = 0; attempt < 10; attempt++) {
        this.r = RNG(hashStr('stronghold:' + this.w.seed + ':' + this.h.key + ':' + attempt));
        this.resetWeights();
        this.pieces = []; this.pending = []; this.portal = null;
        const dirs = ['north', 'south', 'west', 'east'];
        const start = this.makeStart(dirs[this.r.int(4)]);
        this.start = start;
        this.pieces.push(start); this.pending.push(start);
        this.addChildren(start);
        while (this.pending.length) {
          const idx = this.r.int(this.pending.length);
          const p = this.pending.splice(idx, 1)[0];
          this.addChildren(p);
        }
        if (this.portal) return true;
      }
      return false;
    }

    // ---- 方块写入 ---------------------------------------------------------
    put(p, lx, ly, lz, id, meta) {
      const [x, y, z] = p.world(lx, ly, lz);
      this.S.set(x + this.dx, y + this.dy, z + this.dz, id, meta || 0);
    }

    // 原版 SmoothStoneSelector：边界 20% 裂纹、30% 苔石、5% 虫蚀、其余石砖；内部空气
    selector(edge) {
      if (!edge) return [ID.air, 0];
      const v = this.r();
      if (v < 0.2) return [ID.cracked, 0];
      if (v < 0.5) return [ID.mossy, 0];
      if (v < 0.55) return [ID.infested, 0];
      return [ID.stoneBricks, 0];
    }

    // 原版 generateBox(..., skipAir, random, selector)
    sbox(p, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const edge = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
        const [id, meta] = this.selector(edge);
        this.put(p, x, y, z, id, meta);
      }
    }

    // 原版 generateBox(..., edgeBlock, fillBlock, skipAir) - 这里 skipAir 无意义（结构从空气开始）
    fbox(p, x0, y0, z0, x1, y1, z1, edgeId, fillId, edgeMeta, fillMeta) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const onEdge = y === y0 || y === y1 || x === x0 || x === x1 || z === z0 || z === z1;
        this.put(p, x, y, z, onEdge ? edgeId : fillId, onEdge ? (edgeMeta || 0) : (fillMeta || 0));
      }
    }

    maybe(p, prob, x, y, z, id, meta) {
      if (this.r() < prob) this.put(p, x, y, z, id, meta || 0);
    }
    cobwebBox(p, prob, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        if (this.r() > prob) continue;
        this.put(p, x, y, z, ID.cobweb);
      }
    }

    door(p, type, x, y, z) {
      if (type === 'opening') {
        this.fbox(p, x, y, z, x + 2, y + 2, z, ID.air, ID.air);
        return;
      }
      const facingLocal = type === 'iron' ? 'west' : 'north';
      const facing = p.localDir(facingLocal);
      // 门框：左右柱 + 顶梁
      this.put(p, x, y, z, ID.stoneBricks); this.put(p, x, y + 1, z, ID.stoneBricks); this.put(p, x, y + 2, z, ID.stoneBricks);
      this.put(p, x + 1, y + 2, z, ID.stoneBricks); this.put(p, x + 2, y + 2, z, ID.stoneBricks);
      this.put(p, x + 2, y + 1, z, ID.stoneBricks); this.put(p, x + 2, y, z, ID.stoneBricks);
      if (type === 'wood') {
        const [id, m] = doorState('oak_door', facing, false);
        this.put(p, x + 1, y, z, id, (m & 8) | (DOOR_FACE_META[facing] ?? 0));
        this.put(p, x + 1, y + 1, z, id, (m & 8) | 8 | (DOOR_FACE_META[facing] ?? 0));
      } else if (type === 'iron') {
        const [id, m] = doorState('iron_door', facing, false);
        this.put(p, x + 1, y, z, id, (m & 8) | (DOOR_FACE_META[facing] ?? 0));
        this.put(p, x + 1, y + 1, z, id, (m & 8) | 8 | (DOOR_FACE_META[facing] ?? 0));
        const [bid, bm] = stateOf('stone_button', { facing: p.localDir('north'), powered: 'false' });
        this.put(p, x + 2, y + 1, z + 1, bid, bm);
        const [bid2, bm2] = stateOf('stone_button', { facing: p.localDir('south'), powered: 'false' });
        this.put(p, x + 2, y + 1, z - 1, bid2, bm2);
      } else if (type === 'grates') {
        this.put(p, x + 1, y, z, ID.air); this.put(p, x + 1, y + 1, z, ID.air);
        this.put(p, x, y, z, ID.ironBars); this.put(p, x, y + 1, z, ID.ironBars); this.put(p, x, y + 2, z, ID.ironBars);
        this.put(p, x + 1, y + 2, z, ID.ironBars); this.put(p, x + 2, y + 2, z, ID.ironBars);
        this.put(p, x + 2, y + 1, z, ID.ironBars); this.put(p, x + 2, y, z, ID.ironBars);
      }
    }

    chest(p, x, y, z) {
      if (this.hasChest(p, x, y, z)) return;
      this.put(p, x, y, z, ID.chest, 0);
    }

    hasChest(p, x, y, z) {
      const [wx, wy, wz] = p.world(x, y, z);
      const b = this.S.buckets.get(ckey((wx + this.dx) >> 4, (wz + this.dz) >> 4));
      if (!b) return false;
      const key = ((((wy + this.dy) - (this.S.baseY || 0)) << 8) | (((wz + this.dz) & 15) << 4) | ((wx + this.dx) & 15));
      for (let i = 0; i < b.length; i += 3) if (b[i] === key && b[i + 1] === ID.chest) return true;
      return false;
    }

    // ---- 各部件 postProcess ------------------------------------------------
    render(p) {
      switch (p.type) {
        case 'StartPiece': this.renderStairs(p, true); break;
        case 'Straight': this.renderStraight(p); break;
        case 'PrisonHall': this.renderPrison(p); break;
        case 'LeftTurn': this.renderTurn(p, true); break;
        case 'RightTurn': this.renderTurn(p, false); break;
        case 'RoomCrossing': this.renderCrossing(p); break;
        case 'StraightStairsDown': this.renderStraightStairs(p); break;
        case 'StairsDown': this.renderStairs(p, false); break;
        case 'FiveCrossing': this.renderFive(p); break;
        case 'ChestCorridor': this.renderChestCorridor(p); break;
        case 'Library': this.renderLibrary(p); break;
        case 'PortalRoom': this.renderPortal(p); break;
        case 'FillerCorridor': this.renderFiller(p); break;
      }
    }

    renderStraight(p) {
      this.sbox(p, 0, 0, 0, 4, 4, 6);
      this.door(p, p.entryDoor, 1, 1, 0);
      this.door(p, 'opening', 1, 1, 6);
      const e = wallTorchState(p.localDir('east')), w = wallTorchState(p.localDir('west'));
      this.maybe(p, 0.1, 1, 2, 1, e[0], e[1]);
      this.maybe(p, 0.1, 3, 2, 1, w[0], w[1]);
      this.maybe(p, 0.1, 1, 2, 5, e[0], e[1]);
      this.maybe(p, 0.1, 3, 2, 5, w[0], w[1]);
      if (p.leftChild) this.fbox(p, 0, 1, 2, 0, 3, 4, ID.air, ID.air);
      if (p.rightChild) this.fbox(p, 4, 1, 2, 4, 3, 4, ID.air, ID.air);
    }

    renderPrison(p) {
      this.sbox(p, 0, 0, 0, 8, 4, 10);
      this.door(p, p.entryDoor, 1, 1, 0);
      this.fbox(p, 1, 1, 10, 3, 3, 10, ID.air, ID.air);
      // 内部四道隔墙柱
      this.fbox(p, 4, 1, 1, 4, 3, 1, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 1, 3, 4, 3, 3, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 1, 7, 4, 3, 7, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 1, 9, 4, 3, 9, ID.stoneBricks, ID.stoneBricks);
      // 铁栏杆笼子
      for (let y = 1; y <= 3; y++) {
        this.put(p, 4, y, 4, ID.ironBars, 5); this.put(p, 4, y, 5, ID.ironBars, 9);
        this.put(p, 4, y, 6, ID.ironBars, 5);
        for (let x = 5; x <= 7; x++) this.put(p, x, y, 5, ID.ironBars, 10);
      }
      this.put(p, 4, 3, 2, ID.ironBars, 5); this.put(p, 4, 3, 8, ID.ironBars, 5);
      // 两扇铁门朝西
      const [id, m] = doorState('iron_door', p.localDir('west'), false);
      this.put(p, 4, 1, 2, id, (m & 8) | (DOOR_FACE_META[p.localDir('west')] ?? 0));
      this.put(p, 4, 2, 2, id, (m & 8) | 8 | (DOOR_FACE_META[p.localDir('west')] ?? 0));
      this.put(p, 4, 1, 8, id, (m & 8) | (DOOR_FACE_META[p.localDir('west')] ?? 0));
      this.put(p, 4, 2, 8, id, (m & 8) | 8 | (DOOR_FACE_META[p.localDir('west')] ?? 0));
    }

    renderTurn(p, left) {
      this.sbox(p, 0, 0, 0, 4, 4, 4);
      this.door(p, p.entryDoor, 1, 1, 0);
      const openSide = left
        ? ((p.dir === 'north' || p.dir === 'east') ? 0 : 4)
        : ((p.dir === 'north' || p.dir === 'east') ? 4 : 0);
      this.fbox(p, openSide, 1, 1, openSide, 3, 3, ID.air, ID.air);
    }

    renderCrossing(p) {
      this.sbox(p, 0, 0, 0, 10, 6, 10);
      this.door(p, p.entryDoor, 4, 1, 0);
      this.fbox(p, 4, 1, 10, 6, 3, 10, ID.air, ID.air);
      this.fbox(p, 0, 1, 4, 0, 3, 6, ID.air, ID.air);
      this.fbox(p, 10, 1, 4, 10, 3, 6, ID.air, ID.air);
      if (p.crossType === 0) {
        this.put(p, 5, 1, 5, ID.stoneBricks); this.put(p, 5, 2, 5, ID.stoneBricks); this.put(p, 5, 3, 5, ID.stoneBricks);
        const w = wallTorchState(p.localDir('west')), e = wallTorchState(p.localDir('east'));
        const n = wallTorchState(p.localDir('north')), s = wallTorchState(p.localDir('south'));
        this.put(p, 4, 3, 5, w[0], w[1]); this.put(p, 6, 3, 5, e[0], e[1]);
        this.put(p, 5, 3, 4, s[0], s[1]); this.put(p, 5, 3, 6, n[0], n[1]);
        for (const [x, z] of [[4,4],[4,5],[4,6],[6,4],[6,5],[6,6],[5,4],[5,6]]) this.put(p, x, 1, z, ID.smoothSlab, 0);
      } else if (p.crossType === 1) {
        for (let i = 0; i < 5; i++) {
          this.put(p, 3, 1, 3 + i, ID.stoneBricks); this.put(p, 7, 1, 3 + i, ID.stoneBricks);
          this.put(p, 3 + i, 1, 3, ID.stoneBricks); this.put(p, 3 + i, 1, 7, ID.stoneBricks);
        }
        this.put(p, 5, 1, 5, ID.stoneBricks); this.put(p, 5, 2, 5, ID.stoneBricks); this.put(p, 5, 3, 5, ID.stoneBricks);
        this.put(p, 5, 4, 5, ID.water);
      } else if (p.crossType === 2) {
        for (let z = 1; z <= 9; z++) { this.put(p, 1, 3, z, ID.cobblestone); this.put(p, 9, 3, z, ID.cobblestone); }
        for (let x = 1; x <= 9; x++) { this.put(p, x, 3, 1, ID.cobblestone); this.put(p, x, 3, 9, ID.cobblestone); }
        for (const [x, z] of [[5,4],[5,6],[5,4],[4,5],[6,5]]) this.put(p, x, 1, z, ID.cobblestone);
        this.put(p, 5, 3, 4, ID.cobblestone); this.put(p, 5, 3, 6, ID.cobblestone);
        this.put(p, 4, 3, 5, ID.cobblestone); this.put(p, 6, 3, 5, ID.cobblestone);
        for (let y = 1; y <= 3; y++) for (const [x, z] of [[4,4],[6,4],[4,6],[6,6]]) this.put(p, x, y, z, ID.cobblestone);
        this.put(p, 5, 3, 5, ID.torch);
        for (let z = 2; z <= 8; z++) {
          for (let x = 2; x <= 3; x++) this.put(p, x, 3, z, ID.oakPlanks);
          if (z <= 3 || z >= 7) for (let x = 4; x <= 6; x++) this.put(p, x, 3, z, ID.oakPlanks);
          for (let x = 7; x <= 8; x++) this.put(p, x, 3, z, ID.oakPlanks);
        }
        for (let y = 1; y <= 3; y++) { const [id, m] = ladderState(p.localDir('west')); this.put(p, 9, y, 3, id, m); }
        this.chest(p, 3, 4, 8);
      }
    }

    renderStraightStairs(p) {
      this.sbox(p, 0, 0, 0, 4, 10, 7);
      this.door(p, p.entryDoor, 1, 7, 0);
      this.door(p, 'opening', 1, 1, 7);
      // 楼梯从 z=1 的 y=6 向南逐级降到 z=6 的 y=1，高侧（North）必须朝房间入口一侧；
      // 原版这里就是 StairBlock.FACING=NORTH，之前写成 south 会把台阶上下颠倒。
      const [stairs, sm] = stairsState(p.localDir('north'));
      for (let i = 0; i < 6; i++) {
        for (let x = 1; x <= 3; x++) this.put(p, x, 6 - i, 1 + i, stairs, sm);
        if (i < 5) for (let x = 1; x <= 3; x++) this.put(p, x, 5 - i, 1 + i, ID.stoneBricks);
      }
    }

    renderStairs(p, source) {
      this.sbox(p, 0, 0, 0, 4, 10, 4);
      this.door(p, source ? 'opening' : p.entryDoor, 1, 7, 0);
      this.door(p, 'opening', 1, 1, 4);
      this.put(p, 2, 6, 1, ID.stoneBricks); this.put(p, 1, 5, 1, ID.stoneBricks); this.put(p, 1, 6, 1, ID.smoothSlab, 0);
      this.put(p, 1, 5, 2, ID.stoneBricks); this.put(p, 1, 4, 3, ID.stoneBricks); this.put(p, 1, 5, 3, ID.smoothSlab, 0);
      this.put(p, 2, 4, 3, ID.stoneBricks); this.put(p, 3, 3, 3, ID.stoneBricks); this.put(p, 3, 4, 3, ID.smoothSlab, 0);
      this.put(p, 3, 3, 2, ID.stoneBricks); this.put(p, 3, 2, 1, ID.stoneBricks); this.put(p, 3, 3, 1, ID.smoothSlab, 0);
      this.put(p, 2, 2, 1, ID.stoneBricks); this.put(p, 1, 1, 1, ID.stoneBricks); this.put(p, 1, 2, 1, ID.smoothSlab, 0);
      this.put(p, 1, 1, 2, ID.stoneBricks); this.put(p, 1, 1, 3, ID.smoothSlab, 0);
    }

    renderFive(p) {
      this.sbox(p, 0, 0, 0, 9, 8, 10);
      this.door(p, p.entryDoor, 4, 3, 0);
      if (p.leftLow) this.fbox(p, 0, 3, 1, 0, 5, 3, ID.air, ID.air);
      if (p.rightLow) this.fbox(p, 9, 3, 1, 9, 5, 3, ID.air, ID.air);
      if (p.leftHigh) this.fbox(p, 0, 5, 7, 0, 7, 9, ID.air, ID.air);
      if (p.rightHigh) this.fbox(p, 9, 5, 7, 9, 7, 9, ID.air, ID.air);
      this.fbox(p, 5, 1, 10, 7, 3, 10, ID.air, ID.air);
      this.fbox(p, 1, 2, 1, 8, 2, 6, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 1, 5, 4, 4, 9, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 8, 1, 5, 8, 4, 9, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 1, 4, 7, 3, 4, 9, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 1, 3, 5, 3, 3, 6, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 1, 3, 4, 3, 3, 4, ID.smoothSlab, ID.smoothSlab);
      this.fbox(p, 1, 4, 6, 3, 4, 6, ID.smoothSlab, ID.smoothSlab);
      this.fbox(p, 5, 1, 7, 7, 1, 8, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 5, 1, 9, 7, 1, 9, ID.smoothSlab, ID.smoothSlab);
      this.fbox(p, 5, 2, 7, 7, 2, 7, ID.smoothSlab, ID.smoothSlab);
      for (let x = 4; x <= 8; x += 4) this.fbox(p, x, 5, 7, x, 5, 9, ID.smoothSlab, ID.smoothSlab);
      this.fbox(p, 5, 5, 7, 7, 5, 9, ID.smoothSlab, ID.smoothSlab);
      const [id, m] = wallTorchState(p.localDir('south'));
      this.put(p, 6, 5, 6, id, m);
    }

    renderChestCorridor(p) {
      this.sbox(p, 0, 0, 0, 4, 4, 6);
      this.door(p, p.entryDoor, 1, 1, 0);
      this.door(p, 'opening', 1, 1, 6);
      this.fbox(p, 3, 1, 2, 3, 1, 4, ID.stoneBricks, ID.stoneBricks);
      this.put(p, 3, 1, 1, ID.brickSlab); this.put(p, 3, 1, 5, ID.brickSlab);
      this.put(p, 3, 2, 2, ID.brickSlab); this.put(p, 3, 2, 4, ID.brickSlab);
      for (let z = 2; z <= 4; z++) this.put(p, 2, 1, z, ID.brickSlab);
      if (!p.hasPlacedChest) { p.hasPlacedChest = true; this.chest(p, 3, 2, 3); }
    }

    renderLibrary(p) {
      const H = p.isTall ? 11 : 6;
      this.sbox(p, 0, 0, 0, 13, H - 1, 14);
      this.door(p, p.entryDoor, 4, 1, 0);
      this.cobwebBox(p, 0.07, 2, 1, 1, 11, 4, 13);
      for (let d = 1; d <= 13; d++) {
        const column = (d - 1) % 4 === 0;
        const rows = p.isTall ? [1, 4] : [1, 4];
        this.fbox(p, 1, 1, d, 1, 4, d, column ? ID.oakPlanks : ID.bookshelf, column ? ID.oakPlanks : ID.bookshelf);
        this.fbox(p, 12, 1, d, 12, 4, d, column ? ID.oakPlanks : ID.bookshelf, column ? ID.oakPlanks : ID.bookshelf);
        if (column) {
          const e = wallTorchState(p.localDir('east')), w = wallTorchState(p.localDir('west'));
          this.put(p, 2, 3, d, e[0], e[1]); this.put(p, 11, 3, d, w[0], w[1]);
        }
        if (p.isTall) {
          this.fbox(p, 1, 6, d, 1, 9, d, column ? ID.oakPlanks : ID.bookshelf, column ? ID.oakPlanks : ID.bookshelf);
          this.fbox(p, 12, 6, d, 12, 9, d, column ? ID.oakPlanks : ID.bookshelf, column ? ID.oakPlanks : ID.bookshelf);
        }
      }
      for (let d = 3; d < 12; d += 2) {
        this.fbox(p, 3, 1, d, 4, 3, d, ID.bookshelf, ID.bookshelf);
        this.fbox(p, 6, 1, d, 7, 3, d, ID.bookshelf, ID.bookshelf);
        this.fbox(p, 9, 1, d, 10, 3, d, ID.bookshelf, ID.bookshelf);
      }
      if (p.isTall) {
        this.fbox(p, 1, 5, 1, 3, 5, 13, ID.oakPlanks, ID.oakPlanks);
        this.fbox(p, 10, 5, 1, 12, 5, 13, ID.oakPlanks, ID.oakPlanks);
        this.fbox(p, 4, 5, 1, 9, 5, 2, ID.oakPlanks, ID.oakPlanks);
        this.fbox(p, 4, 5, 12, 9, 5, 13, ID.oakPlanks, ID.oakPlanks);
        this.put(p, 9, 5, 11, ID.oakPlanks); this.put(p, 8, 5, 11, ID.oakPlanks); this.put(p, 9, 5, 10, ID.oakPlanks);
        this.fbox(p, 3, 6, 3, 3, 6, 11, ID.oakFence, ID.oakFence);
        this.fbox(p, 10, 6, 3, 10, 6, 9, ID.oakFence, ID.oakFence);
        this.fbox(p, 4, 6, 2, 9, 6, 2, ID.oakFence, ID.oakFence);
        this.fbox(p, 4, 6, 12, 7, 6, 12, ID.oakFence, ID.oakFence);
        const [lid, lm] = ladderState(p.localDir('south'));
        for (let y = 1; y <= 7; y++) this.put(p, 10, y, 13, lid, lm);
      }
      this.chest(p, 3, 3, 5);
      if (p.isTall) {
        this.put(p, 12, 9, 1, ID.air);
        this.chest(p, 12, 8, 1);
      }
    }

    renderPortal(p) {
      this.sbox(p, 0, 0, 0, 10, 7, 15);
      this.door(p, 'grates', 4, 1, 0);
      // 内部地面与两级台阶
      this.fbox(p, 1, 6, 1, 1, 6, 14, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 9, 6, 1, 9, 6, 14, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 2, 6, 1, 8, 6, 2, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 2, 6, 14, 8, 6, 14, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 1, 1, 1, 2, 1, 4, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 8, 1, 1, 9, 1, 4, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 1, 1, 1, 1, 1, 3, ID.lava, ID.lava);
      this.fbox(p, 9, 1, 1, 9, 1, 3, ID.lava, ID.lava);
      this.fbox(p, 3, 1, 8, 7, 1, 12, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 1, 9, 6, 1, 11, ID.lava, ID.lava);
      for (let z = 3; z < 14; z += 2) {
        this.fbox(p, 0, 3, z, 0, 4, z, ID.ironBars, ID.ironBars);
        this.fbox(p, 10, 3, z, 10, 4, z, ID.ironBars, ID.ironBars);
      }
      for (let x = 2; x < 9; x += 2) this.fbox(p, x, 3, 15, x, 4, 15, ID.ironBars, ID.ironBars);
      // 三级台阶
      this.fbox(p, 4, 1, 5, 6, 1, 7, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 2, 6, 6, 2, 7, ID.stoneBricks, ID.stoneBricks);
      this.fbox(p, 4, 3, 7, 6, 3, 7, ID.stoneBricks, ID.stoneBricks);
      const [stairs, sm] = stairsState(p.localDir('south'));
      for (let x = 4; x <= 6; x++) {
        this.put(p, x, 1, 4, stairs, sm); this.put(p, x, 2, 5, stairs, sm); this.put(p, x, 3, 6, stairs, sm);
      }
      // 12 个框架，眼概率 10%，源码：>0.9 才有眼
      if (!p.eyes) {
        p.eyes = [];
        for (let i = 0; i < 12; i++) p.eyes.push(this.r() > 0.9);
      }
      const frame = (x, z, idx) => this.put(p, x, 3, z, ID.frame, p.eyes[idx] ? 4 : 0);
      frame(4, 8, 0); frame(5, 8, 1); frame(6, 8, 2);
      frame(4, 12, 3); frame(5, 12, 4); frame(6, 12, 5);
      frame(3, 9, 6); frame(3, 10, 7); frame(3, 11, 8);
      frame(7, 9, 9); frame(7, 10, 10); frame(7, 11, 11);
      if (p.eyes.every(Boolean)) for (let x = 4; x <= 6; x++) for (let z = 9; z <= 11; z++) this.put(p, x, 3, z, ID.portal);
      if (!p.hasPlacedSpawner) { p.hasPlacedSpawner = true; this.put(p, 5, 3, 6, ID.spawner, 5); } // 5 = silverfish (vanilla portal room)
    }

    renderFiller(p) {
      for (let i = 0; i < p.steps; i++) {
        for (let x = 0; x <= 4; x++) this.put(p, x, 0, i, ID.stoneBricks);
        for (let y = 1; y <= 3; y++) {
          this.put(p, 0, y, i, ID.stoneBricks);
          for (let x = 1; x <= 3; x++) this.put(p, x, y, i, ID.air);
          this.put(p, 4, y, i, ID.stoneBricks);
        }
        for (let x = 0; x <= 4; x++) this.put(p, x, 4, i, ID.stoneBricks);
      }
    }

    build() {
      if (!this.generateLayout()) {
        // 极端情况下仍然给一个 PortalRoom，避免要塞完全消失；布局本身仍然是原版房间
        this.r = RNG(hashStr('stronghold-fallback:' + this.w.seed + ':' + this.h.key));
        this.resetWeights();
        const dirs = ['north', 'south', 'west', 'east'];
        const dir = dirs[this.r.int(4)];
        const start = this.makeStart(dir);
        const box = orientBox(this.h.x, 64, this.h.z, -4, -1, 0, 11, 8, 16, dir);
        const portal = new Piece('PortalRoom', 1, box, dir, this.r);
        this.start = start; this.portal = portal;
        this.pieces = [start, portal]; this.pending = []; this.start.portal = portal;
      }

      // 以传送门房间地面为 h.y，以房间中心为 h.x/h.z，整体平移
      const b = this.portal.box;
      this.dx = this.h.x - ((b[0] + b[3] + 1) >> 1);
      this.dz = this.h.z - ((b[2] + b[5] + 1) >> 1);
      this.dy = this.h.y - b[1];

      for (const p of this.pieces) this.render(p);
      // 调试/验收信息：记录本次要塞包含的全部原版部件
      this.w._shLast = {
        pieces: this.pieces.length,
        types: this.pieces.map(p => p.type),
        list: this.pieces.map(p => ({ t: p.type, b: [p.box[0] + this.dx, p.box[1] + this.dy, p.box[2] + this.dz, p.box[3] + this.dx, p.box[4] + this.dy, p.box[5] + this.dz], d: p.dir })),
        portal: [this.portal.box[0] + this.dx, this.portal.box[1] + this.dy, this.portal.box[2] + this.dz],
        portalBox: [this.portal.box[0] + this.dx, this.portal.box[1] + this.dy, this.portal.box[2] + this.dz, this.portal.box[3] + this.dx, this.portal.box[4] + this.dy, this.portal.box[5] + this.dz],
        dir: this.portal.dir,
        anchor: { dx: this.dx, dy: this.dy, dz: this.dz },
      };
      return this.S;
    }
  }

  globalThis.buildVanillaStronghold = function (w, h) {
    return new Gen(w, h).build();
  };
})();
