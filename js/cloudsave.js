'use strict';
// ---------------------------------------------------------------------------
// Cloud saves (game/ACCOUNT_PLAN.md「云存档」, the service's cloud.js): a logged-in player's single-player worlds kept
// on the service too, so another device can carry on. Only what changed goes up: the chunks the game saved since the
// last sync (noted as they are written, per world) and the world's record, deflated, in batches. It syncs on leaving
// a world, every 10 minutes while playing, and when the page closes (as far as a closing page allows). A world
// changed both here and on another device is not merged: the player picks which copy stays. All of an account's
// cloud worlds together at most 100 MB; one nobody opened for 7 days is deleted from the cloud (not from here).
// ---------------------------------------------------------------------------
const CloudSave = (() => {
  const BATCH = 6 << 20;
  // chunks saved since the last sync: world id -> Set of 'o:cx:cz' / 'n:..' / 'e:..' (kept in localStorage)
  const dirty = new Map();
  let quiet = 0;
  const lsKey = (wid) => 'mcjs-cloud-dirty-' + wid;
  function dirtyOf(wid) {
    let s = dirty.get(wid);
    if (!s) { s = new Set(); try { for (const k of JSON.parse(localStorage.getItem(lsKey(wid)) || '[]')) s.add(k); } catch (e) { } dirty.set(wid, s); }
    return s;
  }
  let saveT = null;
  const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => { for (const [wid, s] of dirty) { try { if (s.size) localStorage.setItem(lsKey(wid), JSON.stringify([...s])); else localStorage.removeItem(lsKey(wid)); } catch (e) { } } }, 500); };
  const split = (sid) => { const i = sid.indexOf('~'); return i < 0 ? [sid, 'o'] : [sid.slice(0, i), sid.slice(i + 1) === 'nether' ? 'n' : 'e']; };
  const sidOf = (wid, d) => (d === 'o' ? wid : wid + '~' + (d === 'n' ? 'nether' : 'end'));
  // every chunk the game writes is noted (not the ones a download writes)
  const put = DB.putChunks.bind(DB);
  DB.putChunks = async function (id, list) {
    const r = await put(id, list);
    if (!quiet && list.length) { const [wid, d] = split(id), s = dirtyOf(wid); for (const [cx, cz] of list) s.add(`${d}:${cx}:${cz}`); persist(); }
    return r;
  };
  // a chunk record <-> bytes: three lengths, then the RLE blocks, metas and waterlogged cells, deflated
  async function encode(rec) {
    const b = new Uint8Array(rec.b.buffer, rec.b.byteOffset, rec.b.byteLength), m = new Uint8Array(rec.m.buffer, rec.m.byteOffset, rec.m.byteLength);
    const w = rec.w ? new Uint8Array(rec.w.buffer, rec.w.byteOffset, rec.w.byteLength) : new Uint8Array(0);
    const out = new Uint8Array(12 + b.length + m.length + w.length), dv = new DataView(out.buffer);
    dv.setUint32(0, rec.b.length); dv.setUint32(4, rec.m.length); dv.setUint32(8, rec.w ? rec.w.length : 0);
    out.set(b, 12); out.set(m, 12 + b.length); out.set(w, 12 + b.length + m.length);
    return NBT.deflate(out, 'deflate');
  }
  async function decode(bytes) {
    const raw = await NBT.inflate(bytes, 'deflate'), dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const nb = dv.getUint32(0), nm = dv.getUint32(4), nw = dv.getUint32(8);
    const copy = (o, n, T, sz) => { const a = new T(n); new Uint8Array(a.buffer).set(raw.subarray(o, o + n * sz)); return a; };
    const rec = { b: copy(12, nb, Uint16Array, 2), m: copy(12 + nb * 2, nm, Uint16Array, 2) };
    if (nw) rec.w = copy(12 + nb * 2 + nm * 2, nw, Uint32Array, 4);
    return rec;
  }
  // the service's file: "OMCC", the header, then each chunk (key, data)
  function pack(head, chunks) {
    const te = new TextEncoder(), h = te.encode(JSON.stringify(head));
    let n = 12 + h.length; for (const [k, d] of chunks) n += 6 + k.length + d.length;
    const out = new Uint8Array(n), dv = new DataView(out.buffer);
    out.set(te.encode('OMCC')); dv.setUint32(4, h.length); out.set(h, 8); dv.setUint32(8 + h.length, chunks.length);
    let o = 12 + h.length;
    for (const [k, d] of chunks) { dv.setUint16(o, k.length); out.set(te.encode(k), o + 2); o += 2 + k.length; dv.setUint32(o, d.length); out.set(d, o + 4); o += 4 + d.length; }
    return out;
  }
  function unpack(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), td = new TextDecoder();
    if (td.decode(buf.subarray(0, 4)) !== 'OMCC') throw new Error('云端数据不对');
    const hl = dv.getUint32(4), head = JSON.parse(td.decode(buf.subarray(8, 8 + hl)));
    let o = 8 + hl; const n = dv.getUint32(o); o += 4;
    const chunks = [];
    for (let i = 0; i < n; i++) { const kl = dv.getUint16(o), k = td.decode(buf.subarray(o + 2, o + 2 + kl)); o += 2 + kl; const dl = dv.getUint32(o); chunks.push([k, buf.subarray(o + 4, o + 4 + dl)]); o += 4 + dl; }
    return { head, chunks };
  }
  // ---- 客户端加密：口令 PBKDF2 派生 AES-GCM 密钥，区块数据加密后上传，服务器只存密文 ----
  const CK_KEY = 'mcjs-cloud-key';
  const cte = new TextEncoder(), ctd = new TextDecoder();
  const cryptoOK = () => !!(window.crypto && crypto.subtle);
  function b64enc(bytes) { const b = new Uint8Array(bytes); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b64dec(s) { const bin = atob(s), b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; }
  // 由口令 + 账号名派生密钥并存本机；换设备登录时重新派生
  async function deriveCloudKey(pass, name) {
    if (!cryptoOK()) return null;
    const salt = cte.encode('omcc-cloud:' + String(name || '').toLowerCase());
    const base = await crypto.subtle.importKey('raw', cte.encode(String(pass || '')), 'PBKDF2', false, ['deriveKey']);
    const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k));
    try { localStorage.setItem(CK_KEY, b64enc(raw)); } catch (e) { }
    return k;
  }
  async function loadCloudKey() {
    if (!cryptoOK()) return null;
    const b = localStorage.getItem(CK_KEY); if (!b) return null;
    try { return await crypto.subtle.importKey('raw', b64dec(b), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); } catch (e) { return null; }
  }
  function clearCloudKey() { try { localStorage.removeItem(CK_KEY); } catch (e) { } }
  // 加密包 OMCX：保留明文头部索引（世界名/编号要在列表显示），只加密区块尾段
  async function encryptOMCC(plain, key) {
    if (!key) return plain;
    const dv = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
    const headLen = dv.getUint32(4);
    const head = plain.subarray(8, 8 + headLen);
    const tail = plain.subarray(8 + headLen);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, tail));
    const out = new Uint8Array(4 + 4 + headLen + 12 + ct.length);
    const odv = new DataView(out.buffer);
    out.set(cte.encode('OMCX'), 0); odv.setUint32(4, headLen);
    out.set(head, 8); out.set(iv, 8 + headLen); out.set(ct, 8 + headLen + 12);
    return out;
  }
  async function decryptOMCC(buf, key) {
    const magic = ctd.decode(buf.subarray(0, 4));
    if (magic !== 'OMCX') return buf; // 旧明文包兼容
    if (!key) throw new Error('缺少存档密钥：请退出后重新登录');
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const headLen = dv.getUint32(4);
    const head = buf.subarray(8, 8 + headLen);
    const iv = buf.subarray(8 + headLen, 8 + headLen + 12);
    const ct = buf.subarray(8 + headLen + 12);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
    const out = new Uint8Array(4 + 4 + headLen + pt.length);
    const odv = new DataView(out.buffer);
    out.set(cte.encode('OMCC'), 0); odv.setUint32(4, headLen); out.set(head, 8); out.set(pt, 8 + headLen);
    return out;
  }
  async function post(bytes) {
    let r;
    try { r = await fetch(Account.apiBase() + '/cloud.php?action=push&_t=' + encodeURIComponent(Account.token), { method: 'POST', body: bytes }); }
    catch (e) { throw new Error('连不上服务器，云存档没有同步'); }
    const j = await r.json().catch(() => ({ error: '服务器没有回应' }));
    return { status: r.status, j };
  }
  // the world record as it goes up (without its cloud bookkeeping)
  const metaOut = (m) => { const o = { ...m }; delete o.cloud; return o; };
  let busy = false;
  const api = {
    get busy() { return busy; },
    dirtyCount(wid) { return dirtyOf(wid).size; },
    deriveKey(pass, name) { return deriveCloudKey(pass, name); },
    clearKey() { clearCloudKey(); },
    // send what changed (opts.force: this device's copy wins - the whole world goes up again)
    async sync(meta, opts = {}) {
      if (!Account.loggedIn || !meta) return { skipped: true };
      if (busy) return { busy: true };
      busy = true;
      try {
        // 整包上传：收集该世界全部区块，一次推送到本站 PHP（覆盖云端副本）
        const keys = [];
        for (const d of ['o', 'n', 'e']) for (const k of await DB.chunkKeys(sidOf(meta.id, d))) keys.push(`${d}:${Math.floor(k / 65536) - 32768}:${(k % 65536) - 32768}`);
        const batch = [];
        for (const k of keys) {
          const [d, cx, cz] = k.split(':'), rec = await DB.getChunk(sidOf(meta.id, d), +cx, +cz);
          if (!rec) continue;
          batch.push([k, await encode(rec)]);
        }
        const head = { wid: meta.id, meta: metaOut(meta), base: 0, device: Account.device(), force: true, replace: true };
        const key = await loadCloudKey();
        const bytes = await encryptOMCC(pack(head, batch), key);
        const { status, j } = await post(bytes);
        if (j.full) return { full: true, used: j.used, quota: j.quota };
        if (status !== 200) throw new Error(j.error || '云存档同步失败');
        dirtyOf(meta.id).clear(); persist();
        meta.cloud = { rev: j.rev, at: Date.now(), played: meta.lastPlayed, size: j.size, expires: j.expires };
        await DB.putWorld(meta);
        if (typeof game !== 'undefined' && game.worldMeta && game.worldMeta.id === meta.id && game.worldMeta !== meta) game.worldMeta.cloud = meta.cloud;
        return { ok: true, sent: batch.length, rev: j.rev, used: j.used, quota: j.quota };
      } finally { busy = false; }
    },
    async list() { return Account.api('/api/cloud'); },
    // the cloud's copy of a world onto this device (chunks after the revision this device has, or all of it)
    async download(wid, progress) {
      const r = await fetch(Account.apiBase() + '/cloud.php?action=download&wid=' + encodeURIComponent(wid) + '&_t=' + encodeURIComponent(Account.token));
      if (!r.ok) throw new Error('下载失败');
      const raw = new Uint8Array(await r.arrayBuffer());
      const plain = await decryptOMCC(raw, await loadCloudKey());
      const { head, chunks } = unpack(plain);
      quiet++;
      try {
        await DB.deleteWorld(wid);
        const byDim = { o: [], n: [], e: [] };
        let n = 0;
        for (const [k, b] of chunks) { const [d, cx, cz] = k.split(':'); byDim[d].push([+cx, +cz, await decode(b)]); if (++n % 50 === 0) { progress && progress(n / chunks.length); await new Promise((res) => setTimeout(res, 0)); } }
        for (const d of ['o', 'n', 'e']) for (let i = 0; i < byDim[d].length; i += 64) await DB.putChunks(sidOf(wid, d), byDim[d].slice(i, i + 64));
        const meta = Object.assign({}, head.meta, { id: wid, cloud: { rev: head.rev, at: Date.now(), played: head.meta.lastPlayed } });
        await DB.putWorld(meta);
        dirtyOf(wid).clear(); persist();
        return meta;
      } finally { quiet--; }
    },
    async remove(wid) { await Account.api('/api/cloud/' + wid + '/delete', {}); const m = await DB.getWorld(wid); if (m && m.cloud) { delete m.cloud; await DB.putWorld(m); } },
    touch(wid) { if (Account.loggedIn && !Account.isLocal) Account.api('/api/cloud/' + wid + '/touch', {}).catch(() => { }); },
  };
  return api;
})();

