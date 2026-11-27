'use strict';
// ---------------------------------------------------------------------------
// 结构方块文件：原版 structure NBT 的读写 + 跨存档结构库
//  - 15 MB 上限：单文件原始/解压后都不得超过 15 MiB
//  - 3 天保留：IndexedDB 里按 created + 3 天过期，打开界面和读取时顺手清理
//  - 跨存档：结构库是全局的，不按世界种子分目录，所有存档都能加载
//  - 导出 .nbt（gzip）；导入同时接受 gzip NBT 和旧版 JSON
// ---------------------------------------------------------------------------
const SF_MAX = 15 * 1024 * 1024;
const SF_TTL = 3 * 24 * 60 * 60 * 1000;
const SF_DB = 'mcjs-structure-files';
const SF_STORE = 'files';

function sfIdb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('这个浏览器不支持 IndexedDB'));
    const r = indexedDB.open(SF_DB, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(SF_STORE)) {
        const os = db.createObjectStore(SF_STORE, { keyPath: 'name' });
        os.createIndex('expires', 'expires');
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('无法打开结构库'));
  });
}
function sfTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SF_STORE, mode), os = tx.objectStore(SF_STORE);
    let out;
    try { out = fn(os); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(out && out._req ? out._req.result : out);
    tx.onerror = () => reject(tx.error || new Error('结构库读写失败'));
    tx.onabort = () => reject(tx.error || new Error('结构库读写取消'));
  });
}
async function sfCleanup(db) {
  await new Promise((resolve) => {
    const tx = db.transaction(SF_STORE, 'readwrite'), os = tx.objectStore(SF_STORE), idx = os.index('expires');
    const q = idx.openCursor();
    q.onsuccess = () => {
      const c = q.result;
      if (!c) return resolve();
      if ((c.value.expires || 0) <= Date.now()) c.delete();
      c.continue();
    };
    q.onerror = () => resolve();
  });
}
function sfTimeLeft(expires) {
  const ms = Math.max(0, (expires || 0) - Date.now());
  return Math.ceil(ms / 3600000) + ' 小时';
}
async function sfList() {
  const db = await sfIdb();
  await sfCleanup(db);
  const rows = await sfTx(db, 'readonly', (os) => {
    const req = os.getAll(); return { _req: req };
  });
  try { db.close(); } catch (e) { }
  return (rows || []).sort((a, b) => (b.created || 0) - (a.created || 0));
}
async function sfGet(name) {
  if (!name) throw new Error('结构名不能为空');
  const db = await sfIdb();
  await sfCleanup(db);
  const rec = await sfTx(db, 'readonly', (os) => {
    const req = os.get(name); return { _req: req };
  });
  try { db.close(); } catch (e) { }
  if (!rec) throw new Error('没有名为「' + name + '」的结构');
  if ((rec.expires || 0) <= Date.now()) throw new Error('「' + name + '」已超过 3 天，已清理');
  return rec;
}
async function sfPut(name, data, w, h, d) {
  if (!name) throw new Error('结构名不能为空');
  if (!(data instanceof ArrayBuffer)) throw new Error('结构数据格式错误');
  if (data.byteLength > SF_MAX) throw new Error('结构超过 15 MB 上限（' + (data.byteLength / 1048576).toFixed(2) + ' MB）');
  const db = await sfIdb();
  await sfCleanup(db);
  const rec = { name, data, size: data.byteLength, w, h, d, created: Date.now(), expires: Date.now() + SF_TTL };
  await sfTx(db, 'readwrite', (os) => { os.put(rec); });
  try { db.close(); } catch (e) { }
  return rec;
}
async function sfDelete(name) {
  const db = await sfIdb();
  await sfTx(db, 'readwrite', (os) => { os.delete(name); });
  try { db.close(); } catch (e) { }
}

// ---- NBT (big-endian, Java edition) ---------------------------------------
const NBT_END = 0, NBT_BYTE = 1, NBT_SHORT = 2, NBT_INT = 3, NBT_LONG = 4, NBT_FLOAT = 5, NBT_DOUBLE = 6, NBT_BYTE_ARRAY = 7, NBT_STRING = 8, NBT_LIST = 9, NBT_COMPOUND = 10;
const nbtTag = (type, value) => ({ type, value });
const nbtString = (s) => nbtTag(NBT_STRING, String(s));
const nbtInt = (n) => nbtTag(NBT_INT, n | 0);

