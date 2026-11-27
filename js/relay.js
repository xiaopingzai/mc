'use strict';
// ---------------------------------------------------------------------------
// 中继联机（推荐）：房主和客人只连本服务器的一个 WebSocket，游戏数据由服务器转发。
// 相比 WebRTC：不需要公网 IP / 端口映射，不受对称 NAT 影响，也不会暴露玩家 IP；代价是流量走服务器。
// 服务端见根目录 server.js；同一 Wi-Fi 下直接用 http://房主局域网IP:8123 打开，就是局域网联机。
// 协议：
//   房主控制 ws  /relay?role=host&code=CODE&name=...
//   房主数据 ws  /relay?role=host&code=CODE&peer=GUEST_ID
//   客人 ws      /relay?role=guest&code=CODE&name=...
// 服务端把同一客人的两条数据 ws 配对后原样转发（JSON 与二进制 chunk 都支持）。
// ---------------------------------------------------------------------------
const Relay = {
  enabled() {
    const c = window.NET_CONFIG || {};
    if (c.relay === false || c.relay === 'off') return false;
    return true;
  },
  // 有没有 Node WebSocket 中继：PHP 站点有 api/p2p.php?action=ping（php:true），应该走 WebRTC 信令而不是 /relay。
  async backend() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
    try {
      const r = await fetch((Account.apiBase ? Account.apiBase() : 'api') + '/p2p.php?action=ping', { cache: 'no-store' });
      const j = await r.json();
      return !(j && j.php);
    } catch (e) { return true; }
  },
  base() {
    const c = (window.NET_CONFIG && NET_CONFIG.relay) || '';
    if (typeof c === 'string' && /^wss?:\/\//.test(c)) return c.replace(/\/+$/, '');
    if (location.protocol !== 'http:' && location.protocol !== 'https:') throw new Error('当前页面无法连接房间服务；请从网站地址打开，或刷新后再试');
    if (typeof c === 'string' && c && c !== 'auto' && c !== 'on') return (location.origin.replace(/^http/, 'ws') + (c.startsWith('/') ? c : '/' + c)).replace(/\/+$/, '');
    return location.origin.replace(/^http/, 'ws') + '/relay';
  },
  url(params) {
    const u = new URL(this.base());
    for (const [k, v] of Object.entries(params || {})) if (v != null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  },
};
class RelayLink {
  constructor(ws, onMsg, onState) {
    this.ws = ws; this.onMsg = onMsg; this.onState = onState; this.closed = false;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { if (!this.closed) this.onState && this.onState('open'); };
    ws.onclose = () => { this.closed = true; this.onState && this.onState('closed'); };
    ws.onerror = () => { if (!this.closed) this.onState && this.onState('failed'); };
    ws.onmessage = (e) => { try { this.onMsg && this.onMsg(typeof e.data === 'string' ? JSON.parse(e.data) : new Uint8Array(e.data)); } catch (err) { console.warn('relay message', err); } };
    if (ws.readyState === 1) setTimeout(() => { if (!this.closed) this.onState && this.onState('open'); }, 0);
  }
  maxSize() { return 262144; }
  backlog() { return this.ws ? this.ws.bufferedAmount : 0; }
  send(o) {
    const ws = this.ws; if (!ws || ws.readyState !== 1) return false; if (ws.bufferedAmount > 8 << 20) return false;
    const data = o instanceof Uint8Array || typeof o === 'string' ? o : JSON.stringify(o);
    // 与 P2PLink 一致：消息过大不发，避免把整条连接弄断
    const n = typeof data === 'string' ? data.length : data.length;
    if (n > this.maxSize()) { console.warn('relay: message too large', o && o.t, n); return false; }
    try { ws.send(data); return true; } catch (e) { console.warn('relay send', e); return false; }
  }
  close() { this.closed = true; try { this.ws && this.ws.close(); } catch (e) { } }
}
// 房主控制通道：拿邀请码、收 peer / gone
class RelayControl {
  constructor() { this.ws = null; this.onPeer = null; this.onGone = null; this.onClosed = null; }
  // 联机必须登录：中继握手带上账号 token，服务器会核对；本地游客 token 是 local，会被拒绝。
  static token() { try { const a = (typeof Account !== 'undefined') ? Account : window.Account; return (a && a.loggedIn && !a.isLocal && a.token) || ''; } catch (e) { return ''; } }
  open(code, name, meta = {}) {
    return new Promise((res, rej) => {
      let done = false;
      const q = { role: 'host', code: code || '', name: name || 'Host', tk: RelayControl.token() };
      // 公开房间的配置走 query：服务器据此写入 /api/public 列表；不公开的房间不会出现在列表里
      if (meta.public) q.public = 1;
      if (meta.title) q.title = String(meta.title).slice(0, 32);
      if (meta.max) q.max = meta.max;
      if (meta.mode) q.mode = meta.mode;
      if (meta.difficulty) q.difficulty = meta.difficulty;
      if (meta.flat) q.flat = 1;
      const ws = this.ws = new WebSocket(Relay.url(q)); ws.binaryType = 'arraybuffer';
      const fail = (e) => { if (done) return; done = true; try { ws.close(); } catch (x) { } rej(new Error(e || '中继服务器不可用')); };
      const timer = setTimeout(() => fail('中继服务器连接超时'), 8000);
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'hosted') { done = true; clearTimeout(timer); this.code = m.code; this.peerId = m.peerId; res(m); }
        else if (m.t === 'peer') this.onPeer && this.onPeer(m.id, m.name);
        else if (m.t === 'gone') this.onGone && this.onGone(m.id);
        else if (m.t === 'closed') this.onClosed && this.onClosed(m.reason || '房主关闭了房间');
        else if (m.t === 'error') fail(m.error);
      };
      ws.onerror = () => fail('连不上中继服务器');
      ws.onclose = () => { if (!done) fail('中继服务器关闭了连接'); else this.onClosed && this.onClosed('中继连接断开'); };
    });
  }
  channel(id, onMsg, onState) { return new RelayLink(new WebSocket(Relay.url({ role: 'host', code: this.code, peer: id, name: 'Host', tk: RelayControl.token() })), onMsg, onState); }
  update(meta = {}) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'update', public: meta.public, title: meta.title, max: meta.max, mode: meta.mode, difficulty: meta.difficulty })); return true; } catch (e) { return false; } }
  close() { try { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'close' })); } catch (e) { } try { this.ws && this.ws.close(); } catch (e) { } }
}
// 客人：一条 ws 同时用于加入与收/发游戏数据
class RelayGuest {
  constructor(code, name) { this.code = code; this.name = name; this.pid = ''; this.hostName = ''; this.link = null; }
  join() {
    return new Promise((res, rej) => {
      let done = false;
      const ws = new WebSocket(Relay.url({ role: 'guest', code: this.code, name: this.name, tk: RelayControl.token() })); ws.binaryType = 'arraybuffer';
      const fail = (e) => { if (done) return; done = true; try { ws.close(); } catch (x) { } rej(new Error(e || '无法加入中继房间')); };
      const timer = setTimeout(() => fail('中继服务器连接超时'), 8000);
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'joined') { done = true; clearTimeout(timer); this.pid = m.peerId; this.hostName = m.host; res(m); }
        else if (m.t === 'error') fail(m.error);
      };
      ws.onerror = () => fail('连不上中继服务器');
      ws.onclose = () => { if (!done) fail('中继服务器关闭了连接'); };
      this.ws = ws;
    });
  }
  attach(onMsg, onState) {
    this.link = new RelayLink(this.ws, onMsg, onState);
    // 告诉服务器“消息处理器已接好”，服务器这时才让房主开数据通道并发 welcome
    try { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'ready' })); } catch (e) { }
    return this.link;
  }
  close() { try { this.ws && this.ws.close(); } catch (e) { } }
}