// ---- when it syncs: leaving a world, every 10 minutes of play, the page closing ----
(() => {
  const say = (g, r) => {
    if (!r || r.skipped || r.upToDate || r.busy) return;
    if (r.ok) g.ui.message('云存档已同步', '#AAAAAA');
    else if (r.full) g.ui.message(`云存档空间满了（${(r.used / 1048576).toFixed(0)} / ${(r.quota / 1048576).toFixed(0)} MB）：存档列表 → 云端存档 里删掉不要的`, '#FFAA00');
    else if (r.conflict) g.ui.message('这个世界在别的设备上也改过：下次进入时选择保留哪一份', '#FFAA00');
  };
  const q = Game.prototype.quitToTitle;
  Game.prototype.quitToTitle = async function () {
    const meta = !this.net && this.worldMeta ? this.worldMeta : null;
    const r = await q.call(this);
    // (a failed read of the record used to throw out of here after the title was up: an unhandled rejection, no sync)
    if (meta) DB.getWorld(meta.id).catch(() => null).then((m) => CloudSave.sync(m || meta)).then((x) => say(this, x), (e) => this.ui.message(e.message, '#FF5555'));
    return r;
  };
  setInterval(() => {
    const g = typeof game !== 'undefined' && game;
    if (!g || g.state !== 'play' || g.net || !g.worldMeta || !Account.loggedIn) return;
    if (Date.now() - (g.cloudAt || g.worldMeta.lastPlayed || 0) < 600e3) return;
    g.cloudAt = Date.now();
    g.saveWorld(true).then(() => CloudSave.sync(g.worldMeta)).then((x) => say(g, x), () => { });
  }, 60e3);
  // the page closing (Toy tells it; a plain page: hidden): save, and send what fits
  const closing = () => {
    const g = typeof game !== 'undefined' && game;
    if (!g || g.state !== 'play' || g.net || !g.worldMeta) return;
    g.saveWorld(true).then(() => CloudSave.sync(g.worldMeta)).catch(() => { });
  };
  Toy.onPageClose(closing).catch(() => { });
  document.addEventListener('visibilitychange', () => { if (document.hidden) closing(); });
})();

