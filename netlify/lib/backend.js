'use strict';
// ---------------------------------------------------------------------------
// OpusMC Netlify Functions backend
// A file-backed (Netlify Blobs) implementation of the PHP API used by the
// static game. Paths and response shapes intentionally match api/*.php so the
// existing front end needs no endpoint changes.
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const ADMIN_NAMES = ['xpz'];
const DEFAULT_OWNED = [
  'hat:straw', 'hat:tophat', 'hat:crown',
  'pet:snowman', 'pre:potato',
  'cape:penguin', 'cape:penguinwalk', 'cape:goldapple',
];
const CLOUD_QUOTA = 50 * 1024 * 1024;
const CLOUD_TOTAL = 5 * 1024 * 1024 * 1024;
const CLOUD_EXPIRE_DAYS = 5;
const P2P_TIMEOUT = 30;
const MAX_CHUNK = 5 * 1024 * 1024;
const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
  relayOnly: false,
};

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const md5 = (s) => crypto.createHash('md5').update(String(s)).digest('hex');
const randToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const isAdminName = (name) => ADMIN_NAMES.includes(String(name || '').toLowerCase());
const validName = (s) => typeof s === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(s);
const safeId = (s) => typeof s === 'string' && /^[A-Za-z0-9_\-:]{1,64}$/.test(s);
const safeWid = (s) => typeof s === 'string' && /^[A-Za-z0-9_\-]{1,64}$/.test(s);
const normCode = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const nowMs = () => Date.now();
const nowSec = () => Math.floor(nowMs() / 1000);
const dayCN = (offset = 0) => {
  const d = new Date(nowMs() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(d);
};
const unicodeSlice = (s, n) => Array.from(String(s || '')).slice(0, n).join('');
const asObj = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
};

