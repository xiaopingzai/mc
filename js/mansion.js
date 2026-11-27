// -----------------------------------------------------------------------------
// 26.2 原版林地府邸（WoodlandMansionPieces）JavaScript 移植
// MansionGrid 网格 / 三层房间识别 / MansionPiecePlacer / 原版 woodland_mansion 模板拼装
// -----------------------------------------------------------------------------
(function () {
  'use strict';
  const H = ['north', 'east', 'south', 'west'];
  const V = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] };
  const OPP = { north:'south', south:'north', east:'west', west:'east', up:'down', down:'up' };
  const rotDir = (d, n) => H.includes(d) ? H[(H.indexOf(d) + n) & 3] : d;
  const rel = (p, dir, n) => { const v = V[dir] || [0,0]; return [p[0] + v[0] * n, p[1], p[2] + v[1] * n]; };
  const above = (p, n) => [p[0], p[1] + n, p[2]];
  const rpos = (base, rot, dir, n) => rel(base, rotDir(dir, rot), n);
  const rp2 = (base, rot, dx, dz) => { const e = rotDir('east', rot), s = rotDir('south', rot); return [base[0] + V[e][0]*dx + V[s][0]*dz, base[1], base[2] + V[e][1]*dx + V[s][1]*dz]; };
  const rotOf = (r) => Number(r) & 3;

  class SimpleGrid {
    constructor(w, h, outside) { this.width = w; this.height = h; this.outside = outside; this.grid = Array.from({length:w},()=>new Array(h).fill(0)); }
    set(x, y, v) { if (x >= 0 && x < this.width && y >= 0 && y < this.height) this.grid[x][y] = v; }
    setArea(x0, y0, x1, y1, v) { for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) this.set(x,y,v); }
    get(x, y) { return x >= 0 && x < this.width && y >= 0 && y < this.height ? this.grid[x][y] : this.outside; }
    setif(x, y, ifv, v) { if (this.get(x,y) === ifv) this.set(x,y,v); }
    edgesTo(x, y, v) { return this.get(x-1,y)===v || this.get(x+1,y)===v || this.get(x,y+1)===v || this.get(x,y-1)===v; }
  }

  class MansionGrid {
    constructor(r) {
      this.random = r; this.entranceX = 7; this.entranceY = 4;
      this.baseGrid = new SimpleGrid(11,11,5);
      this.baseGrid.setArea(7,4,8,5,3); this.baseGrid.setArea(6,4,6,5,2); this.baseGrid.setArea(9,2,10,7,5);
      this.baseGrid.setArea(8,2,8,3,1); this.baseGrid.setArea(8,6,8,7,1); this.baseGrid.setArea(6,3,6,3,1); this.baseGrid.setArea(6,6,6,6,1);
      this.baseGrid.setArea(0,0,11,1,5); this.baseGrid.setArea(0,9,11,11,5);
      this.recursiveCorridor(this.baseGrid,7,2,'west',6); this.recursiveCorridor(this.baseGrid,7,7,'west',6);
      this.recursiveCorridor(this.baseGrid,5,3,'west',3); this.recursiveCorridor(this.baseGrid,5,6,'west',3);
      while (this.cleanEdges(this.baseGrid)) {}
      this.floorRooms = [new SimpleGrid(11,11,5),new SimpleGrid(11,11,5),new SimpleGrid(11,11,5)];
      this.identifyRooms(this.baseGrid,this.floorRooms[0]); this.identifyRooms(this.baseGrid,this.floorRooms[1]);
      this.floorRooms[0].setArea(8,4,8,5,0x800000); this.floorRooms[1].setArea(8,4,8,5,0x800000);
      this.thirdFloorGrid = new SimpleGrid(11,11,5); this.setupThirdFloor(); this.identifyRooms(this.thirdFloorGrid,this.floorRooms[2]);
    }
    static isHouse(g,x,y){ const v=g.get(x,y); return v===1||v===2||v===3||v===4; }
    isRoomId(g,x,y,floor,id){ return (this.floorRooms[floor].get(x,y)&0xFFFF)===id; }
    get1x2RoomDirection(g,x,y,floor,id){ for(const d of H){ if(this.isRoomId(g,x+V[d][0],y+V[d][1],floor,id)) return d; } return null; }
    recursiveCorridor(g,x,y,heading,depth){
      if(depth<=0)return; g.set(x,y,1); g.setif(x+V[heading][0],y+V[heading][1],0,1);
      for(let a=0;a<8;a++){ const nd=H[this.random.nextInt(4)]; if(nd===OPP[heading]||(nd==='east'&&this.random.nextBoolean()))continue;
        const nx=x+V[heading][0],ny=y+V[heading][1]; if(g.get(nx+V[nd][0],ny+V[nd][1])!==0||g.get(nx+V[nd][0]*2,ny+V[nd][1]*2)!==0)continue;
        this.recursiveCorridor(g,nx+V[nd][0],ny+V[nd][1],nd,depth-1); break; }
      const cw=rotDir(heading,1),ccw=rotDir(heading,3);
      for(const d of [cw,ccw]) { g.setif(x+V[d][0],y+V[d][1],0,2); g.setif(x+V[heading][0]+V[d][0],y+V[heading][1]+V[d][1],0,2); g.setif(x+V[d][0]*2,y+V[d][1]*2,0,2); }
      g.setif(x+V[heading][0]*2,y+V[heading][1]*2,0,2);
    }
    cleanEdges(g){
      let touched=false;
      for(let y=0;y<g.height;y++)for(let x=0;x<g.width;x++){ if(g.get(x,y)!==0)continue;
        let n=0; for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if(MansionGrid.isHouse(g,x+dx,y+dy))n++;
        if(n>=3){g.set(x,y,2);touched=true;continue;} if(n!==2)continue;
        let d=0; for(const [dx,dy] of [[1,1],[-1,1],[1,-1],[-1,-1]]) if(MansionGrid.isHouse(g,x+dx,y+dy))d++;
        if(d>1)continue; g.set(x,y,2);touched=true; }
      return touched;
    }
    setupThirdFloor(){
      const potential=[]; const floor=this.floorRooms[1];
      for(let y=0;y<this.thirdFloorGrid.height;y++)for(let x=0;x<this.thirdFloorGrid.width;x++){ const v=floor.get(x,y); if((v&0xF0000)===131072&&(v&0x200000)===0x200000) potential.push([x,y]); }
      if(!potential.length){ this.thirdFloorGrid.setArea(0,0,this.thirdFloorGrid.width,this.thirdFloorGrid.height,5); return; }
      const [rx,ry]=potential[this.random.nextInt(potential.length)]; const v=floor.get(rx,ry); floor.set(rx,ry,v|0x400000);
      const dir=this.get1x2RoomDirection(this.baseGrid,rx,ry,1,v&0xFFFF); if(!dir)return;
      const ex=rx+V[dir][0],ey=ry+V[dir][1];
      for(let y=0;y<this.thirdFloorGrid.height;y++)for(let x=0;x<this.thirdFloorGrid.width;x++){
        if(!MansionGrid.isHouse(this.baseGrid,x,y)){this.thirdFloorGrid.set(x,y,5);continue;}
        if(x===rx&&y===ry){this.thirdFloorGrid.set(x,y,3);continue;}
        if(x===ex&&y===ey){this.thirdFloorGrid.set(x,y,3);this.floorRooms[2].set(x,y,0x800000);}
      }
      const corridors=[]; for(const d of H){ if(this.thirdFloorGrid.get(ex+V[d][0],ey+V[d][1])===0)corridors.push(d); }
      if(!corridors.length){ this.thirdFloorGrid.setArea(0,0,11,11,5); floor.set(rx,ry,v); return; }
      const cd=corridors[this.random.nextInt(corridors.length)]; this.recursiveCorridor(this.thirdFloorGrid,ex+V[cd][0],ey+V[cd][1],cd,4); while(this.cleanEdges(this.thirdFloorGrid)){}
    }
    identifyRooms(from, roomGrid){
      const cells=[]; for(let y=0;y<from.height;y++)for(let x=0;x<from.width;x++) if(from.get(x,y)===2) cells.push([x,y]);
      for(let i=cells.length;i>1;i--){const k=this.random.nextInt(i),t=cells[i-1];cells[i-1]=cells[k];cells[k]=t;}
      let id=10;
      for(const [x,y] of cells){
        if(roomGrid.get(x,y)!==0)continue; let x0=x,x1=x,y0=y,y1=y,type=65536;
        if(roomGrid.get(x+1,y)===0&&roomGrid.get(x,y+1)===0&&roomGrid.get(x+1,y+1)===0&&from.get(x+1,y)===2&&from.get(x,y+1)===2&&from.get(x+1,y+1)===2){x1++;y1++;type=262144;}
        else if(roomGrid.get(x-1,y)===0&&roomGrid.get(x,y+1)===0&&roomGrid.get(x-1,y+1)===0&&from.get(x-1,y)===2&&from.get(x,y+1)===2&&from.get(x-1,y+1)===2){x0--;y1++;type=262144;}
        else if(roomGrid.get(x-1,y)===0&&roomGrid.get(x,y-1)===0&&roomGrid.get(x-1,y-1)===0&&from.get(x-1,y)===2&&from.get(x,y-1)===2&&from.get(x-1,y-1)===2){x0--;y0--;type=262144;}
        else if(roomGrid.get(x+1,y)===0&&from.get(x+1,y)===2){x1++;type=131072;}
        else if(roomGrid.get(x,y+1)===0&&from.get(x,y+1)===2){y1++;type=131072;}
        else if(roomGrid.get(x-1,y)===0&&from.get(x-1,y)===2){x0--;type=131072;}
        else if(roomGrid.get(x,y-1)===0&&from.get(x,y-1)===2){y0--;type=131072;}
        let dx=this.random.nextBoolean()?x0:x1, dy=this.random.nextBoolean()?y0:y1, door=0x200000;
        if(!from.edgesTo(dx,dy,1)){ dx=dx===x0?x1:x0; dy=dy===y0?y1:y0; if(!from.edgesTo(dx,dy,1)){dy=dy===y0?y1:y0; if(!from.edgesTo(dx,dy,1)){dx=dx===x0?x1:x0;dy=dy===y0?y1:y0; if(!from.edgesTo(dx,dy,1)){door=0;dx=x0;dy=y0;}}}}
        for(let ry=y0;ry<=y1;ry++)for(let rx=x0;rx<=x1;rx++) roomGrid.set(rx,ry,(rx===dx&&ry===dy?0x100000|door:0)|type|id);
        id++;
      }
    }
  }

  const zeroPos = (pos, mirror, rot, sx = 7, sz = 7) => {
    let mx = mirror === 2 ? --sx : 0, mz = mirror === 1 ? --sz : 0;
    if (rot === 0) return [pos[0] + mx, 0, pos[2] + mz];
    if (rot === 1) return [pos[0] + sz - mz, 0, pos[2] + mx];
    if (rot === 2) return [pos[0] + sx - mx, 0, pos[2] + sz - mz];
    return [pos[0] + mz, 0, pos[2] + sx - mx];
  };
  const rotatePoint = (p, rot) => rot === 1 ? [-p[2], p[1], p[0]] : rot === 2 ? [-p[0], p[1], -p[2]] : rot === 3 ? [p[2], p[1], -p[0]] : p;

  class FloorRooms {
    constructor(floor) { this.floor = floor; }
    n1x1(r) { return this.floor === 0 ? '1x1_a' + (r.nextInt(5)+1) : this.floor === 1 ? '1x1_b' + (r.nextInt(5)+1) : '1x1_b' + (r.nextInt(5)+1); }
    n1x1s(r) { return '1x1_as' + (r.nextInt(4)+1); }
    n1x2s(r, st) { if (this.floor === 0) return '1x2_a' + (r.nextInt(9)+1); if (st) return '1x2_c_stairs'; return '1x2_c' + (r.nextInt(4)+1); }
    n1x2f(r, st) { if (this.floor === 0) return '1x2_b' + (r.nextInt(5)+1); if (st) return '1x2_d_stairs'; return '1x2_d' + (r.nextInt(5)+1); }
    n1x2sec(r) { return this.floor === 0 ? '1x2_s' + (r.nextInt(2)+1) : '1x2_se1'; }
    n2x2(r) { return this.floor === 0 ? '2x2_a' + (r.nextInt(4)+1) : '2x2_b' + (r.nextInt(5)+1); }
    n2x2s() { return '2x2_s1'; }
  }

  class Placer {
    constructor(r, grid, origin, rot, add, floors) { this.r = r; this.g = grid; this.origin = origin; this.rot = rot; this.add = add; this.floors = floors; this.startX = grid.entranceX + 1; this.startY = grid.entranceY + 1; }
    wall(d, grid, sx, sy, ex, ey, wallType, yoff) {
      let x = sx, y = sy, dir = d, start = d;
      const data = { pos: above(this.origin, yoff || 0), rot: this.rot, wall: wallType };
      do {
        if (!MansionGrid.isHouse(grid, x + V[dir][0], y + V[dir][1])) {
          this.turn(data); dir = rotDir(dir, 1);
          if (x === ex && y === ey && start === dir) continue;
          this.wallPiece(data); continue;
        }
        if (MansionGrid.isHouse(grid, x + V[dir][0], y + V[dir][1]) && MansionGrid.isHouse(grid, x + V[dir][0] + V[rotDir(dir,3)][0], y + V[dir][1] + V[rotDir(dir,3)][1])) {
          this.innerTurn(data); x += V[dir][0]; y += V[dir][1]; dir = rotDir(dir,3); continue;
        }
        x += V[dir][0]; y += V[dir][1];
        if (x === ex && y === ey && start === dir) continue;
        this.wallPiece(data);
      } while (x !== ex || y !== ey || start !== dir);
    }
    wallPiece(d) { this.add(d.wall, rel(rp2(d.pos, d.rot, 7, 0), d.rot, 0, 0), d.rot); d.pos = rel(d.pos, rotDir('south', d.rot), 8); }
    turn(d) { d.pos = rel(d.pos, rotDir('south', d.rot), -1); this.add('wall_corner', d.pos, d.rot); d.pos = rel(d.pos, rotDir('south', d.rot), -7); d.pos = rel(d.pos, rotDir('west', d.rot), -6); d.rot = (d.rot + 1) & 3; }
    innerTurn(d) { d.pos = rel(d.pos, rotDir('south', d.rot), 6); d.pos = rel(d.pos, rotDir('east', d.rot), 8); d.rot = (d.rot + 3) & 3; }
    entrance() { const p = rel(this.origin, rotDir('west', this.rot), 9); this.add('entrance', p, this.rot); this.origin = rel(this.origin, rotDir('south', this.rot), 16); }
    roomPos(x, y, floor) { const p = [this.base[0], this.base[1] + 8 * floor + (floor === 2 ? 3 : 0), this.base[2]]; const q = rp2(p, this.rot, 0, 8 + (y - this.startY) * 8); return rp2(q, this.rot, (x - this.startX) * 8, 0); }
    addRoom1x1(pos, rot, door, rooms) {
      let pr = 0, name = rooms.n1x1(this.r);
      if (door !== 'east') { if (door === 'north') pr = 3; else if (door === 'west') pr = 2; else if (door === 'south') pr = 1; else name = rooms.n1x1s(this.r); }
      let o = zeroPos([1,0,0], 0, pr, 7, 7); pr = (pr + rot) & 3; o = rotatePoint(o, rot);
      this.add(name, [pos[0] + o[0], pos[1], pos[2] + o[2]], pr);
    }
    addRoom1x2(pos, rot, roomDir, door, rooms, stairs) {
      const side = () => rooms.n1x2s(this.r, stairs), front = () => rooms.n1x2f(this.r, stairs), sec = () => rooms.n1x2sec(this.r);
      const e = (n) => rel(pos, rotDir('east', rot), n), s = (p,n) => rel(p, rotDir('south', rot), n), w = (n) => rel(pos, rotDir('west', rot), n);
      let p, r = rot, m = 0;
      if (door === 'east' && roomDir === 'south') { p = e(1); this.add(side(),p,r); }
      else if (door === 'east' && roomDir === 'north') { p = s(e(1),6); this.add(side(),p,r,1); }
      else if (door === 'west' && roomDir === 'north') { p = s(e(7),6); this.add(side(),p,(r+2)&3); }
      else if (door === 'west' && roomDir === 'south') { p = e(7); this.add(side(),p,r,2); }
      else if (door === 'south' && roomDir === 'east') { p = e(1); this.add(side(),p,(r+1)&3,1); }
      else if (door === 'south' && roomDir === 'west') { p = e(7); this.add(side(),p,(r+1)&3); }
      else if (door === 'north' && roomDir === 'west') { p = s(e(7),6); this.add(side(),p,(r+1)&3,2); }
      else if (door === 'north' && roomDir === 'east') { p = s(e(1),6); this.add(side(),p,(r+3)&3); }
      else if (door === 'south' && roomDir === 'north') { p = rel(e(1),rotDir('north',rot),8); this.add(front(),p,r); }
      else if (door === 'north' && roomDir === 'south') { p = s(e(7),14); this.add(front(),p,(r+2)&3); }
      else if (door === 'west' && roomDir === 'east') { p = e(15); this.add(front(),p,(r+1)&3); }
      else if (door === 'east' && roomDir === 'west') { p = s(w(7),6); this.add(front(),p,(r+3)&3); }
      else if (door === 'up' && roomDir === 'east') { p = e(15); this.add(sec(),p,(r+1)&3); }
      else if (door === 'up' && roomDir === 'south') { p = e(1); this.add(sec(),p,r); }
    }
    addRoom2x2(pos, rot, roomDir, door, rooms) {
      let east = 0, south = 0, r = rot, m = 0;
      if (door === 'east' && roomDir === 'south') east = -7;
      else if (door === 'east' && roomDir === 'north') { east = -7; south = 6; m = 1; }
      else if (door === 'north' && roomDir === 'east') { east = 1; south = 14; r = (rot+3)&3; }
      else if (door === 'north' && roomDir === 'west') { east = 7; south = 14; r = (rot+3)&3; m = 1; }
      else if (door === 'south' && roomDir === 'west') { east = 7; south = -8; r = (rot+1)&3; }
      else if (door === 'south' && roomDir === 'east') { east = 1; south = -8; r = (rot+1)&3; m = 1; }
      else if (door === 'west' && roomDir === 'north') { east = 15; south = 6; r = (rot+2)&3; }
      else if (door === 'west' && roomDir === 'south') { east = 15; m = 2; }
      this.add(rooms.n2x2(this.r), rel(rp2(pos, rot, east, south), rot, 0, 0), r, m);
    }
  }

  Placer.prototype.createMansion = function () {
    this.base = this.origin.slice();
    this.entrance();
    const base = this.g.baseGrid, third = this.g.thirdFloorGrid;
    const d1 = { pos: this.base.slice(), rot: this.rot, wall: 'wall_flat' };
    const d2 = { pos: above(this.base, 8), rot: this.rot, wall: 'wall_window' };
    this.wall('south', base, this.startX, this.startY, this.g.entranceX + 1, this.g.entranceY, 'wall_flat', 0);
    this.wall('south', base, this.startX, this.startY, this.g.entranceX + 1, this.g.entranceY, 'wall_window', 8);
    let done = false;
    for (let y = 0; y < third.height && !done; y++) for (let x = third.width - 1; x >= 0 && !done; x--) {
      if (!MansionGrid.isHouse(third, x, y)) continue;
      const data = { pos: rel(above(this.base, 19), rotDir('south', this.rot), 8 + (y - this.startY) * 8), rot: this.rot, wall: 'wall_window' };
      data.pos = rp2(data.pos, this.rot, (x - this.startX) * 8, 0);
      this.wallPiece(data); this.wall('south', third, x, y, x, y, 'wall_window'); done = true;
    }
    this.roof(above(this.base, 16), base, third); this.roof(above(this.base, 27), third, null);
    for (let floor = 0; floor < 3; floor++) {
      const roomGrid = this.g.floorRooms[floor], rooms = this.floors[floor], grid = floor === 2 ? third : base;
      const southPiece = floor === 0 ? 'carpet_south_1' : 'carpet_south_2', westPiece = floor === 0 ? 'carpet_west_1' : 'carpet_west_2';
      for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) !== 1) continue;
        const pos = this.roomPos(x, y, floor);
        this.add('corridor_floor', pos, this.rot);
        if (grid.get(x, y - 1) === 1 || (roomGrid.get(x, y - 1) & 0x800000) === 0x800000) this.add('carpet_north', rel(rp2(pos, this.rot, 1, 0), this.rot, 0, 1), this.rot);
        if (grid.get(x + 1, y) === 1 || (roomGrid.get(x + 1, y) & 0x800000) === 0x800000) this.add('carpet_east', rel(rp2(pos, this.rot, 5, 1), this.rot, 0, 1), this.rot);
        if (grid.get(x, y + 1) === 1 || (roomGrid.get(x, y + 1) & 0x800000) === 0x800000) this.add(southPiece, rp2(pos, this.rot, -1, 5), this.rot);
        if (grid.get(x - 1, y) === 1 || (roomGrid.get(x - 1, y) & 0x800000) === 0x800000) this.add(westPiece, rp2(pos, this.rot, -1, -1), this.rot);
      }
      const wallPiece = floor === 0 ? 'indoors_wall_1' : 'indoors_wall_2', doorPiece = floor === 0 ? 'indoors_door_1' : 'indoors_door_2';
      for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
        const startRoom = floor === 2 && grid.get(x, y) === 3;
        if (grid.get(x, y) !== 2 && !startRoom) continue;
        const data = roomGrid.get(x, y), type = data & 0xF0000, id = data & 0xFFFF;
        const isStart = startRoom && (data & 0x800000) === 0x800000;
        const dirs = [];
        if ((data & 0x200000) === 0x200000) for (const d of H) if (grid.get(x + V[d][0], y + V[d][1]) === 1) dirs.push(d);
        const door = dirs.length ? dirs[this.r.nextInt(dirs.length)] : ((data & 0x100000) === 0x100000 ? 'up' : null);
        let pos = this.roomPos(x, y, floor);
        if (MansionGrid.isHouse(grid, x - 1, y) && !this.g.isRoomId(grid, x - 1, y, floor, id)) this.add(door === 'west' ? doorPiece : wallPiece, pos, this.rot);
        if (grid.get(x + 1, y) === 1 && !isStart) this.add(door === 'east' ? doorPiece : wallPiece, rel(pos, rotDir('east', this.rot), 8), this.rot);
        if (MansionGrid.isHouse(grid, x, y + 1) && !this.g.isRoomId(grid, x, y + 1, floor, id)) {
          let q = rel(pos, rotDir('south', this.rot), 7); q = rel(q, rotDir('east', this.rot), 7); this.add(door === 'south' ? doorPiece : wallPiece, q, (this.rot + 1) & 3);
        }
        if (grid.get(x, y - 1) === 1 && !isStart) {
          let q = rel(pos, rotDir('north', this.rot), 1); q = rel(q, rotDir('east', this.rot), 7); this.add(door === 'north' ? doorPiece : wallPiece, q, (this.rot + 1) & 3);
        }
        if (type === 65536) { this.addRoom1x1(pos, this.rot, door, rooms); continue; }
        if (type === 131072 && door) { const rd = this.g.get1x2RoomDirection(grid, x, y, floor, id); if (rd) this.addRoom1x2(pos, this.rot, rd, door, rooms, (data & 0x400000) === 0x400000); continue; }
        if (type === 262144 && door && door !== 'up') { let rd = rotDir(door, 1); if (!this.g.isRoomId(grid, x + V[rd][0], y + V[rd][1], floor, id)) rd = OPP[rd]; this.addRoom2x2(pos, this.rot, rd, door, rooms); continue; }
        if (type === 262144 && door === 'up') this.add(rooms.n2x2s(), rel(pos, rotDir('east', this.rot), 1), this.rot);
      }
    }
  };

  Placer.prototype.roof = function (roofOrigin, grid, aboveGrid) {
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      const p = rp2([roofOrigin[0], roofOrigin[1], roofOrigin[2]], this.rot, (x - this.startX) * 8, 8 + (y - this.startY) * 8);
      const isAbove = aboveGrid && MansionGrid.isHouse(aboveGrid, x, y);
      if (!MansionGrid.isHouse(grid, x, y) || isAbove) continue;
      this.add('roof', above(p, 3), this.rot);
      if (!MansionGrid.isHouse(grid, x + 1, y)) this.add('roof_front', rel(p, rotDir('east', this.rot), 6), this.rot);
      if (!MansionGrid.isHouse(grid, x - 1, y)) this.add('roof_front', rp2(p, this.rot, 0, 7), (this.rot + 2) & 3);
      if (!MansionGrid.isHouse(grid, x, y - 1)) this.add('roof_front', rel(p, rotDir('west', this.rot), 1), (this.rot + 3) & 3);
      if (MansionGrid.isHouse(grid, x, y + 1)) continue;
      this.add('roof_front', rp2(p, this.rot, 6, 6), (this.rot + 1) & 3);
    }
  };

  function mansionMarker(m, x, y, z, set, out) {
    if (typeof m === 'string' && m.startsWith('Chest')) {
      const face = m === 'ChestWest' ? 'west' : m === 'ChestEast' ? 'east' : m === 'ChestSouth' ? 'south' : 'north';
      const st = SG.helpers.stateOf('chest[facing=' + face + ',type=single,waterlogged=false]');
      if (st !== undefined) set(x, y, z, st);
      out.loot.push([x, y, z, 'loot', 'chests/woodland_mansion']); return;
    }
    if (m === 'Mage' || m === 'Warrior') { out.ent.push([x + 0.5, y, z + 0.5, m === 'Mage' ? 'evoker' : 'vindicator', {}]); return; }
    if (m === 'Group of Allays') { out.ent.push([x + 0.5, y, z + 0.5, 'allay', {}]); }
  }

  SG.TYPES = SG.TYPES || {};
  SG.TYPES.mansion = function (gen, name, def, cx, cz, r) {
    const bx = cx * 16 + 8, bz = cz * 16 + 8;
    if (!new Set(SG.helpers.biomeSet(def.biomes)).has(gen.biomeAtQuart(bx >> 2, 70 >> 2, bz >> 2))) return null;
    const y = gen.baseHeight(cx * 16 + 7, cz * 16 + 7);
    if (y < 60) return null;
    const origin = [cx * 16 + 7, y, cz * 16 + 7], rot = r.nextInt(4), pieces = [];
    const add = (tplName, pos, pr, mir) => {
      const p = SG.helpers.tplPiece('woodland_mansion/' + tplName, pos, pr, mir || 0, null, { marker: mansionMarker });
      if (p) pieces.push(p);
    };
    const placer = new Placer(r, new MansionGrid(r), origin, rot, add, [new FloorRooms(0), new FloorRooms(1), new FloorRooms(2)]);
    placer.createMansion();
    if (!pieces.length) return null;
    const box = pieces.reduce((a, p) => [Math.min(a[0],p.box[0]),Math.min(a[1],p.box[1]),Math.min(a[2],p.box[2]),Math.max(a[3],p.box[3]),Math.max(a[4],p.box[4]),Math.max(a[5],p.box[5])], pieces[0].box.slice());
    return { name, def, pieces, box, adapt: def.terrain_adaptation || 'none', step: def.step };
  };
  SG.TYPES.woodland_mansion = SG.TYPES.mansion;
  SG.mansionDebug = { MansionGrid, Placer, FloorRooms };
})();