// 累计游玩时长：毫秒 → 天 / 时 / 分
function fmtPlayMs(ms) {
  ms = Math.max(0, ms | 0);
  if (!ms) return '';
  const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
  if (d > 0) return `玩了 ${d} 天 ${h % 24} 时 ${min % 60} 分`;
  if (h > 0) return `玩了 ${h} 时 ${min % 60} 分`;
  return `玩了 ${min} 分`;
}
// ---- 云端存档: what is in the cloud, download / delete, the space used ----
class CloudScreen extends MenuScreen {
  constructor(game, parent) { super(game, '云端存档'); this.parent = parent; this.pauses = false; this.titleY = 8; this.data = null; this.local = new Map(); this.note = ''; this.noteColor = '#A0A0A0'; this.confirm = null; this.load(); }
  say(t, bad) { this.note = t; this.noteColor = bad ? '#FF6060' : '#A0A0A0'; }
  async load() {
    try { this.data = await CloudSave.list(); for (const w of await DB.listWorlds()) this.local.set(w.id, w); }
    catch (e) { this.data = { worlds: [], used: 0, quota: 0 }; this.say(e.message, true); }
    if (this.game.ui.screen === this) this.layout();
  }
  rows() { return Math.max(2, Math.floor((this.game.ui.h - 40 - 64) / 26)); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, W = (this.data && this.data.worlds) || [], n = this.rows();
    this.widgets = [];
    W.slice(0, n).forEach((w, i) => {
      const y = 36 + i * 26, l = this.local.get(w.wid), newer = !l || !l.cloud || l.cloud.rev < w.rev;
      this.widgets.push(
        { x: cx + 62, y, w: 48, h: 20, label: l ? (newer ? '更新' : '已同步') : '下载', enabled: newer, tip: [l ? '用云端的版本替换这台设备上的' : '下载到这台设备'], onClick: () => this.down(w) },
        { x: cx + 112, y, w: 48, h: 20, label: this.confirm === w.wid ? '确定？' : '删除', tip: ['只删云端的这一份，这台设备上的不动'], onClick: () => this.del(w) },
      );
    });
    this.widgets.push({ x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) });
  }
  async down(w) {
    const l = this.local.get(w.wid);
    const go = async () => {
      this.say('正在下载 ' + w.name + '…'); this.layout();
      try { await CloudSave.download(w.wid, (f) => this.say(`正在下载 ${w.name}… ${Math.round(f * 100)}%`)); this.say('已下载：' + w.name); await this.load(); }
      catch (e) { this.say(e.message, true); }
      this.game.ui.open(this);
    };
    if (l && CloudSave.dirtyCount(w.wid)) this.game.ui.open(new ConfirmScreen(this.game, '用云端的版本替换？', `这台设备上的“${l.name}”有还没上传的改动，替换后会丢失`, '替换', (yes) => (yes ? go() : this.game.ui.open(this))));
    else go();
  }
  async del(w) {
    if (this.confirm !== w.wid) { this.confirm = w.wid; this.layout(); return; }
    this.confirm = null;
    try { await CloudSave.remove(w.wid); this.say('已从云端删除：' + w.name); await this.load(); } catch (e) { this.say(e.message, true); }
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, D = this.data;
    if (!D) { Font.center(c, '正在读取…', cx, 50, '#A0A0A0'); return; }
    const usedMB = (D.used / 1048576).toFixed(1), quotaMB = (D.quota / 1048576).toFixed(0);
    const remainGB = ((D.remaining || 0) / 1073741824).toFixed(1);
    Font.center(c, `本账号已用 ${usedMB} / ${quotaMB} MB（单账号上限 50 MB，服务器空间有限）`, cx, 18, '#A0A0A0');
    Font.center(c, `服务器总容量 5 GB，剩余约 ${remainGB} GB　·　存档 ${D.expireDays} 天未更新会自动删除（设备上的不受影响）`, cx, 30, '#808080');
    if (!D.worlds.length) Font.center(c, '云端还没有存档：登录后玩单人世界，退出时会自动上传', cx, 60, '#A0A0A0');
    D.worlds.slice(0, this.rows()).forEach((w, i) => {
      const y = 36 + i * 26;
      const exp = Number(w.expires); // (后端没给就用上传时间 + 过期天数自己算，别显示 NaN)
      const base = Number.isFinite(exp) && exp > 0 ? exp : (Number(w.updated) || Date.now()) + (D.expireDays || 7) * 86400e3;
      const days = Math.max(0, Math.ceil((base - Date.now()) / 86400e3));
      const pm = fmtPlayMs(w.playMs);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 160, y, 220, 20);
      Font.draw(c, fitText(w.name, 150), cx - 157, y + 2, '#FFFFFF');
      const sub = `${(w.size / 1048576).toFixed(1)} MB · ${new Date(w.updated).toLocaleDateString()}${pm ? ' · ' + pm : ''} · ${w.device || ''}`;
      Font.draw(c, fitText(sub, 214), cx - 157, y + 11, '#909090');
      Font.draw(c, `${days}天`, cx + 34, y + 2, days <= 2 ? '#FF8080' : '#80FF80');
    });
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, ui.h - 40, this.noteColor);
  }
  onEsc() { this.game.ui.open(this.parent); }
}
// a world changed here and on another device: which copy stays
class CloudConflictScreen extends MenuScreen {
  constructor(game, meta, cloud, then) { super(game, '存档在两台设备上都改过'); this.meta = meta; this.cloud = cloud; this.then = then; this.pauses = false; this.busy = false; this.note = ''; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 2);
    this.widgets = [
      { x: cx - 152, y, w: 148, h: 20, label: '用云端的', enabled: !this.busy, tip: ['这台设备上没上传的改动会丢失'], onClick: () => this.pick(true) },
      { x: cx + 4, y, w: 148, h: 20, label: '用这台设备的', enabled: !this.busy, tip: ['云端的那份会被这台设备上的替换'], onClick: () => this.pick(false) },
      { x: cx - 100, y: y + 30, w: 200, h: 20, label: '先不管（只玩这台设备上的）', enabled: !this.busy, onClick: () => this.then(false) },
    ];
  }
  async pick(cloud) {
    this.busy = true; this.note = cloud ? '正在下载云端的版本…' : '正在上传这台设备上的版本…'; this.layout();
    try { if (cloud) await CloudSave.download(this.meta.id); else { const r = await CloudSave.sync(this.meta, { force: true }); if (r.full) throw new Error('云存档空间不够了'); } this.then(true); }
    catch (e) { this.busy = false; this.note = e.message; this.layout(); }
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, y = Math.floor(ui.h / 2) - 44, cl = this.cloud || {};
    Font.center(c, `“${this.meta.name}”`, cx, y, '#FFFFFF');
    Font.center(c, fitText(`云端：${cl.updated ? new Date(cl.updated).toLocaleString() : '?'}，来自 ${cl.device || '另一台设备'}`, ui.w - 8), cx, y + 14, '#A0A0A0');
    Font.center(c, fitText(`这台设备：${new Date(this.meta.lastPlayed).toLocaleString()}`, ui.w - 8), cx, y + 26, '#A0A0A0');
    if (this.note) Font.center(c, this.note, cx, y + 92, '#FFD24A');
  }
  onEsc() { }
}
// opening a world: the cloud may have a newer copy of it (another device played since)
(() => {
  const load = Game.prototype.loadWorld;
  Game.prototype.loadWorld = async function (id, ...rest) {
    if (Account.loggedIn && !Account.isLocal && !this.cloudChecked) {
      try {
        const meta = await DB.getWorld(id), list = await CloudSave.list(), cw = list.worlds.find((w) => w.wid === id);
        if (meta && cw && (!meta.cloud || cw.rev > meta.cloud.rev)) {
          const g = this;
          if (!meta.cloud || CloudSave.dirtyCount(id)) {
            return g.ui.open(new CloudConflictScreen(g, meta, cw, () => { g.cloudChecked = true; g.loadWorld(id, ...rest); }));
          }
          g.ui.open(new LoadingScreen(g, '正在下载云端的新版本…'));
          await CloudSave.download(id);
        }
        CloudSave.touch(id);
      } catch (e) { /* (offline: play what is here) */ }
    }
    this.cloudChecked = false;
    return load.call(this, id, ...rest);
  };
})();