function identityCode() {
  const set = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let raw = '';
  for (let i = 0; i < 16; i++) raw += set[crypto.randomInt(0, set.length)];
  return raw.match(/.{1,4}/g).join('-');
}
function newUid(name) {
  return 'u' + md5(name + String(nowMs()) + Math.random()).slice(0, 16);
}
function scryptHash(pass, salt) {
  return crypto.scryptSync(String(pass), String(salt), 64).toString('hex');
}
function passwordOK(pass, user) {
  if (!user || !user.pass_hash || !user.pass_salt) return false;
  try {
    const got = Buffer.from(scryptHash(pass, user.pass_salt), 'hex');
    const want = Buffer.from(String(user.pass_hash), 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}
function makeUser(name) {
  return {
    id: newUid(name),
    name,
    nick: name,
    super: isAdminName(name),
    created: nowMs(),
    unlocks: { follow: true, triple: true },
    owned: DEFAULT_OWNED.slice(),
    skin: {},
    settings: {},
    tempNick: '',
    nameColor: '',
    code: identityCode(),
  };
}
function publicAccount(u) {
  return {
    id: u.id,
    name: u.name,
    nick: u.nick || u.name,
    super: isAdminName(u.name),
    unlocks: u.unlocks || { follow: true, triple: true },
    owned: u.owned || [],
    skin: asObj(u.skin),
    settings: asObj(u.settings),
    tempNick: String(u.tempNick || ''),
    nameColor: String(u.nameColor || ''),
    created: u.created || 0,
  };
}
function statusText(s) {
  return ({ new: '未处理', doing: '处理中', done: '已处理', replied: '已回复' })[s] || '未处理';
}

function omccHead(buf) {
  if (!buf || buf.length < 8) return null;
  const magic = buf.subarray(0, 4).toString('ascii');
  if (magic !== 'OMCC' && magic !== 'OMCX') return null;
  const hl = buf.readUInt32BE(4);
  if (hl <= 0 || 8 + hl > buf.length) return null;
  try { return JSON.parse(buf.subarray(8, 8 + hl).toString('utf8')); } catch (e) { return null; }
}

function createApi({ store, fetchImpl = fetch }) {
  const headersFor = (origin) => {
    const h = {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'Content-Type, _t',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    h['Access-Control-Allow-Origin'] = origin || '*';
    return h;
  };
  const jsonReply = (status, data, origin) => ({
    statusCode: status,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headersFor(origin)),
    body: JSON.stringify(data),
  });
  const binReply = (status, buf, contentType, origin, extra) => ({
    statusCode: status,
    headers: Object.assign({
      'Content-Type': contentType || 'application/octet-stream',
      'Content-Length': String(buf.length),
    }, headersFor(origin), extra || {}),
    body: Buffer.from(buf).toString('base64'),
    isBase64Encoded: true,
  });
  const err = (origin, msg, status = 400, extra) => jsonReply(status, Object.assign({ error: msg }, extra || {}), origin);

  async function getJSON(key, def = null) {
    try {
      const v = await store.get(key, { type: 'json' });
      return v == null ? def : v;
    } catch (e) { return def; }
  }
  async function putJSON(key, value) {
    await store.setJSON(key, value);
    return true;
  }
  async function getBuf(key) {
    try {
      const v = await store.get(key, { type: 'arrayBuffer' });
      if (v == null) return null;
      return Buffer.from(v);
    } catch (e) { return null; }
  }
  async function putBuf(key, buf) {
    await store.set(key, buf);
    return true;
  }
  async function listKeys(prefix) {
    try {
      const r = await store.list({ prefix });
      return r && Array.isArray(r.blobs) ? r.blobs : [];
    } catch (e) {
      return [];
    }
  }
  async function del(key) {
    try { await store.delete(key); } catch (e) { }
  }

  async function findUserByName(name) {
    const key = 'index/name/' + String(name || '').toLowerCase();
    const uid = await getJSON(key, null);
    if (uid) {
      const u = await getJSON('users/' + uid + '.json', null);
      if (u && String(u.name || '').toLowerCase() === String(name || '').toLowerCase()) return u;
    }
    const blobs = await listKeys('users/');
    for (const b of blobs) {
      if (!String(b.key).endsWith('.json')) continue;
      const u = await getJSON(b.key, null);
      if (u && String(u.name || '').toLowerCase() === String(name || '').toLowerCase()) {
        await putJSON(key, u.id);
        return u;
      }
    }
    return null;
  }
  async function findUserByCode(code) {
    const c = normCode(code);
    if (c.length !== 16) return null;
    const key = 'index/code/' + c;
    const uid = await getJSON(key, null);
    if (uid) {
      const u = await getJSON('users/' + uid + '.json', null);
      if (u && normCode(u.code) === c) return u;
    }
    const blobs = await listKeys('users/');
    for (const b of blobs) {
      if (!String(b.key).endsWith('.json')) continue;
      const u = await getJSON(b.key, null);
      if (u && normCode(u.code) === c) {
        await putJSON(key, u.id);
        return u;
      }
    }
    return null;
  }
  async function saveUser(u) {
    await putJSON('users/' + u.id + '.json', u);
    await putJSON('index/name/' + String(u.name).toLowerCase(), u.id);
    if (u.code) await putJSON('index/code/' + normCode(u.code), u.id);
    return u;
  }
  async function createSession(uid) {
    const token = randToken(32);
    await putJSON('sessions/' + sha(token) + '.json', { uid, at: nowSec() });
    return token;
  }
  async function currentUser(ctx) {
    const token = String(ctx.in._t || '');
    if (!token) return null;
    const sess = await getJSON('sessions/' + sha(token) + '.json', null);
    if (!sess || !sess.uid) return null;
    const u = await getJSON('users/' + sess.uid + '.json', null);
    if (!u) return null;
    u._token = token;
    return u;
  }
  async function requireUser(ctx) {
    const u = await currentUser(ctx);
    if (!u) return { error: err(ctx.origin, '未登录或登录已过期', 401, { gate: true }) };
    return { user: u };
  }

  async function cloudUsed(uid) {
    const blobs = await listKeys('cloud/' + uid + '/');
    let total = 0;
    for (const b of blobs) {
      if (!String(b.key).endsWith('.omcc')) continue;
      if (typeof b.size === 'number') total += b.size;
      else {
        const buf = await getBuf(b.key);
        total += buf ? buf.length : 0;
      }
    }
    return total;
  }
  async function cloudCleanup(uid) {
    const blobs = await listKeys('cloud/' + uid + '/');
    for (const b of blobs) {
      if (!String(b.key).endsWith('.json')) continue;
      const m = await getJSON(b.key, null);
      if (!m || !m.at) continue;
      if (nowMs() - Number(m.at) > CLOUD_EXPIRE_DAYS * 86400000) {
        const wid = String(m.wid || b.key.split('/').pop().replace(/\.json$/, ''));
        if (safeWid(wid)) {
          await del('cloud/' + uid + '/' + wid + '.omcc');
          await del('cloud/' + uid + '/' + wid + '.json');
        }
      }
    }
  }
  async function pushCloudBuffer(uid, buf) {
    const head = omccHead(buf);
    if (!head || !head.wid) return { error: '存档包格式不对' };
    const wid = String(head.wid);
    if (!safeWid(wid)) return { error: '存档编号不对' };
    const oldKey = 'cloud/' + uid + '/' + wid + '.omcc';
    const old = await getBuf(oldKey);
    const oldSize = old ? old.length : 0;
    const used = await cloudUsed(uid);
    const nextUsed = used - oldSize + buf.length;
    if (nextUsed > CLOUD_QUOTA) {
      return {
        error: '云存档空间已满：单账号最多 ' + Math.round(CLOUD_QUOTA / 1048576) + ' MB，请先删除不要的云端存档',
        status: 409,
        extra: { full: true, used, quota: CLOUD_QUOTA },
      };
    }
    await putBuf(oldKey, buf);
    const meta = head.meta && typeof head.meta === 'object' ? head.meta : {};
    const stamp = nowMs();
    await putJSON('cloud/' + uid + '/' + wid + '.json', {
      wid,
      meta,
      size: buf.length,
      at: stamp,
      rev: Math.floor(stamp / 1000),
    });
    return {
      ok: true,
      rev: Math.floor(stamp / 1000),
      size: buf.length,
      used: nextUsed,
      quota: CLOUD_QUOTA,
      expires: stamp + CLOUD_EXPIRE_DAYS * 86400000,
    };
  }

  async function handleCloud(ctx) {
    const auth = await requireUser(ctx);
    if (auth.error) return auth.error;
    const u = auth.user;
    const uid = u.id;
    const action = String(ctx.action || 'list');

    if (action === 'list') {
      await cloudCleanup(uid);
      const blobs = await listKeys('cloud/' + uid + '/');
      const worlds = [];
      for (const b of blobs) {
        if (!String(b.key).endsWith('.json')) continue;
        const m = await getJSON(b.key, null);
        if (!m) continue;
        const meta = m.meta && typeof m.meta === 'object' ? m.meta : {};
        m.name = meta.name != null ? meta.name : (m.name != null ? m.name : m.wid);
        m.device = meta.device != null ? meta.device : (m.device != null ? m.device : '');
        m.updated = m.at != null ? m.at : (meta.lastPlayed || 0);
        m.playMs = meta.playMs != null ? Number(meta.playMs) : (m.playMs != null ? Number(m.playMs) : 0);
        m.expires = (Number(m.at) || 0) + CLOUD_EXPIRE_DAYS * 86400000;
        worlds.push(m);
      }
      worlds.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
      const used = await cloudUsed(uid);
      return jsonReply(200, {
        worlds, used, quota: CLOUD_QUOTA, expireDays: CLOUD_EXPIRE_DAYS,
        total: CLOUD_TOTAL, remaining: Math.max(0, CLOUD_TOTAL - used),
      }, ctx.origin);
    }

    if (action === 'push') {
      const upload = String(ctx.in.upload || '');
      const total = Number(ctx.in.total || 0);
      const index = Number(ctx.in.index || 0);
      let buf = ctx.bodyBuf;
      if (upload) {
        if (!safeId(upload) || upload.length < 16) return err(ctx.origin, '上传编号不对');
        if (!Number.isInteger(total) || total < 1 || total > 40) return err(ctx.origin, '分片总数不对');
        if (!Number.isInteger(index) || index < 0 || index >= total) return err(ctx.origin, '分片编号不对');
        if (!buf || buf.length > MAX_CHUNK) return err(ctx.origin, '分片太大');
        const key = 'cloud-chunks/' + uid + '/' + upload + '/' + String(index).padStart(4, '0');
        await putBuf(key, buf);
        if (index < total - 1) return jsonReply(200, { ok: true, chunk: index, total }, ctx.origin);
        const parts = await listKeys('cloud-chunks/' + uid + '/' + upload + '/');
        const sorted = parts.filter((b) => /\.chunk|$/.test(b.key)).sort((a, b) => String(a.key).localeCompare(String(b.key)));
        const bufs = [];
        for (const p of sorted) {
          const piece = await getBuf(p.key);
          if (piece) bufs.push(piece);
        }
        if (bufs.length !== total) {
          for (const p of parts) await del(p.key);
          return err(ctx.origin, '分片不完整，请重试');
        }
        buf = Buffer.concat(bufs);
        for (const p of parts) await del(p.key);
      }
      if (!buf || !buf.length) return err(ctx.origin, '存档包为空');
      if (buf.length > CLOUD_QUOTA) return err(ctx.origin, '存档包超过单账号配额');
      const r = await pushCloudBuffer(uid, buf);
      if (r.error) return err(ctx.origin, r.error, r.status || 400, r.extra);
      return jsonReply(200, r, ctx.origin);
    }

    if (action === 'download') {
      const wid = String(ctx.in.wid || '');
      if (!safeWid(wid)) return err(ctx.origin, '存档编号不对');
      const buf = await getBuf('cloud/' + uid + '/' + wid + '.omcc');
      if (!buf) return err(ctx.origin, '云端没有这个存档', 404);
      return binReply(200, buf, 'application/octet-stream', ctx.origin, {
        'Content-Disposition': 'attachment; filename="' + wid + '.omcc"',
      });
    }

    if (action === 'delete') {
      const wid = String(ctx.in.wid || '');
      if (!safeWid(wid)) return err(ctx.origin, '存档编号不对');
      await del('cloud/' + uid + '/' + wid + '.omcc');
      await del('cloud/' + uid + '/' + wid + '.json');
      return jsonReply(200, { ok: true }, ctx.origin);
    }

    return err(ctx.origin, '未知操作', 404);
  }

  async function handleAccount(ctx) {
    const action = String(ctx.action || 'me');
    if (action === 'register') {
      const name = String(ctx.in.name || '').trim();
      const pass = String(ctx.in.pass || '');
      if (!validName(name)) return err(ctx.origin, '用户名需为 3–16 位字母、数字或下划线');
      if (pass.length < 4 || pass.length > 32) return err(ctx.origin, '密码需为 4–32 位');
      if (await findUserByName(name)) return err(ctx.origin, '这个名字已经被注册了');
      const u = makeUser(name);
      u.pass_salt = crypto.randomBytes(16).toString('hex');
      u.pass_hash = scryptHash(pass, u.pass_salt);
      await saveUser(u);
      const token = await createSession(u.id);
      return jsonReply(200, { token, account: publicAccount(u) }, ctx.origin);
    }
    if (action === 'login') {
      const code = normCode(ctx.in.code || '');
      let u;
      if (code) {
        if (code.length !== 16) return err(ctx.origin, '识别码是 16 位，四组四位', 401);
        u = await findUserByCode(code);
        if (!u) return err(ctx.origin, '识别码不对，或者已经被重设', 401);
      } else {
        const name = String(ctx.in.name || '').trim();
        const pass = String(ctx.in.pass || '');
        u = await findUserByName(name);
        if (!u || !passwordOK(pass, u)) return err(ctx.origin, '用户名或密码不对', 401);
      }
      const token = await createSession(u.id);
      return jsonReply(200, { token, account: publicAccount(u) }, ctx.origin);
    }
    if (action === 'code') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      const u = auth.user;
      const reset = !!ctx.in.reset;
      if (!u.code || reset) {
        let c = identityCode();
        while (await findUserByCode(c)) c = identityCode();
        u.code = c;
        await saveUser(u);
      }
      return jsonReply(200, { ok: true, code: u.code }, ctx.origin);
    }
    if (action === 'me') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      return jsonReply(200, { token: auth.user._token, account: publicAccount(auth.user) }, ctx.origin);
    }
    if (action === 'update') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      const u = auth.user;
      const fields = ctx.in.fields && typeof ctx.in.fields === 'object' ? ctx.in.fields : ctx.in;
      const allow = ['skin', 'settings', 'owned', 'nick', 'pre', 'tempNick', 'nameColor'];
      for (const k of allow) {
        if (!(k in fields)) continue;
        let v = fields[k];
        if (k === 'skin' || k === 'settings') {
          if (!v || typeof v !== 'object' || Array.isArray(v)) v = {};
        }
        u[k] = v;
      }
      delete u._token;
      await saveUser(u);
      return jsonReply(200, { account: publicAccount(u) }, ctx.origin);
    }
    if (action === 'logout') {
      const token = String(ctx.in._t || '');
      if (token) await del('sessions/' + sha(token) + '.json');
      return jsonReply(200, { ok: true }, ctx.origin);
    }
    return err(ctx.origin, '未知操作', 404);
  }

  async function handleCheckin(ctx) {
    const auth = await requireUser(ctx);
    if (auth.error) return auth.error;
    const u = auth.user;
    const file = 'checkin/' + u.id + '.json';
    const rewards = ['hat:straw', 'hat:tophat', 'hat:crown', 'pet:snowman', 'pre:potato', 'cape:penguin', 'cape:goldapple'];
    const today = dayCN(0);
    const yesterday = dayCN(-1);
    let st = await getJSON(file, { days: 0, lastDay: '', today: false });
    st.today = (st.lastDay || '') === today;
    const action = String(ctx.action || 'status');
    const payload = (state) => ({
      now: nowMs(),
      event: { rewards, days: rewards.length },
      days: Number(state.days || 0),
      today: !!state.today,
    });
    if (action === 'claim') {
      if (!st.today) {
        st.days = (st.lastDay || '') === yesterday ? Number(st.days || 0) + 1 : 1;
        st.lastDay = today;
        st.today = true;
        await putJSON(file, st);
      }
      const idx = Math.max(0, Math.min(rewards.length - 1, Number(st.days || 1) - 1));
      const out = payload(st);
      out.reward = rewards[idx];
      out.account = publicAccount(u);
      return jsonReply(200, out, ctx.origin);
    }
    return jsonReply(200, payload(st), ctx.origin);
  }

  async function handleAnnounce(ctx) {
    const action = String(ctx.action || 'list');
    const file = 'announce/list.json';
    if (action === 'publish') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      if (!isAdminName(auth.user.name)) return err(ctx.origin, '没有管理员权限', 403);
      let text = String(ctx.in.text || '').trim().replace(/[\u0000-\u001F]/g, '');
      text = unicodeSlice(text, 100);
      if (!text) return err(ctx.origin, '公告内容不能为空');
      let list = await getJSON(file, []);
      if (!Array.isArray(list)) list = [];
      list.push({ id: nowMs(), at: nowMs(), text, by: auth.user.name });
      if (list.length > 50) list = list.slice(-50);
      await putJSON(file, list);
      return jsonReply(200, { ok: true }, ctx.origin);
    }
    const after = Number(ctx.in.after || 0);
    let list = await getJSON(file, []);
    if (!Array.isArray(list)) list = [];
    return jsonReply(200, { list: list.filter((a) => a && Number(a.at || 0) > after) }, ctx.origin);
  }

  async function handleNews(ctx) {
    const file = 'news/list.json';
    const action = String(ctx.action || 'list');
    async function load() {
      let l = await getJSON(file, null);
      if (l && !Array.isArray(l) && Array.isArray(l.list)) l = l.list;
      return Array.isArray(l) ? l.filter((x) => x && x.title != null) : [];
    }
    const clean = (t, n) => unicodeSlice(String(t || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''), n);
    const outList = (list, admin) => list.filter((it) => admin || !it.draft).map((it) => {
      const o = Object.assign({}, it);
      o.body = o.body && o.body !== '' ? o.body : (o.text || '');
      o.text = o.body;
      return o;
    });
    if (action === 'save') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      if (!isAdminName(auth.user.name)) return err(ctx.origin, '没有管理员权限', 403);
      const list = await load();
      const title = clean(ctx.in.title, 60);
      const body = clean(ctx.in.body != null ? ctx.in.body : ctx.in.text, 4000);
      if (!title) return err(ctx.origin, '公告标题不能为空');
      if (!body) return err(ctx.origin, '公告内容不能为空');
      let id = ctx.in.id != null ? String(ctx.in.id) : '';
      let found = -1;
      for (let i = 0; i < list.length; i++) if (String(list[i].id || '') === id) { found = i; break; }
      if (found < 0) {
        id = String(nowMs() + crypto.randomInt(0, 1000));
        list.push({ id, at: nowMs(), by: auth.user.name, date: dayCN(0) });
        found = list.length - 1;
      }
      list[found].id = id;
      list[found].title = title;
      list[found].body = body;
      list[found].text = body;
      list[found].pin = !!ctx.in.pin;
      list[found].imp = !!ctx.in.imp;
      list[found].gift = ctx.in.gift && typeof ctx.in.gift === 'object' ? ctx.in.gift : null;
      list[found].draft = ctx.in.publish === false ? true : false;
      if (!list[found].draft) list[found].at = nowMs();
      await putJSON(file, list);
      return jsonReply(200, { ok: true, id, list: outList(list, true) }, ctx.origin);
    }
    if (action === 'delete') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      if (!isAdminName(auth.user.name)) return err(ctx.origin, '没有管理员权限', 403);
      const id = String(ctx.in.id || '');
      if (!id) return err(ctx.origin, '缺少公告 id');
      const list = (await load()).filter((it) => String(it.id || '') !== id);
      await putJSON(file, list);
      return jsonReply(200, { ok: true, list: outList(list, true) }, ctx.origin);
    }
    if (action === 'admin') {
      const auth = await requireUser(ctx);
      if (auth.error) return auth.error;
      if (!isAdminName(auth.user.name)) return err(ctx.origin, '没有管理员权限', 403);
      return jsonReply(200, { list: outList(await load(), true) }, ctx.origin);
    }
    let list = outList(await load(), false);
    if (!list.length) {
      const t = '这是 OpusMC 的二创离线部署：皮肤、披风、帽子、宠物、前缀已全部解锁，衣柜可导入本地皮肤 PNG；联机为房主直连，存档存在本浏览器与站点云存档。';
      list = [{ id: 'welcome', title: '本地自托管版', text: t, body: t, gift: null, draft: false, at: 0, by: '站点', date: '' }];
    }
    return jsonReply(200, { list }, ctx.origin);
  }

  async function feedbackAll() {
    const blobs = await listKeys('feedback/');
    const items = [];
    for (const b of blobs) {
      if (!String(b.key).endsWith('.json')) continue;
      const e = await getJSON(b.key, null);
      if (e && e.id) items.push(e);
    }
    items.sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
    return items;
  }
  async function feedbackLoad(id) {
    if (!safeId(id)) return null;
    return getJSON('feedback/' + id + '.json', null);
  }

  async function handleFeedback(ctx) {
    const action = String(ctx.in.action || '');
    const u = await currentUser(ctx);
    if (action === 'mine') {
      let dev = String(ctx.in.dev || '').trim();
      if (dev && !/^[A-Za-z0-9_\-]{6,64}$/.test(dev)) dev = '';
      if (!u && !dev) return err(ctx.origin, '未登录或登录已过期', 401, { gate: true });
      const out = [];
      for (const e of await feedbackAll()) {
        let mine = false;
        if (u && e.uid && e.uid === u.id) mine = true;
        if (!mine && u && !e.uid && e.name && String(e.name).toLowerCase() === String(u.name).toLowerCase()) mine = true;
        if (!mine && dev && e.dev && e.dev === dev) mine = true;
        if (!mine) continue;
        const copy = Object.assign({}, e);
        const has = !!copy.shot;
        delete copy.shot; delete copy.ctx; delete copy.dev;
        copy.hasShot = has;
        copy.statusText = statusText(copy.status);
        out.push(copy);
        if (out.length >= 30) break;
      }
      return jsonReply(200, { ok: true, items: out }, ctx.origin);
    }
    if (action === 'list') {
      if (!u || !isAdminName(u.name)) return err(ctx.origin, '没有管理员权限', 403);
      const want = String(ctx.in.status || '');
      const items = [];
      for (const e of await feedbackAll()) {
        const st = e.status || 'new';
        if (want && st !== want) continue;
        const copy = Object.assign({}, e);
        const has = !!copy.shot;
        delete copy.shot;
        if (copy.ctx && typeof copy.ctx === 'object') delete copy.ctx.perf;
        copy.hasShot = has;
        copy.statusText = statusText(st);
        copy.text = unicodeSlice(copy.text, 500);
        items.push(copy);
      }
      const total = items.length;
      const off = Math.max(0, Number(ctx.in.offset || 0));
      const lim = Math.min(100, Math.max(1, Number(ctx.in.limit || 50)));
      return jsonReply(200, { ok: true, total, offset: off, items: items.slice(off, off + lim) }, ctx.origin);
    }
    if (action === 'get') {
      if (!u || !isAdminName(u.name)) return err(ctx.origin, '没有管理员权限', 403);
      const e = await feedbackLoad(String(ctx.in.id || ''));
      if (!e) return err(ctx.origin, '没有这条反馈', 404);
      e.statusText = statusText(e.status);
      return jsonReply(200, { ok: true, item: e }, ctx.origin);
    }
    if (action === 'mark') {
      if (!u || !isAdminName(u.name)) return err(ctx.origin, '没有管理员权限', 403);
      const st = String(ctx.in.status || 'done');
      if (!['new', 'doing', 'done'].includes(st)) return err(ctx.origin, '状态不对');
      const e = await feedbackLoad(String(ctx.in.id || ''));
      if (!e) return err(ctx.origin, '没有这条反馈', 404);
      e.status = st;
      e.statusAt = nowMs();
      e.statusBy = u.name;
      await putJSON('feedback/' + e.id + '.json', e);
      return jsonReply(200, { ok: true, status: st, statusText: statusText(st) }, ctx.origin);
    }
    if (action === 'reply') {
      if (!u || !isAdminName(u.name)) return err(ctx.origin, '没有管理员权限', 403);
      const reply = unicodeSlice(String(ctx.in.reply || '').trim(), 300);
      if (!reply) return err(ctx.origin, '回复内容不能为空');
      const e = await feedbackLoad(String(ctx.in.id || ''));
      if (!e) return err(ctx.origin, '没有这条反馈', 404);
      e.reply = reply;
      e.repliedAt = nowMs();
      e.repliedBy = u.name;
      e.status = 'replied';
      await putJSON('feedback/' + e.id + '.json', e);
      return jsonReply(200, { ok: true }, ctx.origin);
    }
    let kind = String(ctx.in.kind || 'other');
    if (!['bug', 'lag', 'idea', 'other'].includes(kind)) kind = 'other';
    let text = unicodeSlice(String(ctx.in.text || '').trim(), 500);
    if (!text) return err(ctx.origin, '反馈内容不能为空');
    let shot = typeof ctx.in.shot === 'string' ? ctx.in.shot : null;
    if (shot && shot.length > 1200000) shot = null;
    const ctxObj = ctx.in.ctx && typeof ctx.in.ctx === 'object' ? ctx.in.ctx : {};
    let dev = '';
    if (typeof ctxObj.id === 'string' && /^[A-Za-z0-9_\-]{6,64}$/.test(ctxObj.id)) dev = ctxObj.id;
    const entry = {
      id: 'fb' + md5(String(nowMs()) + Math.random()).slice(0, 12),
      at: nowMs(), kind,
      name: u ? String(u.name || '') : '',
      uid: u ? String(u.id || '') : '',
      dev, text, shot, ctx: ctxObj, status: 'new',
    };
    await putJSON('feedback/' + entry.id + '.json', entry);
    return jsonReply(200, { ok: true, id: entry.id }, ctx.origin);
  }

  async function handleSkin(ctx) {
    const name = String(ctx.in.name || '').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) return err(ctx.origin, '玩家名格式不对');
    const key = 'skins/' + name.toLowerCase() + '.json';
    const cached = await getJSON(key, null);
    if (cached && cached.png && nowSec() - Number(cached.at || 0) < 86400) {
      return jsonReply(200, { png: cached.png, slim: !!cached.slim }, ctx.origin);
    }
    async function get(url, timeout = 10000) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const r = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'OpusMC-Netlify/1.0' } });
        return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
      } catch (e) { return { status: 0, buf: null, error: e.message }; }
      finally { clearTimeout(timer); }
    }
    const profile = await get('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name));
    if (profile.status !== 200 || !profile.buf) return err(ctx.origin, '没查到这个正版玩家（' + profile.status + '）', 404);
    let pj;
    try { pj = JSON.parse(profile.buf.toString('utf8')); } catch (e) { return err(ctx.origin, '没查到这个正版玩家', 404); }
    if (!pj || !pj.id) return err(ctx.origin, '没查到这个正版玩家', 404);
    const ses = await get('https://sessionserver.mojang.com/session/minecraft/profile/' + pj.id);
    if (ses.status !== 200 || !ses.buf) return err(ctx.origin, '取皮肤资料失败（' + ses.status + '）', 502);
    let sj; try { sj = JSON.parse(ses.buf.toString('utf8')); } catch (e) { sj = null; }
    let textures = null;
    if (sj && Array.isArray(sj.properties)) {
      for (const prop of sj.properties) {
        if (prop && prop.name === 'textures') {
          try {
            const dec = JSON.parse(Buffer.from(String(prop.value || ''), 'base64').toString('utf8'));
            if (dec && dec.textures && dec.textures.SKIN && dec.textures.SKIN.url) textures = dec.textures;
          } catch (e) { }
          break;
        }
      }
    }
    if (!textures) return err(ctx.origin, '这个玩家没有上传皮肤', 404);
    const img = await get(textures.SKIN.url, 12000);
    if (img.status !== 200 || !img.buf) return err(ctx.origin, '下载皮肤图片失败', 502);
    const png = img.buf.toString('base64');
    const slim = !!(textures.SKIN.metadata && textures.SKIN.metadata.model === 'slim');
    await putJSON(key, { png, slim, at: nowSec() });
    return jsonReply(200, { png, slim }, ctx.origin);
  }

  async function handleTelemetry(ctx) {
    if (ctx.method !== 'POST') return err(ctx.origin, '只接受 POST', 405);
    const raw = ctx.bodyBuf;
    if (!raw || !raw.length) return err(ctx.origin, '没有数据');
    if (raw.length > 150000) return err(ctx.origin, '数据太大', 413);
    let j; try { j = JSON.parse(raw.toString('utf8')); } catch (e) { return err(ctx.origin, '格式不对'); }
    if (!j || j.kind !== 'session') return err(ctx.origin, '格式不对');
    const id = String(j.id || '');
    if (!/^[A-Za-z0-9_\-]{6,64}$/.test(id)) return err(ctx.origin, '设备编号不对');
    const seq = Math.max(0, Number(j.seq || 0));
    const build = String(j.build || '').slice(0, 32);
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(nowMs())).replace(/-/g, '');
    const hash = sha(id).slice(0, 32);
    const key = 'telemetry/' + date + '/' + hash + '-' + nowMs() + '-' + crypto.randomInt(0, 9999) + '.json';
    const line = JSON.stringify({
      at: nowMs(), build, seq, final: !!j.final,
      dur: Math.max(0, Number(j.dur || 0)), play: Math.max(0, Number(j.play || 0)), data: j,
    });
    await store.set(key, line);
    return jsonReply(200, { ok: true }, ctx.origin);
  }

  function sanitizeName(s, fallback) {
    const name = unicodeSlice(String(s || fallback || '').replace(/[^\w\u4e00-\u9fff -]/g, ''), 16).trim();
    return name || fallback;
  }
  function sanitizeTitle(s, fallback) {
    const title = unicodeSlice(String(s || fallback || '').replace(/[^\w\u4e00-\u9fff ：:·_-]/g, ''), 32).trim();
    return title || fallback;
  }
  function roomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(0, chars.length)];
    return s;
  }
  async function roomLoad(code) {
    if (!safeId(code)) return null;
    const room = await getJSON('rooms/' + code + '.json', null);
    if (!room || !room.host || !Array.isArray(room.peers)) return null;
    return room;
  }
  async function roomSave(room) { await putJSON('rooms/' + room.code + '.json', room); }

  async function handleP2P(ctx) {
    const action = String(ctx.action || '');
    if (action === 'ping') return jsonReply(200, { ok: true, p2p: true, php: true }, ctx.origin);
    const auth = await requireUser(ctx);
    if (auth.error) return auth.error;
    const u = auth.user;
    const now = nowSec();
    if (action === 'host') {
      const name = sanitizeName(ctx.in.name, '房主');
      let code = String(ctx.in.code || '');
      if (!safeId(code) || code.length < 4 || code.length > 12 || (await roomLoad(code))) code = roomCode();
      const pid = randToken(12);
      const pub = !!ctx.in.public;
      const title = sanitizeTitle(ctx.in.title, name + ' 的世界');
      let max = Number(ctx.in.max || 4); max = Math.max(2, Math.min(10, max));
      const mode = String(ctx.in.mode || 'survival').replace(/[^a-z]/g, '') || 'survival';
      const difficulty = String(ctx.in.difficulty || 'normal').replace(/[^a-z]/g, '') || 'normal';
      const flat = !!ctx.in.flat;
      const room = {
        code, host: { id: pid, name, at: now, inbox: [] }, peers: [],
        created: now, public: pub, title, max, mode, difficulty, flat,
      };
      await roomSave(room);
      return jsonReply(200, { t: 'hosted', code, peerId: pid, ice: ICE }, ctx.origin);
    }
    if (action === 'join') {
      const code = String(ctx.in.code || '');
      const name = sanitizeName(ctx.in.name, '访客');
      const room = await roomLoad(code);
      if (!room) return err(ctx.origin, '房间不存在或已关闭', 404);
      if (!room.host || now - Number(room.host.at || 0) > P2P_TIMEOUT) return err(ctx.origin, '房主已离开，房间已关闭', 404);
      const limit = Math.max(2, Math.min(10, Number(room.max || 4)));
      if (room.peers.length >= limit - 1) return err(ctx.origin, '房间已满（最多 ' + limit + ' 人，含房主）', 403);
      const pid = randToken(12);
      room.peers.push({ id: pid, name, at: now, inbox: [] });
      room.host.inbox = room.host.inbox || [];
      room.host.inbox.push({ t: 'peer', id: pid, name });
      await roomSave(room);
      return jsonReply(200, { t: 'joined', host: room.host.name, peerId: pid, ice: ICE }, ctx.origin);
    }
    if (action === 'signal') {
      const code = String(ctx.in.code || '');
      const from = String(ctx.in.from || '');
      const to = String(ctx.in.to || 'host');
      const data = ctx.in.data != null ? ctx.in.data : null;
      const room = await roomLoad(code);
      if (!room) return err(ctx.origin, '房间不存在', 404);
      const known = (room.host.id === from) || room.peers.some((p) => p.id === from);
      if (!known) return err(ctx.origin, '不在这个房间里', 403);
      const msg = { t: 'signal', from, data };
      if (to === 'host') {
        room.host.inbox = room.host.inbox || [];
        room.host.inbox.push(msg);
      } else {
        const peer = room.peers.find((p) => p.id === to);
        if (peer) { peer.inbox = peer.inbox || []; peer.inbox.push(msg); }
      }
      await roomSave(room);
      return jsonReply(200, { ok: true }, ctx.origin);
    }
    if (action === 'poll') {
      const code = String(ctx.in.code || '');
      const pid = String(ctx.in.peerId || '');
      const room = await roomLoad(code);
      if (!room) return err(ctx.origin, '房间不存在', 404);
      const isHost = room.host.id === pid;
      let mine = isHost ? room.host : room.peers.find((p) => p.id === pid);
      if (!mine) return err(ctx.origin, '不在这个房间里', 404);
      mine.at = now;
      const gone = [];
      room.peers = room.peers.filter((p) => {
        if (now - Number(p.at || 0) > P2P_TIMEOUT) { gone.push(p.id); return false; }
        return true;
      });
      if (now - Number(room.host.at || 0) > P2P_TIMEOUT) {
        await del('rooms/' + code + '.json');
        return err(ctx.origin, '房主已离开，房间已关闭', 404);
      }
      for (const gid of gone) {
        room.host.inbox = room.host.inbox || [];
        room.host.inbox.push({ t: 'gone', id: gid });
      }
      const inbox = Array.isArray(mine.inbox) ? mine.inbox : [];
      mine.inbox = [];
      if (isHost) room.host = mine;
      await roomSave(room);
      return jsonReply(200, { messages: inbox }, ctx.origin);
    }
    if (action === 'public') {
      const rooms = [];
      const blobs = await listKeys('rooms/');
      for (const b of blobs) {
        if (!String(b.key).endsWith('.json')) continue;
        const room = await getJSON(b.key, null);
        if (!room || !room.public || !room.host) continue;
        if (now - Number(room.host.at || 0) > P2P_TIMEOUT) continue;
        const peers = Array.isArray(room.peers) ? room.peers.length : 0;
        const max = Math.max(2, Math.min(10, Number(room.max || 4)));
        rooms.push({
          code: String(room.code || ''),
          name: String(room.title || ((room.host.name || '房主') + ' 的世界')),
          owner: String(room.host.name || '房主'),
          players: 1 + peers, max,
          gamemode: String(room.mode || 'survival'),
          difficulty: String(room.difficulty || 'normal'),
          started: Number(room.created || 0) * 1000,
          state: 'running',
          flat: !!room.flat,
        });
      }
      rooms.sort((a, b) => b.started - a.started);
      return jsonReply(200, { rooms, capacity: { max: 10, sizes: { 2: 1, 4: 1, 6: 1, 8: 1, 10: 1 } } }, ctx.origin);
    }
    if (action === 'leave') {
      const code = String(ctx.in.code || '');
      const pid = String(ctx.in.peerId || '');
      const room = await roomLoad(code);
      if (room) {
        if (room.host.id === pid) await del('rooms/' + code + '.json');
        else {
          const peer = room.peers.find((p) => p.id === pid);
          if (peer) {
            room.peers = room.peers.filter((p) => p.id !== pid);
            room.host.inbox = room.host.inbox || [];
            room.host.inbox.push({ t: 'gone', id: pid });
            await roomSave(room);
          }
        }
      }
      return jsonReply(200, { ok: true }, ctx.origin);
    }
    return err(ctx.origin, '未知操作', 404);
  }

  async function handle(event) {
    const method = String((event && event.httpMethod) || 'GET').toUpperCase();
    const headers = (event && event.headers) || {};
    const origin = headers.origin || headers.Origin || '';
    if (method === 'OPTIONS') return { statusCode: 204, headers: headersFor(origin), body: '' };
    const rawUrl = (event && (event.rawUrl || event.raw_url)) || ('https://local' + ((event && event.path) || '/'));
    let url;
    try { url = new URL(rawUrl, 'https://local'); } catch (e) { url = new URL('https://local/'); }
    const pathname = url.pathname;
    const endpoint = pathname.split('/').filter(Boolean).pop() || '';
    const query = {};
    for (const [k, v] of url.searchParams.entries()) query[k] = v;
    const bodyBuf = event && event.isBase64Encoded
      ? Buffer.from(String(event.body || ''), 'base64')
      : Buffer.from(String(event.body || ''), 'utf8');
    let bodyJson = {};
    const ctype = String(headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
    if (ctype.includes('json') || ctype === '' || ctype.includes('text/plain')) {
      try {
        const t = bodyBuf.toString('utf8');
        if (t.trim()) bodyJson = JSON.parse(t);
      } catch (e) { bodyJson = {}; }
    }
    const inputObj = Object.assign({}, query, bodyJson);
    const ctx = { method, origin, pathname, query, in: inputObj, bodyBuf, action: String(query.action || inputObj.action || '') };

    if (method === 'GET' || method === 'HEAD') {
      // PHP's input() merges GET values; binary endpoints read query only.
      ctx.method = method;
    }

    const endpointName = endpoint.replace(/\.php$/i, '');
    switch (endpointName) {
      case 'account': return handleAccount(ctx);
      case 'cloud': return handleCloud(ctx);
      case 'checkin': return handleCheckin(ctx);
      case 'announce': return handleAnnounce(ctx);
      case 'news': return handleNews(ctx);
      case 'feedback': return handleFeedback(ctx);
      case 'skin': return handleSkin(ctx);
      case 'telemetry': return handleTelemetry(ctx);
      case 'p2p': return handleP2P(ctx);
      case 'probe': return jsonReply(200, {
        ok: true, backend: 'netlify-blobs', php: false, time: nowMs(),
        cloudQuota: CLOUD_QUOTA, cloudExpireDays: CLOUD_EXPIRE_DAYS,
      }, ctx.origin);
      default: return err(ctx.origin, '未知接口', 404);
    }
  }

  return { handle, _internal: { pushCloudBuffer, omccHead } };
}

module.exports = { createApi, ADMIN_NAMES, DEFAULT_OWNED, CLOUD_QUOTA };
