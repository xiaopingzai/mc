// -----------------------------------------------------------------------------
// 26.2 原版海底神殿（OceanMonumentPieces）JavaScript 移植
// 房间图 / 6 种 MonumentRoomFitter / Entry/Core/Wing/Penthouse / 全部 Double 与 Simple 房间
// 对应 net.minecraft.world.level.levelgen.structure.structures.OceanMonumentPieces
// -----------------------------------------------------------------------------
(function () {
  'use strict';
  const DIR = ['down', 'up', 'north', 'south', 'west', 'east'];
  const OPP = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };
  const HOR = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
  const roomIndex = (x, y, z) => y * 25 + z * 5 + x;
  const GRID_SOURCE = roomIndex(2, 0, 0);
  const GRID_TOP = roomIndex(2, 2, 0);
  const GRID_LEFT = roomIndex(0, 1, 0);
  const GRID_RIGHT = roomIndex(4, 1, 0);

  function orientBox(x, y, z, ox, oy, oz, w, h, d, dir) {
    if (dir === 'north') return [x + ox, y + oy, z - d + 1 + oz, x + w - 1 + ox, y + h - 1 + oy, z + oz];
    if (dir === 'west') return [x - d + 1 + oz, y + oy, z + ox, x + oz, y + h - 1 + oy, z + w - 1 + ox];
    if (dir === 'east') return [x + oz, y + oy, z + ox, x + d - 1 + oz, y + h - 1 + oy, z + w - 1 + ox];
    return [x + ox, y + oy, z + oz, x + w - 1 + ox, y + h - 1 + oy, z + d - 1 + oz];
  }
  const moveBox = (b, dx, dy, dz) => [b[0] + dx, b[1] + dy, b[2] + dz, b[3] + dx, b[4] + dy, b[5] + dz];
  const fromCorners = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];

  class RoomDefinition {
    constructor(index) {
      this.index = index; this.connections = new Array(6).fill(null); this.hasOpening = new Array(6).fill(false);
      this.claimed = false; this.isSource = false; this.scanIndex = 0;
    }
    setConnection(dir, other) {
      const i = DIR.indexOf(dir); this.connections[i] = other;
      if (other) other.connections[DIR.indexOf(OPP[dir])] = this;
    }
    updateOpenings() { for (let i = 0; i < 6; i++) this.hasOpening[i] = this.connections[i] != null; }
    findSource(scanIndex) {
      if (this.isSource) return true;
      this.scanIndex = scanIndex;
      for (let i = 0; i < 6; i++) {
        const c = this.connections[i];
        if (!c || !this.hasOpening[i] || c.scanIndex === scanIndex || !c.findSource(scanIndex)) continue;
        return true;
      }
      return false;
    }
    isSpecial() { return this.index >= 75; }
    countOpenings() { let n = 0; for (const v of this.hasOpening) if (v) n++; return n; }
  }

  function roomBox(room, w, h, d, dir) {
    const idx = room.index, rx = idx % 5, rz = Math.floor(idx / 5) % 5, ry = Math.floor(idx / 25);
    let b = orientBox(0, 0, 0, 0, 0, 0, w * 8, h * 4, d * 8, dir);
    if (dir === 'north') b = moveBox(b, rx * 8, ry * 4, -(rz + d) * 8 + 1);
    else if (dir === 'south') b = moveBox(b, rx * 8, ry * 4, rz * 8);
    else if (dir === 'west') b = moveBox(b, -(rz + d) * 8 + 1, ry * 4, rx * 8);
    else b = moveBox(b, rz * 8, ry * 4, rx * 8);
    return b;
  }

  function stateKey(key) { return key; }
  class Builder {
    constructor(px, pz, minY, H, blocks, meta, getId, idx, out, sea) {
      this.px = px; this.pz = pz; this.minY = minY; this.H = H; this.blocks = blocks; this.meta = meta;
      this.getId = getId; this.idx = idx; this.out = out; this.sea = sea; this.PAL = SG.PAL;
    }
    id(key) {
      const p = this.PAL || {}; const v = p[key];
      if (v !== undefined) return v;
      const base = key.split('[')[0]; return p[base] !== undefined ? p[base] : 0;
    }
    get(x, y, z) { return this.getId(x, y, z); }
    canWater(id) { return true; }
    put(x, y, z, key, m) {
      if (x < this.px || x >= this.px + 16 || z < this.pz || z >= this.pz + 16 || y < this.minY || y >= this.minY + this.H) return;
      const id = this.id(key); if (id < 0) return;
      const k = this.idx(x, y, z); this.blocks[k] = id; this.meta[k] = m || 0;
    }
    fillDown(x, y, z, key) {
      let yy = y;
      while (yy > this.minY + 1 && this.get(x, yy, z) === 0) { this.put(x, yy, z, key); yy--; }
    }
  }

  class MPiece {
    constructor(dir, box, type, room) { this.dir = dir; this.box = box; this.type = type; this.room = room; this.b = null; }
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
    p(key, x, y, z) { const w = this.world(x, y, z); this.b.put(w[0], w[1], w[2], key, 0); }
    g(key, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) this.p(key, x, y, z);
    }
    gb(edge, fill, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const on = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        this.p(on ? edge : fill, x, y, z);
      }
    }
    water(x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const w = this.world(x, y, z); const id = this.b.get(w[0], w[1], w[2]);
        const keep = [this.b.id('ice'), this.b.id('packed_ice'), this.b.id('blue_ice'), this.b.id('water')];
        if (keep.includes(id)) continue;
        if (w[1] >= this.b.sea && id !== this.b.id('water')) { this.b.put(w[0], w[1], w[2], 'air'); continue; }
        this.b.put(w[0], w[1], w[2], 'water');
      }
    }
    defaultFloor(xoff, zoff, down) {
      if (down) {
        this.g('prismarine', xoff + 0, 0, zoff + 0, xoff + 2, 0, zoff + 7);
        this.g('prismarine', xoff + 5, 0, zoff + 0, xoff + 7, 0, zoff + 7);
        this.g('prismarine', xoff + 3, 0, zoff + 0, xoff + 4, 0, zoff + 2);
        this.g('prismarine', xoff + 3, 0, zoff + 5, xoff + 4, 0, zoff + 7);
        this.g('prismarine_bricks', xoff + 3, 0, zoff + 2, xoff + 4, 0, zoff + 2);
        this.g('prismarine_bricks', xoff + 3, 0, zoff + 5, xoff + 4, 0, zoff + 5);
        this.g('prismarine_bricks', xoff + 2, 0, zoff + 3, xoff + 2, 0, zoff + 4);
        this.g('prismarine_bricks', xoff + 5, 0, zoff + 3, xoff + 5, 0, zoff + 4);
      } else this.g('prismarine', xoff + 0, 0, zoff + 0, xoff + 7, 0, zoff + 7);
    }
    fillOnly(key, x0, y0, z0, x1, y1, z1) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const w = this.world(x, y, z);
        if (this.b.get(w[0], w[1], w[2]) !== this.b.id('water')) continue;
        this.p(key, x, y, z);
      }
    }
    chunkIntersects(x0, z0, x1, z1) {
      const a = this.world(x0, 0, z0), c = this.world(x1, 0, z1);
      return a[0] >= this.b.px && a[0] < this.b.px + 16 && a[2] >= this.b.pz && a[2] < this.b.pz + 16 ||
        c[0] >= this.b.px && c[0] < this.b.px + 16 && c[2] >= this.b.pz && c[2] < this.b.pz + 16;
    }
    spawnElder(x, y, z) {
      const w = this.world(x, y, z);
      if (w[0] < this.b.px || w[0] >= this.b.px + 16 || w[2] < this.b.pz || w[2] >= this.b.pz + 16) return;
      this.b.out.ent.push([w[0] + 0.5, w[1], w[2] + 0.5, 'elder_guardian', {}]);
    }
  }

  class EntryRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 1, 1, 1, dir), 'entry', room); }
    render() {
      this.g('prismarine_bricks', 0, 3, 0, 2, 3, 7); this.g('prismarine_bricks', 5, 3, 0, 7, 3, 7);
      this.g('prismarine_bricks', 0, 2, 0, 1, 2, 7); this.g('prismarine_bricks', 6, 2, 0, 7, 2, 7);
      this.g('prismarine_bricks', 0, 1, 0, 0, 1, 7); this.g('prismarine_bricks', 7, 1, 0, 7, 1, 7);
      this.g('prismarine_bricks', 0, 1, 7, 7, 3, 7); this.g('prismarine_bricks', 1, 1, 0, 2, 3, 0);
      this.g('prismarine_bricks', 5, 1, 0, 6, 3, 0);
      if (this.room.hasOpening[2]) this.water(3, 1, 7, 4, 2, 7);
      if (this.room.hasOpening[4]) this.water(0, 1, 3, 1, 2, 4);
      if (this.room.hasOpening[5]) this.water(6, 1, 3, 7, 2, 4);
    }
  }

  class SimpleRoom extends MPiece {
    constructor(dir, room, r) { super(dir, roomBox(room, 1, 1, 1, dir), 'simple', room); this.mainDesign = r.nextInt(3); }
    render(r) {
      if (Math.floor(this.room.index / 25) > 0) this.defaultFloor(0, 0, this.room.hasOpening[0]);
      if (!this.room.connections[1]) this.fillOnly('prismarine', 1, 4, 1, 6, 4, 6);
      const center = this.mainDesign !== 0 && r.nextBoolean() && !this.room.hasOpening[0] && !this.room.hasOpening[1] && this.room.countOpenings() > 1;
      if (this.mainDesign === 0) {
        this.g('prismarine_bricks', 0, 1, 0, 2, 1, 2); this.g('prismarine_bricks', 0, 3, 0, 2, 3, 2);
        this.g('prismarine', 0, 2, 0, 0, 2, 2); this.g('prismarine', 1, 2, 0, 2, 2, 0);
        this.p('sea_lantern', 1, 2, 1);
        this.g('prismarine_bricks', 5, 1, 0, 7, 1, 2); this.g('prismarine_bricks', 5, 3, 0, 7, 3, 2);
        this.g('prismarine', 7, 2, 0, 7, 2, 2); this.g('prismarine', 5, 2, 0, 6, 2, 0);
        this.p('sea_lantern', 6, 2, 1);
        this.g('prismarine_bricks', 0, 1, 5, 2, 1, 7); this.g('prismarine_bricks', 0, 3, 5, 2, 3, 7);
        this.g('prismarine', 0, 2, 5, 0, 2, 7); this.g('prismarine', 1, 2, 7, 2, 2, 7);
        this.p('sea_lantern', 1, 2, 6);
        this.g('prismarine_bricks', 5, 1, 5, 7, 1, 7); this.g('prismarine_bricks', 5, 3, 5, 7, 3, 7);
        this.g('prismarine', 7, 2, 5, 7, 2, 7); this.g('prismarine', 5, 2, 7, 6, 2, 7);
        this.p('sea_lantern', 6, 2, 6);
        if (this.room.hasOpening[3]) this.g('prismarine_bricks', 3, 3, 0, 4, 3, 0);
        else { this.g('prismarine_bricks', 3, 3, 0, 4, 3, 1); this.g('prismarine', 3, 2, 0, 4, 2, 0); this.g('prismarine_bricks', 3, 1, 0, 4, 1, 1); }
        if (this.room.hasOpening[2]) this.g('prismarine_bricks', 3, 3, 7, 4, 3, 7);
        else { this.g('prismarine_bricks', 3, 3, 6, 4, 3, 7); this.g('prismarine', 3, 2, 7, 4, 2, 7); this.g('prismarine_bricks', 3, 1, 6, 4, 1, 7); }
        if (this.room.hasOpening[4]) this.g('prismarine_bricks', 0, 3, 3, 0, 3, 4);
        else { this.g('prismarine_bricks', 0, 3, 3, 1, 3, 4); this.g('prismarine', 0, 2, 3, 0, 2, 4); this.g('prismarine_bricks', 0, 1, 3, 1, 1, 4); }
        if (this.room.hasOpening[5]) this.g('prismarine_bricks', 7, 3, 3, 7, 3, 4);
        else { this.g('prismarine_bricks', 6, 3, 3, 7, 3, 4); this.g('prismarine', 7, 2, 3, 7, 2, 4); this.g('prismarine_bricks', 6, 1, 3, 7, 1, 4); }
      } else if (this.mainDesign === 1) {
        this.g('prismarine_bricks', 2, 1, 2, 2, 3, 2); this.g('prismarine_bricks', 2, 1, 5, 2, 3, 5);
        this.g('prismarine_bricks', 5, 1, 5, 5, 3, 5); this.g('prismarine_bricks', 5, 1, 2, 5, 3, 2);
        this.p('sea_lantern', 2, 2, 2); this.p('sea_lantern', 2, 2, 5); this.p('sea_lantern', 5, 2, 5); this.p('sea_lantern', 5, 2, 2);
        this.g('prismarine_bricks', 0, 1, 0, 1, 3, 0); this.g('prismarine_bricks', 0, 1, 1, 0, 3, 1);
        this.g('prismarine_bricks', 0, 1, 7, 1, 3, 7); this.g('prismarine_bricks', 0, 1, 6, 0, 3, 6);
        this.g('prismarine_bricks', 6, 1, 7, 7, 3, 7); this.g('prismarine_bricks', 7, 1, 6, 7, 3, 6);
        this.g('prismarine_bricks', 6, 1, 0, 7, 3, 0); this.g('prismarine_bricks', 7, 1, 1, 7, 3, 1);
        this.p('prismarine', 1, 2, 0); this.p('prismarine', 0, 2, 1); this.p('prismarine', 1, 2, 7); this.p('prismarine', 0, 2, 6);
        this.p('prismarine', 6, 2, 7); this.p('prismarine', 7, 2, 6); this.p('prismarine', 6, 2, 0); this.p('prismarine', 7, 2, 1);
        if (!this.room.hasOpening[3]) { this.g('prismarine_bricks', 1, 3, 0, 6, 3, 0); this.g('prismarine', 1, 2, 0, 6, 2, 0); this.g('prismarine_bricks', 1, 1, 0, 6, 1, 0); }
        if (!this.room.hasOpening[2]) { this.g('prismarine_bricks', 1, 3, 7, 6, 3, 7); this.g('prismarine', 1, 2, 7, 6, 2, 7); this.g('prismarine_bricks', 1, 1, 7, 6, 1, 7); }
        if (!this.room.hasOpening[4]) { this.g('prismarine_bricks', 0, 3, 1, 0, 3, 6); this.g('prismarine', 0, 2, 1, 0, 2, 6); this.g('prismarine_bricks', 0, 1, 1, 0, 1, 6); }
        if (!this.room.hasOpening[5]) { this.g('prismarine_bricks', 7, 3, 1, 7, 3, 6); this.g('prismarine', 7, 2, 1, 7, 2, 6); this.g('prismarine_bricks', 7, 1, 1, 7, 1, 6); }
      } else {
        this.g('prismarine_bricks', 0, 1, 0, 0, 1, 7); this.g('prismarine_bricks', 7, 1, 0, 7, 1, 7);
        this.g('prismarine_bricks', 1, 1, 0, 6, 1, 0); this.g('prismarine_bricks', 1, 1, 7, 6, 1, 7);
        this.g('dark_prismarine', 0, 2, 0, 0, 2, 7); this.g('dark_prismarine', 7, 2, 0, 7, 2, 7);
        this.g('dark_prismarine', 1, 2, 0, 6, 2, 0); this.g('dark_prismarine', 1, 2, 7, 6, 2, 7);
        this.g('prismarine_bricks', 0, 3, 0, 0, 3, 7); this.g('prismarine_bricks', 7, 3, 0, 7, 3, 7);
        this.g('prismarine_bricks', 1, 3, 0, 6, 3, 0); this.g('prismarine_bricks', 1, 3, 7, 6, 3, 7);
        this.g('dark_prismarine', 0, 1, 3, 0, 2, 4); this.g('dark_prismarine', 7, 1, 3, 7, 2, 4);
        this.g('dark_prismarine', 3, 1, 0, 4, 2, 0); this.g('dark_prismarine', 3, 1, 7, 4, 2, 7);
        if (this.room.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
        if (this.room.hasOpening[2]) this.water(3, 1, 7, 4, 2, 7);
        if (this.room.hasOpening[4]) this.water(0, 1, 3, 0, 2, 4);
        if (this.room.hasOpening[5]) this.water(7, 1, 3, 7, 2, 4);
      }
      if (center) { this.g('prismarine_bricks', 3, 1, 3, 4, 1, 4); this.g('prismarine', 3, 2, 3, 4, 2, 4); this.g('prismarine_bricks', 3, 3, 3, 4, 3, 4); }
    }
  }

  class SimpleTopRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 1, 1, 1, dir), 'simple_top', room); }
    render(r) {
      if (Math.floor(this.room.index / 25) > 0) this.defaultFloor(0, 0, this.room.hasOpening[0]);
      if (!this.room.connections[1]) this.fillOnly('prismarine', 1, 4, 1, 6, 4, 6);
      for (let x = 1; x <= 6; x++) for (let z = 1; z <= 6; z++) {
        if (r.nextInt(3) === 0) continue;
        const y0 = 2 + (r.nextInt(4) === 0 ? 0 : 1);
        this.g('wet_sponge', x, y0, z, x, 3, z);
      }
      this.g('prismarine_bricks', 0, 1, 0, 0, 1, 7); this.g('prismarine_bricks', 7, 1, 0, 7, 1, 7);
      this.g('prismarine_bricks', 1, 1, 0, 6, 1, 0); this.g('prismarine_bricks', 1, 1, 7, 6, 1, 7);
      this.g('dark_prismarine', 0, 2, 0, 0, 2, 7); this.g('dark_prismarine', 7, 2, 0, 7, 2, 7);
      this.g('dark_prismarine', 1, 2, 0, 6, 2, 0); this.g('dark_prismarine', 1, 2, 7, 6, 2, 7);
      this.g('prismarine_bricks', 0, 3, 0, 0, 3, 7); this.g('prismarine_bricks', 7, 3, 0, 7, 3, 7);
      this.g('prismarine_bricks', 1, 3, 0, 6, 3, 0); this.g('prismarine_bricks', 1, 3, 7, 6, 3, 7);
      this.g('dark_prismarine', 0, 1, 3, 0, 2, 4); this.g('dark_prismarine', 7, 1, 3, 7, 2, 4);
      this.g('dark_prismarine', 3, 1, 0, 4, 2, 0); this.g('dark_prismarine', 3, 1, 7, 4, 2, 7);
      if (this.room.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
    }
  }

  class DoubleYZRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 1, 2, 2, dir), 'double_yz', room); }
    render() {
      const north = this.room.connections[2], south = this.room;
      const northUp = north.connections[1], southUp = south.connections[1];
      if (Math.floor(this.room.index / 25) > 0) { this.defaultFloor(0, 8, north.hasOpening[0]); this.defaultFloor(0, 0, south.hasOpening[0]); }
      if (!southUp.connections[1]) this.fillOnly('prismarine', 1, 8, 1, 6, 8, 7);
      if (!northUp.connections[1]) this.fillOnly('prismarine', 1, 8, 8, 6, 8, 14);
      for (let y = 1; y <= 7; y++) {
        const key = (y === 2 || y === 6) ? 'prismarine' : 'prismarine_bricks';
        this.g(key, 0, y, 0, 0, y, 15); this.g(key, 7, y, 0, 7, y, 15);
        this.g(key, 1, y, 0, 6, y, 0); this.g(key, 1, y, 15, 6, y, 15);
      }
      for (let y = 1; y <= 7; y++) { const key = (y === 2 || y === 6) ? 'sea_lantern' : 'dark_prismarine'; this.g(key, 3, y, 7, 4, y, 8); }
      if (south.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
      if (south.hasOpening[5]) this.water(7, 1, 3, 7, 2, 4);
      if (south.hasOpening[4]) this.water(0, 1, 3, 0, 2, 4);
      if (north.hasOpening[2]) this.water(3, 1, 15, 4, 2, 15);
      if (north.hasOpening[4]) this.water(0, 1, 11, 0, 2, 12);
      if (north.hasOpening[5]) this.water(7, 1, 11, 7, 2, 12);
      if (southUp.hasOpening[3]) this.water(3, 5, 0, 4, 6, 0);
      if (southUp.hasOpening[5]) { this.water(7, 5, 3, 7, 6, 4); this.g('prismarine_bricks', 5, 4, 2, 6, 4, 5); this.g('prismarine_bricks', 6, 1, 2, 6, 3, 2); this.g('prismarine_bricks', 6, 1, 5, 6, 3, 5); }
      if (southUp.hasOpening[4]) { this.water(0, 5, 3, 0, 6, 4); this.g('prismarine_bricks', 1, 4, 2, 2, 4, 5); this.g('prismarine_bricks', 1, 1, 2, 1, 3, 2); this.g('prismarine_bricks', 1, 1, 5, 1, 3, 5); }
      if (northUp.hasOpening[2]) this.water(3, 5, 15, 4, 6, 15);
      if (northUp.hasOpening[4]) { this.water(0, 5, 11, 0, 6, 12); this.g('prismarine_bricks', 1, 4, 10, 2, 4, 13); this.g('prismarine_bricks', 1, 1, 10, 1, 3, 10); this.g('prismarine_bricks', 1, 1, 13, 1, 3, 13); }
      if (northUp.hasOpening[5]) { this.water(7, 5, 11, 7, 6, 12); this.g('prismarine_bricks', 5, 4, 10, 6, 4, 13); this.g('prismarine_bricks', 6, 1, 10, 6, 3, 10); this.g('prismarine_bricks', 6, 1, 13, 6, 3, 13); }
    }
  }

  class DoubleXYRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 2, 2, 1, dir), 'double_xy', room); }
    render() {
      const east = this.room.connections[5], west = this.room;
      const westUp = west.connections[1], eastUp = east.connections[1];
      if (Math.floor(this.room.index / 25) > 0) { this.defaultFloor(8, 0, east.hasOpening[0]); this.defaultFloor(0, 0, west.hasOpening[0]); }
      if (!westUp.connections[1]) this.fillOnly('prismarine', 1, 8, 1, 7, 8, 6);
      if (!eastUp.connections[1]) this.fillOnly('prismarine', 8, 8, 1, 14, 8, 6);
      for (let y = 1; y <= 7; y++) {
        const key = (y === 2 || y === 6) ? 'prismarine' : 'prismarine_bricks';
        this.g(key, 0, y, 0, 0, y, 7); this.g(key, 15, y, 0, 15, y, 7);
        this.g(key, 1, y, 0, 15, y, 0); this.g(key, 1, y, 7, 14, y, 7);
      }
      this.g('prismarine_bricks', 2, 1, 3, 2, 7, 4); this.g('prismarine_bricks', 3, 1, 2, 4, 7, 2);
      this.g('prismarine_bricks', 3, 1, 5, 4, 7, 5); this.g('prismarine_bricks', 13, 1, 3, 13, 7, 4);
      this.g('prismarine_bricks', 11, 1, 2, 12, 7, 2); this.g('prismarine_bricks', 11, 1, 5, 12, 7, 5);
      this.g('prismarine_bricks', 5, 1, 3, 5, 3, 4); this.g('prismarine_bricks', 10, 1, 3, 10, 3, 4);
      this.g('prismarine_bricks', 5, 7, 2, 10, 7, 5); this.g('prismarine_bricks', 5, 5, 2, 5, 7, 2);
      this.g('prismarine_bricks', 10, 5, 2, 10, 7, 2); this.g('prismarine_bricks', 5, 5, 5, 5, 7, 5);
      this.g('prismarine_bricks', 10, 5, 5, 10, 7, 5);
      this.p('prismarine_bricks', 6, 6, 2); this.p('prismarine_bricks', 9, 6, 2);
      this.p('prismarine_bricks', 6, 6, 5); this.p('prismarine_bricks', 9, 6, 5);
      this.g('prismarine_bricks', 5, 4, 3, 6, 4, 4); this.g('prismarine_bricks', 9, 4, 3, 10, 4, 4);
      this.p('sea_lantern', 5, 4, 2); this.p('sea_lantern', 5, 4, 5); this.p('sea_lantern', 10, 4, 2); this.p('sea_lantern', 10, 4, 5);
      if (west.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
      if (west.hasOpening[2]) this.water(3, 1, 7, 4, 2, 7);
      if (west.hasOpening[4]) this.water(0, 1, 3, 0, 2, 4);
      if (east.hasOpening[3]) this.water(11, 1, 0, 12, 2, 0);
      if (east.hasOpening[2]) this.water(11, 1, 7, 12, 2, 7);
      if (east.hasOpening[5]) this.water(15, 1, 3, 15, 2, 4);
      if (westUp.hasOpening[3]) this.water(3, 5, 0, 4, 6, 0);
      if (westUp.hasOpening[2]) this.water(3, 5, 7, 4, 6, 7);
      if (westUp.hasOpening[4]) this.water(0, 5, 3, 0, 6, 4);
      if (eastUp.hasOpening[3]) this.water(11, 5, 0, 12, 6, 0);
      if (eastUp.hasOpening[2]) this.water(11, 5, 7, 12, 6, 7);
      if (eastUp.hasOpening[5]) this.water(15, 5, 3, 15, 6, 4);
    }
  }

  class DoubleZRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 1, 1, 2, dir), 'double_z', room); }
    render() {
      const north = this.room.connections[2], south = this.room;
      if (Math.floor(this.room.index / 25) > 0) { this.defaultFloor(0, 8, north.hasOpening[0]); this.defaultFloor(0, 0, south.hasOpening[0]); }
      if (!south.connections[1]) this.fillOnly('prismarine', 1, 4, 1, 6, 4, 7);
      if (!north.connections[1]) this.fillOnly('prismarine', 1, 4, 8, 6, 4, 14);
      for (const y of [3, 2, 1]) {
        const key = y === 2 ? 'prismarine' : 'prismarine_bricks';
        this.g(key, 0, y, 0, 0, y, 15); this.g(key, 7, y, 0, 7, y, 15);
        this.g(key, 1, y, 0, 7, y, 0); this.g(key, 1, y, 15, 6, y, 15);
      }
      for (const [x, y, z, z2] of [[1,1,1,2],[6,1,1,2],[1,3,1,2],[6,3,1,2],[1,1,13,14],[6,1,13,14],[1,3,13,14],[6,3,13,14]]) this.g('prismarine_bricks', x, y, z, x, y, z2);
      this.g('prismarine_bricks', 2, 1, 6, 2, 3, 6); this.g('prismarine_bricks', 5, 1, 6, 5, 3, 6);
      this.g('prismarine_bricks', 2, 1, 9, 2, 3, 9); this.g('prismarine_bricks', 5, 1, 9, 5, 3, 9);
      this.g('prismarine_bricks', 3, 2, 6, 4, 2, 6); this.g('prismarine_bricks', 3, 2, 9, 4, 2, 9);
      this.g('prismarine_bricks', 2, 2, 7, 2, 2, 8); this.g('prismarine_bricks', 5, 2, 7, 5, 2, 8);
      this.p('sea_lantern', 2, 2, 5); this.p('sea_lantern', 5, 2, 5); this.p('sea_lantern', 2, 2, 10); this.p('sea_lantern', 5, 2, 10);
      this.p('prismarine_bricks', 2, 3, 5); this.p('prismarine_bricks', 5, 3, 5); this.p('prismarine_bricks', 2, 3, 10); this.p('prismarine_bricks', 5, 3, 10);
      if (south.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
      if (south.hasOpening[5]) this.water(7, 1, 3, 7, 2, 4);
      if (south.hasOpening[4]) this.water(0, 1, 3, 0, 2, 4);
      if (north.hasOpening[2]) this.water(3, 1, 15, 4, 2, 15);
      if (north.hasOpening[4]) this.water(0, 1, 11, 0, 2, 12);
      if (north.hasOpening[5]) this.water(7, 1, 11, 7, 2, 12);
    }
  }

  class DoubleXRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 2, 1, 1, dir), 'double_x', room); }
    render() {
      const east = this.room.connections[5], west = this.room;
      if (Math.floor(this.room.index / 25) > 0) { this.defaultFloor(8, 0, east.hasOpening[0]); this.defaultFloor(0, 0, west.hasOpening[0]); }
      if (!west.connections[1]) this.fillOnly('prismarine', 1, 4, 1, 7, 4, 6);
      if (!east.connections[1]) this.fillOnly('prismarine', 8, 4, 1, 14, 4, 6);
      for (const y of [3, 2, 1]) {
        const key = y === 2 ? 'prismarine' : 'prismarine_bricks';
        this.g(key, 0, y, 0, 0, y, 7); this.g(key, 15, y, 0, 15, y, 7);
        this.g(key, 1, y, 0, 15, y, 0); this.g(key, 1, y, 7, 14, y, 7);
      }
      this.g('prismarine_bricks', 5, 1, 0, 10, 1, 4); this.g('prismarine', 6, 2, 0, 9, 2, 3); this.g('prismarine_bricks', 5, 3, 0, 10, 3, 4);
      this.p('sea_lantern', 6, 2, 3); this.p('sea_lantern', 9, 2, 3);
      if (west.hasOpening[3]) this.water(3, 1, 0, 4, 2, 0);
      if (west.hasOpening[2]) this.water(3, 1, 7, 4, 2, 7);
      if (west.hasOpening[4]) this.water(0, 1, 3, 0, 2, 4);
      if (east.hasOpening[3]) this.water(11, 1, 0, 12, 2, 0);
      if (east.hasOpening[2]) this.water(11, 1, 7, 12, 2, 7);
      if (east.hasOpening[5]) this.water(15, 1, 3, 15, 2, 4);
    }
  }

  class DoubleYRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 1, 2, 1, dir), 'double_y', room); }
    render() {
      if (Math.floor(this.room.index / 25) > 0) this.defaultFloor(0, 0, this.room.hasOpening[0]);
      const above = this.room.connections[1];
      if (!above.connections[1]) this.fillOnly('prismarine', 1, 8, 1, 6, 8, 6);
      this.g('prismarine_bricks', 0, 4, 0, 0, 4, 7); this.g('prismarine_bricks', 7, 4, 0, 7, 4, 7);
      this.g('prismarine_bricks', 1, 4, 0, 6, 4, 0); this.g('prismarine_bricks', 1, 4, 7, 6, 4, 7);
      this.g('prismarine_bricks', 2, 4, 1, 2, 4, 2); this.g('prismarine_bricks', 1, 4, 2, 1, 4, 2);
      this.g('prismarine_bricks', 5, 4, 1, 5, 4, 2); this.g('prismarine_bricks', 6, 4, 2, 6, 4, 2);
      this.g('prismarine_bricks', 2, 4, 5, 2, 4, 6); this.g('prismarine_bricks', 1, 4, 5, 1, 4, 5);
      this.g('prismarine_bricks', 5, 4, 5, 5, 4, 6); this.g('prismarine_bricks', 6, 4, 5, 6, 4, 5);
      let def = this.room;
      for (let y = 1; y <= 5; y += 4) {
        if (def.hasOpening[3]) { this.g('prismarine_bricks', 2, y, 0, 2, y + 2, 0); this.g('prismarine_bricks', 5, y, 0, 5, y + 2, 0); this.g('prismarine_bricks', 3, y + 2, 0, 4, y + 2, 0); }
        else { this.g('prismarine_bricks', 0, y, 0, 7, y + 2, 0); this.g('prismarine', 0, y + 1, 0, 7, y + 1, 0); }
        if (def.hasOpening[2]) { this.g('prismarine_bricks', 2, y, 7, 2, y + 2, 7); this.g('prismarine_bricks', 5, y, 7, 5, y + 2, 7); this.g('prismarine_bricks', 3, y + 2, 7, 4, y + 2, 7); }
        else { this.g('prismarine_bricks', 0, y, 7, 7, y + 2, 7); this.g('prismarine', 0, y + 1, 7, 7, y + 1, 7); }
        if (def.hasOpening[4]) { this.g('prismarine_bricks', 0, y, 2, 0, y + 2, 2); this.g('prismarine_bricks', 0, y, 5, 0, y + 2, 5); this.g('prismarine_bricks', 0, y + 2, 3, 0, y + 2, 4); }
        else { this.g('prismarine_bricks', 0, y, 0, 0, y + 2, 7); this.g('prismarine', 0, y + 1, 0, 0, y + 1, 7); }
        if (def.hasOpening[5]) { this.g('prismarine_bricks', 7, y, 2, 7, y + 2, 2); this.g('prismarine_bricks', 7, y, 5, 7, y + 2, 5); this.g('prismarine_bricks', 7, y + 2, 3, 7, y + 2, 4); }
        else { this.g('prismarine_bricks', 7, y, 0, 7, y + 2, 7); this.g('prismarine', 7, y + 1, 0, 7, y + 1, 7); }
        def = above;
      }
    }
  }

  class CoreRoom extends MPiece {
    constructor(dir, room) { super(dir, roomBox(room, 2, 2, 2, dir), 'core', room); }
    render() {
      this.fillOnly('prismarine', 1, 8, 0, 14, 8, 14);
      this.g('prismarine_bricks', 0, 7, 0, 0, 7, 15); this.g('prismarine_bricks', 15, 7, 0, 15, 7, 15);
      this.g('prismarine_bricks', 1, 7, 0, 15, 7, 0); this.g('prismarine_bricks', 1, 7, 15, 14, 7, 15);
      for (let y = 1; y <= 6; y++) {
        const key = (y === 2 || y === 6) ? 'prismarine' : 'prismarine_bricks';
        for (const x of [0, 15]) { this.g(key, x, y, 0, x, y, 1); this.g(key, x, y, 6, x, y, 9); this.g(key, x, y, 14, x, y, 15); }
        this.g(key, 1, y, 0, 1, y, 0); this.g(key, 6, y, 0, 9, y, 0); this.g(key, 14, y, 0, 14, y, 0); this.g(key, 1, y, 15, 14, y, 15);
      }
      this.g('dark_prismarine', 6, 3, 6, 9, 6, 9); this.g('gold_block', 7, 4, 7, 8, 5, 8);
      for (const y of [3, 6]) for (const x of [6, 9]) { this.p('sea_lantern', x, y, 6); this.p('sea_lantern', x, y, 9); }
      for (const [x, z] of [[5,6],[5,9],[10,6],[10,9]]) { this.g('prismarine_bricks', x, 1, z, x, 2, z); }
      for (const [x, z] of [[6,5],[9,5],[6,10],[9,10]]) { this.g('prismarine_bricks', x, 1, z, x, 2, z); }
      for (const [x, z] of [[5,5],[5,10],[10,5],[10,10]]) { this.g('prismarine_bricks', x, 2, z, x, 6, z); }
      this.g('prismarine_bricks', 5, 7, 1, 5, 7, 6); this.g('prismarine_bricks', 10, 7, 1, 10, 7, 6);
      this.g('prismarine_bricks', 5, 7, 9, 5, 7, 14); this.g('prismarine_bricks', 10, 7, 9, 10, 7, 14);
      this.g('prismarine_bricks', 1, 7, 5, 6, 7, 5); this.g('prismarine_bricks', 1, 7, 10, 6, 7, 10);
      this.g('prismarine_bricks', 9, 7, 5, 14, 7, 5); this.g('prismarine_bricks', 9, 7, 10, 14, 7, 10);
      for (const [x, z] of [[2,2],[2,3],[3,2],[13,2],[13,3],[12,2],[2,12],[2,13],[3,13],[13,12],[13,13],[12,13]]) this.p('prismarine_bricks', x, 1, z);
    }
  }

  class WingRoom extends MPiece {
    constructor(dir, box, value) { super(dir, box, 'wing', null); this.mainDesign = value & 1; }
    render() {
      if (this.mainDesign === 0) {
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', 10 - i, 3 - i, 20 - i, 12 + i, 3 - i, 20);
        this.g('prismarine_bricks', 7, 0, 6, 15, 0, 16);
        this.g('prismarine_bricks', 6, 0, 6, 6, 3, 20); this.g('prismarine_bricks', 16, 0, 6, 16, 3, 20);
        this.g('prismarine_bricks', 7, 1, 7, 7, 1, 20); this.g('prismarine_bricks', 15, 1, 7, 15, 1, 20);
        this.g('prismarine_bricks', 7, 1, 6, 9, 3, 6); this.g('prismarine_bricks', 13, 1, 6, 15, 3, 6);
        this.g('prismarine_bricks', 8, 1, 7, 9, 1, 7); this.g('prismarine_bricks', 13, 1, 7, 14, 1, 7);
        this.g('prismarine_bricks', 9, 0, 5, 13, 0, 5); this.g('dark_prismarine', 10, 0, 7, 12, 0, 7);
        this.g('dark_prismarine', 8, 0, 10, 8, 0, 12); this.g('dark_prismarine', 14, 0, 10, 14, 0, 12);
        for (let z = 18; z >= 7; z -= 3) { this.p('sea_lantern', 6, 3, z); this.p('sea_lantern', 16, 3, z); }
        for (const [x, z] of [[10,10],[12,10],[10,12],[12,12]]) this.p('sea_lantern', x, 0, z);
        this.p('sea_lantern', 8, 3, 6); this.p('sea_lantern', 14, 3, 6);
        for (const [x, z] of [[4,4],[18,4],[4,18],[18,18]]) { this.p('prismarine_bricks', x, 2, z); this.p('sea_lantern', x, 1, z); this.p('prismarine_bricks', x, 0, z); }
        this.p('prismarine_bricks', 9, 7, 20); this.p('prismarine_bricks', 13, 7, 20);
        this.g('prismarine_bricks', 6, 0, 21, 7, 4, 21); this.g('prismarine_bricks', 15, 0, 21, 16, 4, 21);
        this.spawnElder(11, 2, 16);
      } else {
        this.g('prismarine_bricks', 9, 3, 18, 13, 3, 20);
        this.g('prismarine_bricks', 9, 0, 18, 9, 2, 18); this.g('prismarine_bricks', 13, 0, 18, 13, 2, 18);
        for (const x of [9, 13]) { this.p('prismarine_bricks', x, 6, 20); this.p('sea_lantern', x, 5, 20); this.p('prismarine_bricks', x, 4, 20); }
        this.g('prismarine_bricks', 7, 3, 7, 15, 3, 14);
        for (const x of [10, 12]) {
          this.g('prismarine_bricks', x, 0, 10, x, 6, 10); this.g('prismarine_bricks', x, 0, 12, x, 6, 12);
          this.p('sea_lantern', x, 0, 10); this.p('sea_lantern', x, 0, 12); this.p('sea_lantern', x, 4, 10); this.p('sea_lantern', x, 4, 12);
        }
        for (const x of [8, 14]) { this.g('prismarine_bricks', x, 0, 7, x, 2, 7); this.g('prismarine_bricks', x, 0, 14, x, 2, 14); }
        this.g('dark_prismarine', 8, 3, 8, 8, 3, 13); this.g('dark_prismarine', 14, 3, 8, 14, 3, 13);
        this.spawnElder(11, 5, 13);
      }
    }
  }

  class Penthouse extends MPiece {
    constructor(dir, box) { super(dir, box, 'penthouse', null); }
    render() {
      this.g('prismarine_bricks', 2, -1, 2, 11, -1, 11); this.g('prismarine', 0, -1, 0, 1, -1, 11);
      this.g('prismarine', 12, -1, 0, 13, -1, 11); this.g('prismarine', 2, -1, 0, 11, -1, 1); this.g('prismarine', 2, -1, 12, 11, -1, 13);
      this.g('prismarine_bricks', 0, 0, 0, 0, 0, 13); this.g('prismarine_bricks', 13, 0, 0, 13, 0, 13);
      this.g('prismarine_bricks', 1, 0, 0, 12, 0, 0); this.g('prismarine_bricks', 1, 0, 13, 12, 0, 13);
      for (let i = 2; i <= 11; i += 3) { this.p('sea_lantern', 0, 0, i); this.p('sea_lantern', 13, 0, i); this.p('sea_lantern', i, 0, 0); }
      this.g('prismarine_bricks', 2, 0, 3, 4, 0, 9); this.g('prismarine_bricks', 9, 0, 3, 11, 0, 9); this.g('prismarine_bricks', 4, 0, 9, 9, 0, 11);
      this.p('prismarine_bricks', 5, 0, 8); this.p('prismarine_bricks', 8, 0, 8); this.p('prismarine_bricks', 10, 0, 10); this.p('prismarine_bricks', 3, 0, 10);
      this.g('dark_prismarine', 3, 0, 3, 3, 0, 7); this.g('dark_prismarine', 10, 0, 3, 10, 0, 7); this.g('dark_prismarine', 6, 0, 10, 7, 0, 10);
      for (const x of [3, 10]) for (const z of [2, 5, 8]) this.g('prismarine_bricks', x, 0, z, x, 2, z);
      this.g('prismarine_bricks', 5, 0, 10, 5, 2, 10); this.g('prismarine_bricks', 8, 0, 10, 8, 2, 10);
      this.g('dark_prismarine', 6, -1, 7, 7, -1, 8); this.water(6, -1, 3, 7, -1, 4);
      this.spawnElder(6, 1, 6);
    }
  }

  const shuffle = (a, r) => { for (let i = a.length; i > 1; i--) { const k = r.nextInt(i), t = a[i - 1]; a[i - 1] = a[k]; a[k] = t; } return a; };

  class MonumentBuilding extends MPiece {
    constructor(west, north, dir, r, sea) {
      super(dir, orientBox(west, 39, north, 0, 0, 0, 58, 23, 58, dir), 'building', null);
      this.sea = sea; this.rooms = this.generateRoomGraph(r);
      this.sourceRoom.claimed = true;
      this.children = [new EntryRoom(dir, this.sourceRoom), new CoreRoom(dir, this.coreRoom)];
      const fitters = [FitDoubleYZ, FitDoubleXY, FitDoubleZ, FitDoubleX, FitDoubleY, FitSimpleTop, FitSimple];
      for (const room of this.rooms) {
        if (room.claimed || room.isSpecial()) continue;
        for (const F of fitters) {
          if (!F.fits(room)) continue;
          this.children.push(F.create(dir, room, r)); break;
        }
      }
      const off = this.world(9, 0, 22);
      for (const c of this.children) c.box = moveBox(c.box, off[0], off[1], off[2]);
      const b1 = fromCorners(this.world(1, 1, 1), this.world(23, 8, 21));
      const b2 = fromCorners(this.world(34, 1, 1), this.world(56, 8, 21));
      const b3 = fromCorners(this.world(22, 13, 22), this.world(35, 17, 35));
      let wingRandom = r.nextInt();
      this.children.push(new WingRoom(dir, b1, wingRandom++));
      this.children.push(new WingRoom(dir, b2, wingRandom++));
      this.children.push(new Penthouse(dir, b3));
    }

    generateRoomGraph(r) {
      const grid = new Array(75).fill(null);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 5; x++) for (let z = 0; z < 4; z++) grid[roomIndex(x, y, z)] = new RoomDefinition(roomIndex(x, y, z));
      for (let x = 1; x < 4; x++) for (let z = 0; z < 2; z++) grid[roomIndex(x, 2, z)] = new RoomDefinition(roomIndex(x, 2, z));
      this.sourceRoom = grid[GRID_SOURCE];
      for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) for (let y = 0; y < 3; y++) {
        const pos = roomIndex(x, y, z); if (!grid[pos]) continue;
        for (const d of DIR) {
          const v = d === 'down' ? [0,-1,0] : d === 'up' ? [0,1,0] : [HOR[d][0], 0, HOR[d][1]];
          const nx = x + v[0], ny = y + v[1], nz = z + v[2];
          if (nx < 0 || nx >= 5 || nz < 0 || nz >= 5 || ny < 0 || ny >= 3 || !grid[roomIndex(nx, ny, nz)]) continue;
          if (nz === z) grid[pos].setConnection(d, grid[roomIndex(nx, ny, nz)]); else grid[pos].setConnection(OPP[d], grid[roomIndex(nx, ny, nz)]);
        }
      }
      const roof = new RoomDefinition(1003), left = new RoomDefinition(1001), right = new RoomDefinition(1002);
      grid[GRID_TOP].setConnection('up', roof); grid[GRID_LEFT].setConnection('south', left); grid[GRID_RIGHT].setConnection('south', right);
      roof.claimed = left.claimed = right.claimed = true; this.sourceRoom.isSource = true;
      this.coreRoom = grid[roomIndex(r.nextInt(4), 0, 2)]; this.coreRoom.claimed = true;
      const c = this.coreRoom;
      c.connections[5].claimed = true; c.connections[2].claimed = true;
      c.connections[5].connections[2].claimed = true; c.connections[1].claimed = true;
      c.connections[5].connections[1].claimed = true; c.connections[2].connections[1].claimed = true;
      c.connections[5].connections[2].connections[1].claimed = true;
      const defs = grid.filter(Boolean);
      for (const d of defs) d.updateOpenings(); roof.updateOpenings(); shuffle(defs, r);
      let scan = 1;
      for (const d of defs) {
        let close = 0;
        for (let attempt = 0; close < 2 && attempt < 5; attempt++) {
          const f = r.nextInt(6); if (!d.hasOpening[f]) continue;
          const of = DIR.indexOf(OPP[DIR[f]]);
          d.hasOpening[f] = false; d.connections[f].hasOpening[of] = false;
          if (d.findSource(scan++) && d.connections[f].findSource(scan++)) { close++; continue; }
          d.hasOpening[f] = true; d.connections[f].hasOpening[of] = true;
        }
      }
      defs.push(roof, left, right); return defs;
    }

    render(r) {
      const waterHeight = Math.max(this.b.sea, 64) - this.box[1];
      this.water(0, 0, 0, 58, waterHeight, 58);
      this.genWing(false, 0); this.genWing(true, 33);
      this.genEntranceArchs(); this.genEntranceWall(); this.genRoofPiece(); this.genLowerWall(); this.genMiddleWall(); this.genUpperWall();
      for (let px = 0; px < 7; px++) {
        let pz = 0;
        while (pz < 7) {
          if (pz === 0 && px === 3) pz = 6;
          const bx = px * 9, bz = pz * 9;
          for (const w of [0,1,2,3]) for (const d of [0,1,2,3]) { this.p('prismarine_bricks', bx + w, 0, bz + d); this.fillColumn(bx + w, -1, bz + d, 'prismarine_bricks'); }
          if (px === 0 || px === 6) pz++; else pz += 6;
        }
      }
      for (let i = 0; i < 5; i++) {
        this.water(-1 - i, 0 + i * 2, -1 - i, -1 - i, 23, 58 + i);
        this.water(58 + i, 0 + i * 2, -1 - i, 58 + i, 23, 58 + i);
        this.water(0 - i, 0 + i * 2, -1 - i, 57 + i, 23, -1 - i);
        this.water(0 - i, 0 + i * 2, 58 + i, 57 + i, 23, 58 + i);
      }
      for (const c of this.children) {
        if (!(c.box[0] <= this.b.px + 15 && c.box[3] >= this.b.px && c.box[2] <= this.b.pz + 15 && c.box[5] >= this.b.pz)) continue;
        c.b = this.b; c.render(r);
      }
    }

    fillColumn(x, y, z, key) {
      const w = this.world(x, y, z); let yy = w[1];
      while (yy > this.b.minY + 1) {
        const id = this.b.get(w[0], yy, w[2]);
        if (id !== 0 && id !== this.b.id('water') && id !== this.b.id('ice') && id !== this.b.id('packed_ice') && id !== this.b.id('blue_ice')) break;
        this.b.put(w[0], yy, w[2], key); yy--;
      }
    }

    chunkHit(x0, z0, x1, z1) {
      const a = this.world(x0, 0, z0), c = this.world(x1, 0, z1);
      const minx = Math.min(a[0], c[0]), maxx = Math.max(a[0], c[0]), minz = Math.min(a[2], c[2]), maxz = Math.max(a[2], c[2]);
      return maxx >= this.b.px && minx < this.b.px + 16 && maxz >= this.b.pz && minz < this.b.pz + 16;
    }

    genWing(flip, xoff) {
      if (!this.chunkHit(xoff, 0, xoff + 23, 20)) return;
      this.g('prismarine', xoff, 0, 0, xoff + 24, 0, 20); this.water(xoff, 1, 0, xoff + 24, 10, 20);
      for (let i = 0; i < 4; i++) {
        this.g('prismarine_bricks', xoff + i, i + 1, i, xoff + i, i + 1, 20);
        this.g('prismarine_bricks', xoff + i + 7, i + 5, i + 7, xoff + i + 7, i + 5, 20);
        this.g('prismarine_bricks', xoff + 17 - i, i + 5, i + 7, xoff + 17 - i, i + 5, 20);
        this.g('prismarine_bricks', xoff + 24 - i, i + 1, i, xoff + 24 - i, i + 1, 20);
        this.g('prismarine_bricks', xoff + i + 1, i + 1, i, xoff + 23 - i, i + 1, i);
        this.g('prismarine_bricks', xoff + i + 8, i + 5, i + 7, xoff + 16 - i, i + 5, i + 7);
      }
      this.g('prismarine', xoff + 4, 4, 4, xoff + 6, 4, 20); this.g('prismarine', xoff + 7, 4, 4, xoff + 17, 4, 6);
      this.g('prismarine', xoff + 18, 4, 4, xoff + 20, 4, 20); this.g('prismarine', xoff + 11, 8, 11, xoff + 13, 8, 20);
      this.p('prismarine_bricks', xoff + 12, 9, 12); this.p('prismarine_bricks', xoff + 12, 9, 15); this.p('prismarine_bricks', xoff + 12, 9, 18);
      const lp = xoff + (flip ? 19 : 5), rp = xoff + (flip ? 5 : 19);
      for (let z = 20; z >= 5; z -= 3) this.p('prismarine_bricks', lp, 5, z);
      for (let z = 19; z >= 7; z -= 3) this.p('prismarine_bricks', rp, 5, z);
      for (let i = 0; i < 4; i++) this.p('prismarine_bricks', flip ? xoff + 24 - (17 - i * 3) : xoff + 17 - i * 3, 5, 5);
      this.p('prismarine_bricks', rp, 5, 5);
      this.g('prismarine', xoff + 11, 1, 12, xoff + 13, 7, 12); this.g('prismarine', xoff + 12, 1, 11, xoff + 12, 7, 13);
    }

    genEntranceArchs() {
      if (!this.chunkHit(22, 5, 35, 17)) return;
      this.water(25, 0, 0, 32, 8, 20);
      for (let i = 0; i < 4; i++) {
        this.g('prismarine_bricks', 24, 2, 5 + i * 4, 24, 4, 5 + i * 4);
        this.g('prismarine_bricks', 22, 4, 5 + i * 4, 23, 4, 5 + i * 4);
        this.p('prismarine_bricks', 25, 5, 5 + i * 4); this.p('prismarine_bricks', 26, 6, 5 + i * 4); this.p('sea_lantern', 26, 5, 5 + i * 4);
        this.g('prismarine_bricks', 33, 2, 5 + i * 4, 33, 4, 5 + i * 4); this.g('prismarine_bricks', 34, 4, 5 + i * 4, 35, 4, 5 + i * 4);
        this.p('prismarine_bricks', 32, 5, 5 + i * 4); this.p('prismarine_bricks', 31, 6, 5 + i * 4); this.p('sea_lantern', 31, 5, 5 + i * 4);
        this.g('prismarine', 27, 6, 5 + i * 4, 30, 6, 5 + i * 4);
      }
    }

    genEntranceWall() {
      if (!this.chunkHit(15, 20, 42, 21)) return;
      this.g('prismarine', 15, 0, 21, 42, 0, 21); this.water(26, 1, 21, 31, 3, 21);
      this.g('prismarine', 21, 12, 21, 36, 12, 21); this.g('prismarine', 17, 11, 21, 40, 11, 21); this.g('prismarine', 16, 10, 21, 41, 10, 21);
      this.g('prismarine', 15, 7, 21, 42, 9, 21); this.g('prismarine', 16, 6, 21, 41, 6, 21); this.g('prismarine', 17, 5, 21, 40, 5, 21);
      this.g('prismarine', 21, 4, 21, 36, 4, 21); this.g('prismarine', 22, 3, 21, 26, 3, 21); this.g('prismarine', 31, 3, 21, 35, 3, 21);
      this.g('prismarine', 23, 2, 21, 25, 2, 21); this.g('prismarine', 32, 2, 21, 34, 2, 21);
      this.g('prismarine_bricks', 28, 4, 20, 29, 4, 21);
      for (const [x,y,z] of [[27,3,21],[30,3,21],[26,2,21],[31,2,21],[25,1,21],[32,1,21]]) this.p('prismarine_bricks',x,y,z);
      for (let i = 0; i < 7; i++) { this.p('dark_prismarine', 28 - i, 6 + i, 21); this.p('dark_prismarine', 29 + i, 6 + i, 21); }
      for (let i = 0; i < 4; i++) { this.p('dark_prismarine', 28 - i, 9 + i, 21); this.p('dark_prismarine', 29 + i, 9 + i, 21); }
      this.p('dark_prismarine', 28, 12, 21); this.p('dark_prismarine', 29, 12, 21);
      for (let i = 0; i < 3; i++) { this.p('dark_prismarine', 22 - i * 2, 8, 21); this.p('dark_prismarine', 22 - i * 2, 9, 21); this.p('dark_prismarine', 35 + i * 2, 8, 21); this.p('dark_prismarine', 35 + i * 2, 9, 21); }
      this.water(15, 13, 21, 42, 15, 21);
      for (const [x0,y0,z0,x1,y1,z1] of [[15,1,21,15,6,21],[16,1,21,16,5,21],[17,1,21,20,4,21],[21,1,21,21,3,21],[22,1,21,22,2,21],[23,1,21,24,1,21],[42,1,21,42,6,21],[41,1,21,41,5,21],[37,1,21,40,4,21],[36,1,21,36,3,21],[33,1,21,34,1,21],[35,1,21,35,2,21]]) this.water(x0,y0,z0,x1,y1,z1);
    }

    genRoofPiece() {
      if (!this.chunkHit(21, 21, 36, 36)) return;
      this.g('prismarine', 21, 0, 22, 36, 0, 36); this.water(21, 1, 22, 36, 23, 36);
      for (let i = 0; i < 4; i++) {
        this.g('prismarine_bricks', 21 + i, 13 + i, 21 + i, 36 - i, 13 + i, 21 + i);
        this.g('prismarine_bricks', 21 + i, 13 + i, 36 - i, 36 - i, 13 + i, 36 - i);
        this.g('prismarine_bricks', 21 + i, 13 + i, 22 + i, 21 + i, 13 + i, 35 - i);
        this.g('prismarine_bricks', 36 - i, 13 + i, 22 + i, 36 - i, 13 + i, 35 - i);
      }
      this.g('prismarine', 25, 16, 25, 32, 16, 32);
      for (const [x,z] of [[25,25],[32,25],[25,32],[32,32]]) this.g('prismarine_bricks', x, 17, z, x, 19, z);
      this.p('prismarine_bricks',26,20,26); this.p('prismarine_bricks',27,21,27); this.p('sea_lantern',27,20,27); this.p('prismarine_bricks',26,20,31); this.p('prismarine_bricks',27,21,30); this.p('sea_lantern',27,20,30); this.p('prismarine_bricks',31,20,31); this.p('prismarine_bricks',30,21,30); this.p('sea_lantern',30,20,30); this.p('prismarine_bricks',31,20,26); this.p('prismarine_bricks',30,21,27); this.p('sea_lantern',30,20,27);
      this.g('prismarine', 28, 21, 27, 29, 21, 27); this.g('prismarine', 27, 21, 28, 27, 21, 29); this.g('prismarine', 28, 21, 30, 29, 21, 30); this.g('prismarine', 30, 21, 28, 30, 21, 29);
    }

    genLowerWall() {
      if (this.chunkHit(0, 21, 6, 58)) {
        this.g('prismarine', 0, 0, 21, 6, 0, 57); this.water(0, 1, 21, 6, 7, 57); this.g('prismarine', 4, 4, 21, 6, 4, 53);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', i, i + 1, 21, i, i + 1, 57 - i);
        for (let z = 23; z < 53; z += 3) this.p('prismarine_bricks', 5, 5, z);
        this.p('prismarine_bricks', 5, 5, 52);
        this.g('prismarine', 4, 1, 52, 6, 3, 52); this.g('prismarine', 5, 1, 51, 5, 3, 53);
      }
      if (this.chunkHit(51, 21, 58, 58)) {
        this.g('prismarine', 51, 0, 21, 57, 0, 57); this.water(51, 1, 21, 57, 7, 57); this.g('prismarine', 51, 4, 21, 53, 4, 53);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', 57 - i, i + 1, 21, 57 - i, i + 1, 57 - i);
        for (let z = 23; z < 53; z += 3) this.p('prismarine_bricks', 52, 5, z);
        this.p('prismarine_bricks', 52, 5, 52); this.g('prismarine', 51, 1, 52, 53, 3, 52); this.g('prismarine', 52, 1, 51, 52, 3, 53);
      }
      if (this.chunkHit(0, 51, 57, 57)) {
        this.g('prismarine', 7, 0, 51, 50, 0, 57); this.water(7, 1, 51, 50, 10, 57);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', i + 1, i + 1, 57 - i, 56 - i, i + 1, 57 - i);
      }
    }

    genMiddleWall() {
      if (this.chunkHit(7, 21, 13, 50)) {
        this.g('prismarine', 7, 0, 21, 13, 0, 50); this.water(7, 1, 21, 13, 10, 50); this.g('prismarine', 11, 8, 21, 13, 8, 53);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', i + 7, i + 5, 21, i + 7, i + 5, 54);
        for (let z = 21; z <= 45; z += 3) this.p('prismarine_bricks', 12, 9, z);
      }
      if (this.chunkHit(44, 21, 50, 54)) {
        this.g('prismarine', 44, 0, 21, 50, 0, 50); this.water(44, 1, 21, 50, 10, 50); this.g('prismarine', 44, 8, 21, 46, 8, 53);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', 50 - i, i + 5, 21, 50 - i, i + 5, 54);
        for (let z = 21; z <= 45; z += 3) this.p('prismarine_bricks', 45, 9, z);
      }
      if (this.chunkHit(8, 44, 49, 54)) {
        this.g('prismarine', 14, 0, 44, 43, 0, 50); this.water(14, 1, 44, 43, 10, 50);
        for (let x = 12; x <= 45; x += 3) {
          this.p('prismarine_bricks', x, 9, 45); this.p('prismarine_bricks', x, 9, 52);
          if (![12,18,24,33,39,45].includes(x)) continue;
          this.p('prismarine_bricks', x, 9, 47); this.p('prismarine_bricks', x, 9, 50);
          this.p('prismarine_bricks', x, 10, 45); this.p('prismarine_bricks', x, 10, 46); this.p('prismarine_bricks', x, 10, 51); this.p('prismarine_bricks', x, 10, 52);
          this.p('prismarine_bricks', x, 11, 47); this.p('prismarine_bricks', x, 11, 50); this.p('prismarine_bricks', x, 12, 48); this.p('prismarine_bricks', x, 12, 49);
        }
        for (let i = 0; i < 3; i++) this.g('prismarine', 8 + i, 5 + i, 54, 49 - i, 5 + i, 54);
        this.g('prismarine_bricks', 11, 8, 54, 46, 8, 54); this.g('prismarine', 14, 8, 44, 43, 8, 53);
      }
    }

    genUpperWall() {
      if (this.chunkHit(14, 21, 20, 43)) {
        this.g('prismarine', 14, 0, 21, 20, 0, 43); this.water(14, 1, 22, 20, 14, 43); this.g('prismarine', 18, 12, 22, 20, 12, 39); this.g('prismarine_bricks', 18, 12, 21, 20, 12, 21);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', i + 14, i + 9, 21, i + 14, i + 9, 43 - i);
        for (let z = 23; z <= 39; z += 3) this.p('prismarine_bricks', 19, 13, z);
      }
      if (this.chunkHit(37, 21, 43, 43)) {
        this.g('prismarine', 37, 0, 21, 43, 0, 43); this.water(37, 1, 22, 43, 14, 43); this.g('prismarine', 37, 12, 22, 39, 12, 39); this.g('prismarine_bricks', 37, 12, 21, 39, 12, 21);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', 43 - i, i + 9, 21, 43 - i, i + 9, 43 - i);
        for (let z = 23; z <= 39; z += 3) this.p('prismarine_bricks', 38, 13, z);
      }
      if (this.chunkHit(15, 37, 42, 43)) {
        this.g('prismarine', 21, 0, 37, 36, 0, 43); this.water(21, 1, 37, 36, 14, 43); this.g('prismarine', 21, 12, 37, 36, 12, 39);
        for (let i = 0; i < 4; i++) this.g('prismarine_bricks', 15 + i, i + 9, 43 - i, 42 - i, i + 9, 43 - i);
        for (let x = 21; x <= 36; x += 3) this.p('prismarine_bricks', x, 13, 38);
      }
    }
  }

  const FitDoubleYZ = {
    fits(d) { return d.hasOpening[2] && !d.connections[2].claimed && d.hasOpening[1] && !d.connections[1].claimed && d.connections[2].hasOpening[1] && !d.connections[2].connections[1].claimed; },
    create(dir, d) { d.claimed = true; d.connections[2].claimed = true; d.connections[1].claimed = true; d.connections[2].connections[1].claimed = true; return new DoubleYZRoom(dir, d); }
  };
  const FitDoubleXY = {
    fits(d) { return d.hasOpening[5] && !d.connections[5].claimed && d.hasOpening[1] && !d.connections[1].claimed && d.connections[5].hasOpening[1] && !d.connections[5].connections[1].claimed; },
    create(dir, d) { d.claimed = true; d.connections[5].claimed = true; d.connections[1].claimed = true; d.connections[5].connections[1].claimed = true; return new DoubleXYRoom(dir, d); }
  };
  const FitDoubleZ = {
    fits(d) { return d.hasOpening[2] && !d.connections[2].claimed; },
    create(dir, d) { let s = d; if (!d.hasOpening[2] || d.connections[2].claimed) s = d.connections[3]; s.claimed = true; s.connections[2].claimed = true; return new DoubleZRoom(dir, s); }
  };
  const FitDoubleX = {
    fits(d) { return d.hasOpening[5] && !d.connections[5].claimed; },
    create(dir, d) { d.claimed = true; d.connections[5].claimed = true; return new DoubleXRoom(dir, d); }
  };
  const FitDoubleY = {
    fits(d) { return d.hasOpening[1] && !d.connections[1].claimed; },
    create(dir, d) { d.claimed = true; d.connections[1].claimed = true; return new DoubleYRoom(dir, d); }
  };
  const FitSimpleTop = {
    fits(d) { return !d.hasOpening[4] && !d.hasOpening[5] && !d.hasOpening[2] && !d.hasOpening[3] && !d.hasOpening[1]; },
    create(dir, d) { d.claimed = true; return new SimpleTopRoom(dir, d); }
  };
  const FitSimple = {
    fits() { return true; },
    create(dir, d, r) { d.claimed = true; return new SimpleRoom(dir, d, r); }
  };

  SG.TYPES = SG.TYPES || {};
  SG.TYPES.monument = function (gen, name, def, cx, cz, r) {
    const bx = cx * 16 + 8, bz = cz * 16 + 8;
    const bset = new Set(SG.helpers.biomeSet(def.biomes));
    if (!bset.has(gen.biomeAtQuart(bx >> 2, (gen.sea || 63) >> 2, bz >> 2))) return null;
    const dir = ['north', 'east', 'south', 'west'][r.nextInt(4)];
    const west = cx * 16 - 29, north = cz * 16 - 29;
    const top = new MonumentBuilding(west, north, dir, r, gen.sea || 63);
    const piece = {
      kind: 'code', box: top.box, rigid: true, gld: 0, junctions: [],
      build: (x0, z0, minY, H, blocks, meta, getId, idx, out) => {
        const b = new Builder(x0, z0, minY, H, blocks, meta, getId, idx, out, gen.sea || 63);
        top.b = b; top.render(r);
      }
    };
    return { name, def, pieces: [piece], box: top.box, adapt: def.terrain_adaptation || 'none', step: def.step };
  };
  SG.TYPES.ocean_monument = SG.TYPES.monument;
  SG.monumentDebug = { MonumentBuilding, RoomDefinition, EntryRoom, SimpleRoom, DoubleYZRoom, DoubleXYRoom, DoubleZRoom, DoubleXRoom, DoubleYRoom, CoreRoom, WingRoom, Penthouse };
})();