function nbtSerialize(root) {
  const bytes = [], enc = new TextEncoder();
  const u8 = (b) => bytes.push(b & 255), i16 = (n) => { u8(n >> 8); u8(n); }, i32 = (n) => { u8(n >> 24); u8(n >> 16); u8(n >> 8); u8(n); };
  const str = (s) => { const a = enc.encode(String(s)); i16(a.length); for (const b of a) u8(b); };
  const payload = (t) => {
    if (t.type === NBT_BYTE) u8(t.value);
    else if (t.type === NBT_SHORT) i16(t.value);
    else if (t.type === NBT_INT) i32(t.value);
    else if (t.type === NBT_STRING) str(t.value);
    else if (t.type === NBT_COMPOUND) {
      for (const k in t.value) { const child = t.value[k]; if (!child) continue; u8(child.type); str(k); payload(child); }
      u8(0);
    } else if (t.type === NBT_LIST) {
      let lt = t.listType;
      if (lt === undefined) lt = t.value.length ? t.value[0].type : NBT_END;
      u8(lt); i32(t.value.length);
      for (const c of t.value) payload(c);
    } else throw new Error('NBT 写入不支持的类型 ' + t.type);
  };
  const tag = (name, t) => { u8(t.type); str(name); payload(t); };
  tag('', root);
  return new Uint8Array(bytes).buffer;
}
function nbtParse(buf) {
  const view = new DataView(buf), dec = new TextDecoder(), bytes = new Uint8Array(buf);
  let off = 0;
  const i16 = () => { const v = view.getInt16(off, false); off += 2; return v; };
  const i32 = () => { const v = view.getInt32(off, false); off += 4; return v; };
  const str = () => { const n = i16(); const s = dec.decode(bytes.subarray(off, off + n)); off += n; return s; };
  const payload = (type) => {
    switch (type) {
      case NBT_BYTE: { const v = view.getInt8(off); off += 1; return v; }
      case NBT_SHORT: return i16();
      case NBT_INT: return i32();
      case NBT_LONG: { const v = view.getBigInt64(off, false); off += 8; return v; }
      case NBT_FLOAT: { const v = view.getFloat32(off, false); off += 4; return v; }
      case NBT_DOUBLE: { const v = view.getFloat64(off, false); off += 8; return v; }
      case NBT_STRING: return str();
      case NBT_COMPOUND: {
        const o = {};
        while (true) {
          const t = view.getUint8(off); off += 1;
          if (t === NBT_END) break;
          const name = str(); o[name] = nbtTag(t, payload(t));
        }
        return o;
      }
      case NBT_LIST: {
        const lt = view.getUint8(off); off += 1;
        const n = i32(), a = [];
        for (let i = 0; i < n; i++) a.push(nbtTag(lt, payload(lt)));
        return a;
      }
      case NBT_BYTE_ARRAY: { const n = i32(); const a = []; for (let i = 0; i < n; i++) { a.push(view.getInt8(off)); off++; } return a; }
      default: throw new Error('不支持的 NBT 类型 ' + type);
    }
  };
  const type = view.getUint8(off); off += 1;
  if (type !== NBT_COMPOUND) throw new Error('不是结构 NBT（根不是 Compound）');
  const name = str(), root = payload(NBT_COMPOUND);
  return root;
}