// the world list: each world's cloud state, and the cloud screen
(() => {
  const lay = WorldListScreen.prototype.layout;
  WorldListScreen.prototype.layout = function () {
    lay.call(this);
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    if (Account.loggedIn) this.widgets.push({ x: cx + 104, y: 22, w: 56, h: 20, label: '云端…', tip: ['云端存档：换设备也能接着玩'], onClick: () => { g.ui.hideInput(); g.ui.open(new CloudScreen(g, this)); } });
  };
  const de = WorldListScreen.prototype.drawExtra;
  WorldListScreen.prototype.drawExtra = function (ui) {
    de.call(this, ui);
    if (!Account.loggedIn || !this.worlds) return;
    const c = ui.ctx, cx = ui.w / 2, rowH = 36, x0 = Math.floor(cx - this.rowW / 2) + 2, top = this.listTop, bottom = this.listBottom;
    const list = this.shown(), vis = Math.floor((bottom - top - 4) / rowH);
    c.save(); c.beginPath(); c.rect(0, top, ui.w, bottom - top); c.clip();
    list.slice(this.scroll, this.scroll + vis + 1).forEach((w, i) => {
      const y = top + 4 + i * rowH, cl = w.cloud, n = CloudSave.dirtyCount(w.id);
      const t = !cl ? '☁ 未上传' : n ? '☁ 有改动' : '☁ 已同步', col = !cl ? '#808080' : n ? '#FFD24A' : '#80C0FF';
      Font.draw(c, t, x0 + this.rowW - 8 - Font.width(t), y + 1, col);
      if (cl && cl.expires) { const d = Math.max(0, Math.ceil((cl.expires - Date.now()) / 86400e3)); const tt = `云端保留 ${d} 天`; Font.draw(c, tt, x0 + this.rowW - 8 - Font.width(tt), y + 12, d <= 2 ? '#FF8080' : '#707070'); }
    });
    c.restore();
  };
  // the title: a cloud world about to be deleted (2 days or less)
  const st = Game.prototype.startTitle;
  Game.prototype.startTitle = function (...a) {
    const r = st.apply(this, a);
    if (Account.loggedIn && !Account.isLocal && !this.cloudWarned) {
      this.cloudWarned = true;
      CloudSave.list().then((l) => {
        const soon = l.worlds.filter((w) => w.expires - Date.now() < 2 * 86400e3);
        if (soon.length) this.titleNote = { text: `云端存档“${soon[0].name}”${soon.length > 1 ? ` 等 ${soon.length} 个` : ''}快要过期了：打开玩一下就会重新保留 ${l.expireDays} 天`, color: '#FFD24A' };
      }).catch(() => { });
    }
    return r;
  };
  const tde = TitleScreen.prototype.drawExtra;
  TitleScreen.prototype.drawExtra = function (ui) {
    tde.call(this, ui);
    const n = this.game.titleNote;
    if (n) Font.center(ui.ctx, fitText(n.text, ui.w - 8), ui.w / 2, ui.h - 22, n.color);
    else if (!Account.loggedIn) Font.center(ui.ctx, fitText('登录后可以联机、云存档、换皮肤和披风', ui.w - 8), ui.w / 2, ui.h - 22, '#A0A0A0');
  };
})();