async function sfGunzip(buf) {
  if (!(buf instanceof ArrayBuffer)) buf = new ArrayBuffer(buf);
  if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器不支持 gzip 解压');
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}
async function sfGzip(buf) {
  if (typeof CompressionStream === 'undefined') return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

// ---- structure <-> NBT -----------------------------------------------------
function sfStateName(id, meta) {
  const b = BLOCKS[id];
  if (!b) return null;
  let props = b.states && b.states[meta] ? b.states[meta] : null;
  // 本版的楼梯 / 台阶 / 原木用 meta 而不是 states 表，必须按原版属性名补出来；
  // 否则导出的 NBT palette 是空属性，重新导入时朝向、top/bottom、axis 全丢。
  if (!props) {
    if (b.stairs) props = { facing: ['east', 'west', 'south', 'north'][meta & 3] || 'east', half: (meta & 4) ? 'top' : 'bottom', shape: stairShapeOf(meta) };
    else if (b.ladder) props = { facing: ({ 0: 'west', 1: 'east', 4: 'north', 5: 'south' })[meta] || 'north' };
    else if (b.slab) props = { type: ['bottom', 'top', 'double'][meta & 3] || 'bottom' };
    else if (b.axis) props = { axis: ['y', 'x', 'z'][meta & 3] || 'y' };
    else props = {};
  }
  const p = {};
  for (const k in props) if (props[k] !== undefined) p[k] = String(props[k]);
  return { name: 'minecraft:' + b.key, props: p };
}
function sfStateId(name, props) {
  name = String(name || '').replace(/^minecraft:/, '');
  const id = BID[name];
  if (id === undefined || !BLOCKS[id]) return [0, 0];
  const b = BLOCKS[id];
  if (!b.states || !b.states.length) {
    if (b.stairs) return [id, stairMeta(props && props.facing, props && props.half, props && props.shape)];
    if (b.ladder) {
      const lf = { west: 0, east: 1, north: 4, south: 5 }[props && props.facing];
      return [id, lf === undefined ? 2 : lf];
    }
    if (b.slab) {
      const t = ['bottom', 'top', 'double'].indexOf(props && props.type);
      return [id, t < 0 ? 0 : t];
    }
    if (b.axis) {
      const a = ['y', 'x', 'z'].indexOf(props && props.axis);
      return [id, a < 0 ? 0 : a];
    }
    return [id, 0];
  }
  let best = 0, bestScore = -1;
  for (let m = 0; m < b.states.length; m++) {
    const st = b.states[m] || {};
    let score = 0;
    for (const k in (props || {})) if (String(st[k]) === String(props[k])) score++;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return [id, best];
}
function sfMakeNbt(struct) {
  const size = nbtTag(NBT_LIST, [nbtInt(struct.w), nbtInt(struct.h), nbtInt(struct.d)]);
  size.listType = NBT_INT;
  const palette = [], palIndex = new Map(), blocks = [];
  for (let j = 0; j < struct.h; j++) for (let k = 0; k < struct.d; k++) for (let i = 0; i < struct.w; i++) {
    const cell = struct.blocks[(j * struct.d + k) * struct.w + i] || [0, 0];
    const id = cell[0] | 0, meta = cell[1] | 0;
    if (!id) continue;
    const key = id + ':' + meta;
    let pi = palIndex.get(key);
    if (pi === undefined) {
      pi = palette.length; palIndex.set(key, pi);
      const st = sfStateName(id, meta);
      if (!st) { palIndex.set(key, -1); continue; }
      const c = { Name: nbtString(st.name) };
      const pk = Object.keys(st.props);
      if (pk.length) {
        const props = {};
        for (const p of pk) props[p] = nbtString(st.props[p]);
        c.Properties = nbtTag(NBT_COMPOUND, props);
      }
      palette.push(nbtTag(NBT_COMPOUND, c));
    }
    if (pi < 0) continue;
    const pos = [nbtInt(i), nbtInt(j), nbtInt(k)]; // vanilla: x, y, z
    const posTag = nbtTag(NBT_LIST, pos); posTag.listType = NBT_INT;
    blocks.push(nbtTag(NBT_COMPOUND, { pos: posTag, state: nbtInt(pi) }));
  }
  const root = {
    DataVersion: nbtInt(3953),
    size,
    palette: (() => { const t = nbtTag(NBT_LIST, palette); t.listType = NBT_COMPOUND; return t; })(),
    blocks: (() => { const t = nbtTag(NBT_LIST, blocks); t.listType = NBT_COMPOUND; return t; })(),
    entities: (() => { const t = nbtTag(NBT_LIST, []); t.listType = NBT_COMPOUND; return t; })(),
  };
  return nbtSerialize(nbtTag(NBT_COMPOUND, root));
}
function sfReadNbt(buf) {
  const root = nbtParse(buf);
  const size = root.size && root.size.value;
  if (!size || size.length < 3) throw new Error('结构 NBT 缺少 size');
  const w = size[0].value | 0, h = size[1].value | 0, d = size[2].value | 0;
  if (w <= 0 || h <= 0 || d <= 0 || w > 128 || h > 128 || d > 128) throw new Error('结构尺寸不合法');
  const pal = root.palette && root.palette.value || [];
  const map = pal.map((e) => {
    const v = e.value || {};
    const props = {};
    if (v.Properties && v.Properties.value) for (const k in v.Properties.value) props[k] = v.Properties.value[k].value;
    return sfStateId(v.Name ? v.Name.value : 'air', props);
  });
  const blocks = new Array(w * h * d).fill(null).map(() => [0, 0]);
  let missing = 0;
  const bl = root.blocks && root.blocks.value || [];
  for (const e of bl) {
    const v = e.value || {};
    const p = v.pos && v.pos.value;
    if (!p || p.length < 3) continue;
    const x = p[0].value | 0, y = p[1].value | 0, z = p[2].value | 0;
    if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d) continue;
    const si = v.state ? (v.state.value | 0) : 0;
    const cell = map[si];
    if (!cell) { missing++; continue; }
    blocks[(y * d + z) * w + x] = cell;
  }
  return { w, h, d, blocks, missing };
}
function sfReadJson(obj) {
  if (!obj || !obj.w || !obj.h || !obj.d || !Array.isArray(obj.blocks)) throw new Error('结构 JSON 格式错误');
  return { w: obj.w | 0, h: obj.h | 0, d: obj.d | 0, blocks: obj.blocks, missing: 0 };
}

// ---- high-level file actions ----------------------------------------------
function sfSafeName(n) { return String(n || 'structure').replace(/[^A-Za-z0-9_\-]/g, '_').slice(0, 48) || 'structure'; }
async function sfExport(name, ui) {
  const rec = await sfGet(name);
  const gz = await sfGzip(rec.data);
  const blob = new Blob([gz], { type: 'application/octet-stream' });
  const a = document.createElement('a'), url = URL.createObjectURL(blob);
  a.href = url; a.download = sfSafeName(name) + '.nbt'; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { bytes: rec.data.byteLength, gz: gz.byteLength };
}
function sfPickImport() {
  return new Promise((resolve) => {
    const el = document.createElement('input');
    el.type = 'file'; el.accept = '.nbt,.json,.opusstruct,application/octet-stream,application/json';
    el.style.display = 'none'; document.body.appendChild(el);
    let done = false;
    const finish = (v) => { if (done) return; done = true; el.remove(); resolve(v); };
    el.onchange = async () => {
      try {
        if (!el.files || !el.files[0]) return finish(null);
        const f = el.files[0];
        if (f.size > SF_MAX) throw new Error('文件超过 15 MB 上限');
        const raw = await f.arrayBuffer();
        if (raw.byteLength > SF_MAX) throw new Error('文件超过 15 MB 上限');
        let data = raw;
        if (raw.byteLength > 2 && new Uint8Array(raw)[0] === 0x1f && new Uint8Array(raw)[1] === 0x8b) data = await sfGunzip(raw);
        if (data.byteLength > SF_MAX) throw new Error('解压后超过 15 MB 上限');
        let struct;
        try { struct = sfReadNbt(data); }
        catch (e) {
          try { struct = sfReadJson(JSON.parse(new TextDecoder().decode(data))); }
          catch (e2) { throw new Error('无法识别的结构文件'); }
        }
        finish({ name: f.name.replace(/\.[^.]+$/, ''), struct, bytes: data.byteLength });
      } catch (e) { finish({ error: e }); }
    };
    el.click();
  });
}
window.SF = { MAX: SF_MAX, TTL: SF_TTL, list: sfList, get: sfGet, put: sfPut, del: sfDelete, makeNbt: sfMakeNbt, readNbt: sfReadNbt, readJson: sfReadJson, exportFile: sfExport, pickImport: sfPickImport, timeLeft: sfTimeLeft, safeName: sfSafeName };
