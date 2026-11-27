'use strict';
// ---------------------------------------------------------------------------
// Local rooms (multiplayer/ROOMS_TODO.md 房间政策「本地房间」): the host plays its own single-player world and up to
// 3 friends join it over WebRTC (the room service only does the matchmaking: multiplayer/rooms/p2p.js; with a TURN
// relay configured every connection goes through it, so nobody sees another player's address).
// A guest runs the normal game on a world of the same seed - generation is deterministic - and only what is shared
// travels: the chunks the host's world changed (asked for when the guest needs them), every block change both ways,
// chests / furnaces / other block entities (both ways, the newest wins), the host's mobs, dropped items and orbs
// (snapshots, drawn as mirrors), the players (where they are, what they hold, skins and capes), time, weather, chat,
// markers. A guest keeps its own inventory, crafting, health and hunger; what it hits goes to the host's mob, what
// hits it (the host's mobs pick their target among all players) comes back as damage. Its items dropped land in the
// host's world for anyone to pick up. Guests stay in the overworld; the host doesn't leave it while guests are in.
// The host's world is saved as always; a guest's inventory and place are kept in it for the next visit.
// ---------------------------------------------------------------------------
const P2P_MAX = 4;
// HTTP 信令：本站 PHP 房间队列（替代原 WebSocket /p2p），仅交换 SDP / ICE；游戏数据走 WebRTC 直连
const p2pApi = (action, body) => fetch(Account.apiBase() + '/p2p.php?action=' + action, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.assign({ _t: Account.token || undefined }, body || {})),
}).then(async (r) => {
  const j = await r.json().catch(() => ({ error: '服务器没有回应（HTTP ' + r.status + '）' }));
  if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
});
const p2pPollEvery = 1500;
const p2pBlocks = { applying: 0 };
// the record of a chunk <-> bytes (the save format: RLE blocks and metas, waterlogged cells)
function p2pPackChunk(rec) {
  const b = new Uint8Array(rec.b.buffer, rec.b.byteOffset, rec.b.byteLength), m = new Uint8Array(rec.m.buffer, rec.m.byteOffset, rec.m.byteLength);
  const w = rec.w ? new Uint8Array(rec.w.buffer, rec.w.byteOffset, rec.w.byteLength) : new Uint8Array(0);
  const out = new Uint8Array(12 + b.length + m.length + w.length), dv = new DataView(out.buffer);
  dv.setUint32(0, rec.b.length); dv.setUint32(4, rec.m.length); dv.setUint32(8, rec.w ? rec.w.length : 0);
  out.set(b, 12); out.set(m, 12 + b.length); out.set(w, 12 + b.length + m.length);
  return out;
}
function p2pUnpackChunk(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), nb = dv.getUint32(0), nm = dv.getUint32(4), nw = dv.getUint32(8);
  const copy = (o, n, T, sz) => { const a = new T(n); new Uint8Array(a.buffer).set(u8.subarray(o, o + n * sz)); return a; };
  const rec = { b: copy(12, nb, Uint16Array, 2), m: copy(12 + nb * 2, nm, Uint16Array, 2) };
  if (nw) rec.w = copy(12 + nb * 2 + nm * 2, nw, Uint32Array, 4);
  return rec;
}
// binary frames: [u8 kind][u32 request id][payload] (kind 1: a chunk record)
function p2pFrame(kind, id, payload) { const out = new Uint8Array(5 + payload.length); out[0] = kind; new DataView(out.buffer).setUint32(1, id); out.set(payload, 5); return out; }
// what a block entity is worth comparing (JSON without the parts that are only the client's)
const beJson = (be) => { try { return JSON.stringify(be, (k, v) => (k === 'open' || k === 'lid' || k === 'viewers' ? undefined : v)); } catch (e) { return ''; } };
const beKey = (k) => typeof k === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(k);
// an item id from the other side, if this game has it: a phone still on an older (cached) or newer version sends ids
// missing here, and a held item or dropped item drawn with one threw every frame
const p2pItem = (id) => (id != null && ITEMS[id] ? id : null);
// a message's size on the wire: bytes as they are, a string as UTF-8 (at most 3 bytes a character: encoded only when
// that could matter)
const p2pBytes = (d) => (typeof d !== 'string' ? d.length : d.length * 3 <= 65536 ? d.length * 3 : new TextEncoder().encode(d).length);
// a look from the other side as skins.js takes a room's (NetClient 'look'): a skin id that isn't one, or a cape this
// version doesn't have, is left out - an older (cached) or newer game sends what this one can't draw, and a player whose
// drawing throws is skipped: not seen at all (hats, pets and prefixes are looked up safely, cosmetics.js hasKey)
const p2pWord = (v) => (typeof v === 'string' && /^[a-z]{3,16}$/.test(v) ? v : null);
// a skin id: presets (p:), a Mojang name (m:), an older local custom id (u:), or an r:... id with a PNG beside it
const p2pSkin = (v) => (typeof v === 'string' && /^(p:[a-z_]{3,20}|m:[A-Za-z0-9_]{3,16}|u:[a-z0-9_]+|r:[a-z0-9]{4,16})$/.test(v) ? v : null);
const p2pLook = (l) => {
  if (!l || typeof l !== 'object') return null;
  const skin = p2pSkin(l.skin);
  // (a custom skin travels with its PNG once; Skins.accept keeps it in memory for this page)
  if (skin && skin.startsWith('r:') && l.png) { try { Skins.accept(l); } catch (e) { } }
  return { skin, slim: !!l.slim, cape: p2pWord(l.cape) && typeof Capes !== 'undefined' && Capes.info(l.cape) ? l.cape : null, hat: p2pWord(l.hat), pet: p2pWord(l.pet), pre: p2pWord(l.pre) };
};
// a list (block changes) in as many messages as the connection takes, each one standing alone: a /fill of some 13,000
// blocks is more than 256 KB, and the whole change was lost for the guests (measured with a 4 KB limit: 3,584 blocks,
// 60,946 bytes, 'message too large')
function p2pSendList(link, t, list) {
  const j = JSON.stringify({ t, list });
  if (list.length < 2 || p2pBytes(j) <= link.maxSize() - 256) return link.send(j);
  const h = list.length >> 1; p2pSendList(link, t, list.slice(0, h)); return p2pSendList(link, t, list.slice(h));
}
// a chunk reply larger than one message goes in pieces (frame kind 2: [2][u32 request id][u8 last][bytes]); an older
// guest ignores them and reads the chunk as it did when the send threw (its request times out)
function p2pFrames(id, payload, max) {
  if (payload.length + 5 <= max) return [p2pFrame(1, id, payload)];
  const out = [], n = max - 6;
  for (let o = 0; o < payload.length; o += n) { const part = payload.subarray(o, o + n), f = new Uint8Array(6 + part.length); f[0] = 2; new DataView(f.buffer).setUint32(1, id); f[5] = o + n >= payload.length ? 1 : 0; f.set(part, 6); out.push(f); }
  return out;
}

// ---- the matchmaking socket and one peer connection ----
class P2PLink {
  constructor(ice, onMsg, onState) { this.ice = ice; this.onMsg = onMsg; this.onState = onState; this.pending = []; }
  make(sendSignal) {
    const pc = this.pc = new RTCPeerConnection({ iceServers: this.ice.iceServers || [], iceTransportPolicy: this.ice.relayOnly ? 'relay' : 'all' });
    pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ cand: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => this.onState(pc.connectionState);
    return pc;
  }
  wire(dc) {
    this.dc = dc; dc.binaryType = 'arraybuffer';
    dc.onopen = () => this.onState('open');
    dc.onclose = () => this.onState('closed');
    dc.onmessage = (e) => { try { this.onMsg(typeof e.data === 'string' ? JSON.parse(e.data) : new Uint8Array(e.data)); } catch (err) { console.warn('p2p message', err); } };
  }
  async signal(d, sendSignal) {
    const pc = this.pc;
    if (d.sdp) {
      await pc.setRemoteDescription(d.sdp);
      for (const c of this.pending) await pc.addIceCandidate(c).catch(() => { });
      this.pending = [];
      if (d.sdp.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); sendSignal({ sdp: pc.localDescription.toJSON() }); }
    } else if (d.cand) { if (pc.remoteDescription) await pc.addIceCandidate(d.cand).catch(() => { }); else this.pending.push(d.cand); }
  }
  // the largest message the connection takes (256 KB between two Chromes; 64 KB assumed where the browser doesn't say).
  // A larger one threw out of dc.send ("larger than max-message-size", measured 11-03): out of welcome() the guest never
  // got in (a world whose chests and signs hold Chinese text: 150,000 characters are up to 450 KB), out of tick() no
  // guest after it got another snapshot
  maxSize() { const s = this.pc && this.pc.sctp; return Math.min(s && s.maxMessageSize > 0 ? s.maxMessageSize : 65536, 262144); }
  backlog() { return this.dc ? this.dc.bufferedAmount : 0; }
  // o: an object (sent as JSON), its JSON already made, or bytes
  send(o) {
    const dc = this.dc; if (!dc || dc.readyState !== 'open') return false; if (dc.bufferedAmount > 8 << 20) return false;
    const data = o instanceof Uint8Array || typeof o === 'string' ? o : JSON.stringify(o);
    if (p2pBytes(data) > this.maxSize()) { console.warn('p2p: message too large', o && o.t, p2pBytes(data)); return false; }
    try { dc.send(data); return true; } catch (e) { console.warn('p2p send', e); return false; }
  }
  close() { try { this.dc && this.dc.close(); } catch (e) { } try { this.pc && this.pc.close(); } catch (e) { } }
}

// ---- a guest's stand-in on the host: drawn like another player, hit by the host's mobs (the damage goes to the guest) ----
class GuestAvatar extends NetPlayer {
  constructor(game, peer, x, y, z) {
    super(game, x, y, z, peer.name);
    this.peer = peer; this.remote = true; this.alwaysTick = true; this.persistent = false; this.creative = false; this.spectator = false;
    this.netPos = [x, y, z]; this.lerpN = 0; this.tick = netEntityTick;
    // (before the guest's first state arrives: netEntityTick would turn yaw/bodyYaw by NaN if netYaw were undefined -
    //  the whole model then has a NaN matrix and was not drawn at all, only the name tag was left)
    this.netYaw = this.yaw; this.netHead = this.yaw; this.netPitch = 0;
    // (what mob code reads of "the player")
    const self = this;
    this.inv = { get held() { return self.heldId != null ? { id: self.heldId, count: 1, dmg: 0 } : null; }, get slots() { return [...new Array(36).fill(null), ...(self.armorItems || [null, null, null, null])]; }, armorPoints: () => 0, armorToughness: () => 0 };
  }
  eye() { return this.sneaking ? 1.27 : 1.62; }
  hurt(a, src) {
    if (this.creative || this.spectator || this.deadGuest) return false;
    const s = src || {}, from = s.attacker || s.entity || s.source;
    this.peer.link.send({ t: 'hurt', dmg: a, kind: s.type || 'mob', from: from && from.pos ? from.pos.map((v) => +v.toFixed(2)) : null, name: from && (from.name || from.type) });
    this.hurtTime = 10;
    return true;
  }
  isSavedEntity() { return false; }
}
(() => {
  // (avatars are never saved with the world, nor counted as mobs)
  const ise = Game.prototype.isSavedEntity;
  Game.prototype.isSavedEntity = function (e) { return e instanceof GuestAvatar || e.p2pMirror ? false : ise.call(this, e); };
})();

// ================================== the host ==================================
class LocalHost {
  constructor(g, code, opts = {}) { this.g = g; this.code = code; this.opts = opts || {}; this.max = this.opts.max || 4; this.public = this.opts.public !== false; this.title = this.opts.title || ''; this.peers = new Map(); this.nextEnt = 1; this.blocks = []; this.beSent = new Map(); this.state = 'connecting'; this.chunkLists = new Map(); this.relay = null; this.pingSeq = 0; }
  async open() {
    let useRelay = typeof Relay !== 'undefined' && Relay.enabled();
    if (useRelay && Relay.backend) { try { useRelay = await Relay.backend(); } catch (e) { useRelay = true; } }
    if (useRelay) {
      this.state = 'connecting';
      const relay = this.openRelay();
      return relay.catch((e) => {
        // 兼容旧版页面/没有 WebSocket 中继的静态站点：中继失败时自动回退到 PHP 信令 + WebRTC 直连。
        try { this.relay && this.relay.close(); } catch (x) { }
        this.relay = null; this.state = 'connecting';
        this.g.ui.message('中继服务器连不上，正在尝试旧版 P2P 直连…', '#FFD24A');
        return this.openSignal().catch((e2) => {
          throw new Error('房间连接失败。请确认双方都打开了同一个页面，刷新后再试；也可以重新输入邀请码加入。');
        });
      });
    }
    return this.openSignal();
  }
  // 中继房间：服务器替房主和客人转发所有数据，房主不需要公网 IP / 端口映射。
  openRelay() {
    return new Promise((res, rej) => {
      const ctrl = this.relay = new RelayControl();
      ctrl.onPeer = (id, name) => this.addRelayPeer(id, name);
      ctrl.onGone = (id) => this.dropPeer(id, '离开了');
      ctrl.onClosed = (why) => { if (this.state !== 'closed') { this.state = 'closed'; for (const p of this.peers.values()) p.link.close(); this.peers.clear(); this.g.ui.message('中继连接断开：' + why, '#FF8080'); } };
      ctrl.open(this.code, this.g.playerName || (Account.loggedIn && Account.name) || this.g.settings.netName || 'Host', this.opts)
        .then((j) => {
          this.code = j.code; this.pid = j.peerId; this.ice = j.ice; this.state = 'open';
          this.g.cheats = true;
          res();
        })
        .catch((e) => { this.state = 'closed'; rej(new Error(e.message || '连不上中继服务器')); });
    });
  }
  addRelayPeer(id, name) {
    if (this.peers.has(id)) return;
    const p = { id, name, avatar: null, state: null, look: null, joined: false, relay: true, latency: null, pingAt: 0 };
    let opened = false;
    p.link = this.relay.channel(id, (m) => this.onMsg(p, m), (st) => {
      if (st === 'open' && !opened) { opened = true; this.welcome(p); }
      if ((st === 'failed' || st === 'closed' || st === 'disconnected') && this.peers.get(id) === p) this.dropPeer(id, st === 'failed' ? '没连上（中继不通）' : '离开了');
    });
    this.peers.set(id, p);
    // (a peer that never opens its data channel: let go after 30s)
    setTimeout(() => { if (this.peers.get(id) === p && !p.joined) this.dropPeer(id, '没连上（中继不通）'); }, 30000);
  }
  // 旧的 WebRTC 直连：需要 p2p.php 或 /api 信令，保留作为没有中继服务器时的兼容路径
  openSignal() {
    return new Promise((res, rej) => {
      p2pApi('host', Object.assign({ code: this.code || '', name: this.g.playerName || (Account.loggedIn && Account.name) || this.g.settings.netName || 'Host' }, this.opts || {}))
        .then((j) => {
          this.code = j.code; this.pid = j.peerId; this.ice = j.ice; this.state = 'open';
          this.g.cheats = true;
          this.startPoll(); res();
        })
        .catch((e) => { this.state = 'closed'; rej(new Error(e.message || '连不上游戏服务器')); });
    });
  }
  startPoll() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (this.state !== 'open') return;
      try { const j = await p2pApi('poll', { code: this.code, peerId: this.pid }); (j.messages || []).forEach((m) => this.onSignal(m)); } catch (e) { }
    }, p2pPollEvery);
  }
  onSignal(m) {
    if (m.t === 'peer') this.addPeer(m.id, m.name);
    else if (m.t === 'signal') { const p = this.peers.get(m.from); if (p) p.link.signal(m.data, (d) => this.sig(p.id, d)).catch((err) => console.warn('p2p signal', err)); }
    else if (m.t === 'gone') this.dropPeer(m.id, '离开了');
  }
  sig(id, data) { p2pApi('signal', { code: this.code, from: this.pid, to: id, data }).catch(() => { }); }
  async addPeer(id, name) {
    if (this.relay) return this.addRelayPeer(id, name);
    const p = { id, name, avatar: null, state: null, look: null, joined: false, latency: null, pingAt: 0 };
    p.link = new P2PLink(this.ice, (m) => this.onMsg(p, m), (st) => {
      if (st === 'open') this.welcome(p);
      if ((st === 'failed' || st === 'closed' || st === 'disconnected') && this.peers.get(id) === p) this.dropPeer(id, st === 'failed' ? '没连上（网络不通）' : '离开了');
    });
    const pc = p.link.make((d) => this.sig(id, d));
    p.link.wire(pc.createDataChannel('game', { ordered: true }));
    this.peers.set(id, p);
    await pc.setLocalDescription(await pc.createOffer());
    this.sig(id, { sdp: pc.localDescription.toJSON() });
    // (no answer within 30 s: let go)
    setTimeout(() => { if (this.peers.get(id) === p && !p.joined) this.dropPeer(id, '没连上（网络不通）'); }, 30000);
  }
  dropPeer(id, why) {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id);
    p.link.close();
    if (p.avatar) p.avatar.dead = true;
    if (p.joined) { this.g.ui.message(`${p.name} ${why}`, '#FFFF55'); this.toAll({ t: 'chat', sys: true, text: `${p.name} ${why}` }); }
    if (!this.relay) p2pApi('leave', { code: this.code, peerId: id }).catch(() => { });
  }
  toAll(o, except) { for (const p of this.peers.values()) if (p.joined && p !== except) p.link.send(o); }
  // the first message: the world (seed, settings, the host's changed chunks and its block entities), the guest's own
  // last visit, where to appear
  welcome(p) {
    const g = this.g, w = g.world, m = g.worldMeta;
    // (the host went to the Nether or the End while nobody was in: a guest would have appeared at its place there in the
    // overworld, its stand-in among the other dimension's mobs - not let in until the host is back)
    if (g.dim !== 'overworld') { p.link.send({ t: 'kicked', reason: '房主现在不在主世界：等房主回到主世界再进来' }); setTimeout(() => this.dropPeer(p.id, '没能进入'), 300); return; }
    const keys = new Set(w.savedIndex || []);
    for (const ch of w.chunks.values()) if (ch.modified) keys.add(ckey(ch.cx, ch.cz));
    let saved = (m.guests || {})[p.name.toLowerCase()] || null;
    // (left while dead: back at the spawn point, alive)
    if (saved && !(saved.health > 0)) saved = { ...saved, health: 20, food: 20, sat: 5, pos: [...(g.player.spawn || m.spawn || g.player.pos)] };
    const sp = g.player.pos;
    const bes = [...g.blockEntities].filter(([k]) => beKey(k)).map(([k, be]) => [k, JSON.parse(beJson(be) || 'null')]), parts = [];
    // (in parts under the connection's message size, counted in bytes: see P2PLink.maxSize)
    const lim = Math.min(p.link.maxSize(), 65536) - 4096;
    for (let i = 0, cur = [], n = 0; i <= bes.length; i++) {
      const b = i < bes.length ? p2pBytes(JSON.stringify(bes[i])) + 1 : 0;
      if (i === bes.length || (cur.length && n + b > lim)) { if (cur.length) parts.push({ t: 'wbes', list: cur }); cur = []; n = 0; if (i === bes.length) break; }
      cur.push(bes[i]); n += b;
    }
    const kl = [...keys];
    for (let i = 0; i < kl.length; i += 4000) parts.push({ t: 'wkeys', list: kl.slice(i, i + 4000) });
    for (const q of parts) p.link.send(q);
    // (flat and structures: what the guest's world generates from the seed - without them a superflat host's guests
    // walked on normal terrain, feedback 11-01 20:36 / 20:38)
    const hostLook = Skins.share(g), looks = [{ name: this.hostName(), look: hostLook }];
    for (const q of this.peers.values()) if (q.joined) looks.push({ name: q.name, look: q.skinWire || null });
    this.hostLook = hostLook; this.hostLookKey = Skins.key(g);
    p.link.send({
      t: 'welcome', name: m.name, seed: m.seed, gen: m.gen, flat: !!m.flat, flatLayers: m.flatLayers, flatBiome: m.flatBiome, flatOpts: m.flatOpts, biome: m.biome, worldType: m.worldType, experiments: m.experiments, gameRules: g.gameRules || m.gameRules || {},
      structures: m.structures !== false, mode: g.mode === 'spectator' ? 'survival' : g.mode, difficulty: g.difficulty, hardcore: !!g.hardcore,
      time: g.worldTime, weather: g.weather, rain: g.rainTarget, spawn: g.player.spawn || m.spawn, near: [sp[0], sp[1], sp[2]], host: this.hostName(),
      saved, sponsor: this.sponsor, players: [...this.peers.values()].filter((q) => q.joined).map((q) => q.name), roster: this.roster(),
      modPerms: this.modPerm(p.name),
      hostLook, looks,
    });
    p.joined = true;
    p.avatar = new GuestAvatar(g, p, sp[0], sp[1], sp[2]);
    g.entities.push(p.avatar);
    g.ui.message(`${p.name} 加入了游戏`, '#FFFF55');
    this.toAll({ t: 'chat', sys: true, text: `${p.name} 加入了游戏` }, p);
    Telemetry.count && Telemetry.count('p2p_guest');
  }
  // a guest's stand-in, made again when it is no longer in the world: one taken out (its tick threw 5 times running -
  // tickEntity drops those -, /kill ...) was kept, so nobody saw that guest again, mobs no longer chased it, and its
  // snapshots stayed centred where it was taken out (only what was there was sent to it)
  avatarOf(p) {
    const g = this.g, a = p.avatar;
    if (a && !a.dead && g.entities.includes(a)) return a;
    const at = a ? a.netPos || a.pos : g.player.pos, n = p.avatar = new GuestAvatar(g, p, at[0], at[1], at[2]);
    if (a) n.look = a.look;
    g.entities.push(n);
    return n;
  }
  onMsg(p, m) {
    const g = this.g;
    if (m instanceof Uint8Array || this.peers.get(p.id) !== p) return; // (a message still on its way from a guest that was let go)
    switch (m.t) {
      case 'state': {
        p.state = m; if (!p.joined || !Array.isArray(m.pos) || !m.pos.slice(0, 3).every(Number.isFinite)) return;
        const a = this.avatarOf(p);
        a.netPos = m.pos.slice(0, 3); a.lerpN = 2; a.netYaw = m.yaw; a.netHead = m.yaw; a.netPitch = m.pitch; a.sneaking = !!m.sneak;
        if (m.swing) a.swingT = 6; a.heldId = p2pItem(m.held); a.armorItems = (Array.isArray(m.armor) ? m.armor : []).map((id) => (p2pItem(id) == null ? null : { id, count: 1 }));
        a.creative = m.mode === 'creative'; a.spectator = m.mode === 'spectator'; a.deadGuest = !!m.dead; a.flying = !!m.flying; a.netSwim = !!m.swim;
        if (m.look) {
          const look = p2pLook(m.look);
          if (look) {
            a.look = look;
            const key = [look.skin || '', look.slim ? 1 : 0, look.cape || '', look.hat || '', look.pet || '', look.pre || ''].join('|');
            if (p.skinKey !== key) {
              p.skinKey = key;
              p.skinWire = m.look.png && look.skin && look.skin.startsWith('r:') ? { ...m.look, skin: look.skin, slim: !!look.slim } : { ...look };
              this.toAll({ t: 'look', name: p.name, look: p.skinWire }, p);
            }
          }
        }
        break;
      }
      // 房客打方块 / 受伤 / 吃东西的声音：房主播放，并转给其他房客（不再回传给说话的人）
      case 'snd': if (p.joined && window.p2pPlaySound) { window.p2pPlaySound(m); this.toAll(m, p); } break;
      // RTT：房主每 5 秒发一次，客人回 pong；房主自己不需要显示（它就是世界的时间线）
      case 'ping': p.link.send({ t: 'pong', i: m.i }); break;
      case 'pong': if (typeof m.i === 'string' && m.i[0] === 'h' && p.pingAt) {
        p.latency = Math.max(0, Math.round(performance.now() - p.pingAt)); p.pingAt = 0;
      } break;
      case 'chunk': {
        // a chunk the host's world changed: from memory (loaded) or the save
        const w = g.world, k = ckey(m.cx, m.cz), ch = w.chunks.get(k);
        // (a piece that didn't go: not the rest either - the guest's request times out, as for a reply that didn't go)
        const reply = (rec) => { for (const f of p2pFrames(m.id, rec ? p2pPackChunk(rec) : new Uint8Array(0), p.link.maxSize())) if (!p.link.send(f)) break; };
        if (ch && ch.modified) reply(encodeChunk(ch));
        else if (w.savedChunks && w.savedChunks.has(k)) reply(w.savedChunks.get(k));
        else DB.getChunk(w.savedStore, m.cx, m.cz).then((r) => reply(r || (ch ? encodeChunk(ch) : null)), () => reply(null));
        break;
      }
      case 'b': for (const [x, y, z, id, meta, wl] of m.list || []) { if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !BLOCKS[id]) continue; p2pBlocks.from = p; g.world.setBlock(x, y, z, id, meta | 0, 3); if (wl !== undefined) g.world.setWaterlogged(x, y, z, !!wl); p2pBlocks.from = null; } break;
      case 'be': if (beKey(m.k) && m.data && typeof m.data === 'object') { const be = g.blockEntities.get(m.k); if (be) Object.assign(be, m.data); else g.blockEntities.set(m.k, m.data); this.beSent.set(m.k, beJson(g.blockEntities.get(m.k))); this.toAll({ t: 'be', k: m.k, data: m.data }, p); } break;
      case 'drop': if (m.stack && ITEMS[m.stack.id] && Array.isArray(m.pos)) { const e = g.dropItem(m.pos[0], m.pos[1], m.pos[2], fixSavedStack({ ...m.stack }), m.vel); if (e) e.pickup = 40; } break;
      case 'pickup': {
        const e = g.entities.find((q) => q.p2pId === m.id && !q.dead), a = p.avatar;
        // (an item just dropped waits its pickup delay, as for the host)
        if (!e || !a || (e.pickup > 0) || Math.hypot(e.pos[0] - a.pos[0], e.pos[1] - a.pos[1], e.pos[2] - a.pos[2]) > 4) break;
        // (taken only once the give went: send no longer throws, and a stack too large for the connection, or behind
        // 8 MB still to go, was taken off the ground and lost - it stays there now)
        if (e instanceof ItemEntity && e.stack) { if (p.link.send({ t: 'give', stack: e.stack })) { e.dead = true; Sound.ev && Sound.ev('entity.item.pickup', e.pos, 0.2, 1.5); } }
        else if (e instanceof ExperienceOrb) { if (p.link.send({ t: 'xp', n: e.value || e.v || 1 })) e.dead = true; }
        break;
      }
      case 'hit': {
        const e = g.entities.find((q) => q.p2pId === m.id && !q.dead);
        if (e && e.hurt && typeof m.dmg === 'number' && m.dmg > 0 && m.dmg < 100) e.hurt(m.dmg, { type: 'player', attacker: p.avatar, player: true, kb: m.kb });
        break;
      }
      case 'chat': { const t = String(m.text || '').slice(0, 256); if (!t) break; g.ui.message(`<${p.name}> ${t}`); this.toAll({ t: 'chat', name: p.name, text: t }, p); break; }
      // 房客在开发者菜单改名字：只改显示名，不动它的存档（存档按原名字保存）
      case 'rename': {
        const n = String(m.name || '').trim().slice(0, 16); if (!n || !p.joined) break;
        const old = p.name; p.name = n;
        if (p.avatar) p.avatar.name = n;
        this.toAll({ t: 'chat', sys: true, text: `${old} 改名为 ${n}` });
        g.ui.message(`${old} 改名为 ${n}`, '#FFFF55');
        this.sendRoster();
        break;
      }
      case 'modperm': break; // 房客不能改权限：这条消息只由房主发出
      case 'mark': if (Array.isArray(m.pos)) { Marks.add(p.name, m.pos.map((v) => v | 0)); g.ui.message(`${p.name} 标记了一个位置`, '#FFD24A'); this.toAll({ t: 'mark', name: p.name, pos: m.pos }, p); } break;
      case 'pstate': { const M = g.worldMeta; if (M && m.data) { (M.guests || (M.guests = {}))[p.name.toLowerCase()] = m.data; } break; }
    }
  }
  // every tick: block changes out; every other tick: what each guest sees; every half second: block entities that changed
  tick() {
    const g = this.g;
    // game rules are part of the room: a host change reaches every guest (welcome carries the initial set)
    const rj = JSON.stringify(g.gameRules || {});
    if (rj !== this.rulesJson) { this.rulesJson = rj; if (this.peers.size) this.toAll({ t: 'rules', rules: g.gameRules || {} }); }
    if (!this.peers.size) { this.blocks.length = 0; return; }
    if (g.tickCount % 100 === 0) this.pingPeers();
    if (this.blocks.length) {
      const list = this.blocks.splice(0);
      for (const p of this.peers.values()) if (p.joined) p2pSendList(p.link, 'B', list);
    }
    // (a snapshot is the latest state: none while the guest's connection is still sending older data. They went into
    // the queue regardless, up to 8 MB - over a slow or relayed connection minutes of them, so every player and mob was
    // seen where it had been long ago, or not at all. One a second still goes: a browser whose count of what waits never
    // came down would otherwise have shown that guest nobody at all)
    if (g.tickCount % 2 === 0) for (const p of this.peers.values()) if (p.joined && p.avatar && (p.link.backlog() < 128 << 10 || g.tickCount % 20 === 0)) g.guard('p2p snapshot', () => this.sendSnapshot(p));
    if (g.tickCount % 10 === 0) {
      for (const [k, be] of g.blockEntities) {
        if (!beKey(k)) continue;
        const j = beJson(be);
        if (this.beSent.get(k) !== j) { this.beSent.set(k, j); this.toAll({ t: 'be', k, data: JSON.parse(j) }); }
      }
    }
    if (g.tickCount % 40 === 0) { this.toAll({ t: 'env', time: g.worldTime, weather: g.weather, rain: g.rainTarget, difficulty: g.difficulty }); this.sendRoster(); }
    // (the host changed its skin while friends are in: tell them once, with the PNG if it is a custom skin)
    if (g.tickCount % 40 === 0) {
      const key = Skins.key(g);
      if (this.hostLookKey !== key) { this.hostLookKey = key; this.hostLook = Skins.share(g); this.toAll({ t: 'look', name: this.hostName(), look: this.hostLook }); }
    }
  }
  // a snapshot in as many messages as the connection's message size needs (all but the last say more: 1; the guest
  // puts them together). One too large for it threw, and that guest got none
  sendSnapshot(p) {
    const s = this.snapshot(p), j = JSON.stringify(s), lim = p.link.maxSize() - 256;
    if (p2pBytes(j) <= lim) { p.link.send(j); return; }
    const parts = [], cut = (l) => { if (l.length < 2 || p2pBytes(JSON.stringify(l)) <= lim) parts.push(l); else { const h = l.length >> 1; cut(l.slice(0, h)); cut(l.slice(h)); } };
    cut(s.list);
    parts.forEach((l, i) => p.link.send(i < parts.length - 1 ? { t: 'E', list: l, more: 1 } : { t: 'E', list: l }));
  }
  // the entities near a guest: mobs, items, orbs (within 64 blocks), and the other players wherever they are (vanilla
  // tracks players out to the view distance; at 64 blocks two guests apart lost sight of each other)
  snapshot(p) {
    const g = this.g, a = p.avatar, R2 = 64 * 64, ents = [];
    for (const e of g.entities) {
      if (e.dead || e === a) continue;
      const dx = e.pos[0] - a.pos[0], dz = e.pos[2] - a.pos[2];
      if (dx * dx + dz * dz > R2 && !(e instanceof GuestAvatar)) continue;
      if (!e.p2pId) e.p2pId = this.nextEnt++;
      const r = [e.p2pId, 0, +e.pos[0].toFixed(2), +e.pos[1].toFixed(2), +e.pos[2].toFixed(2), +(e.yaw || 0).toFixed(2)];
      if (e instanceof GuestAvatar) { r[1] = 'player'; r.push({ name: e.name, look: e.look || null, held: e.heldId ?? null, armor: (e.armorItems || []).map((s) => s && s.id), sneak: !!e.sneaking, swing: e.swingT > 0, pitch: e.netPitch || 0, swim: !!e.netSwim }); }
      else if (e instanceof ItemEntity) { if (!e.stack) continue; r[1] = 'item'; r.push({ id: e.stack.id, n: e.stack.count }); }
      else if (e instanceof ExperienceOrb) { r[1] = 'xp'; r.push({ v: e.value || e.v || 1 }); }
      else if (e instanceof Mob && e.type) {
        r[1] = e.type;
        r.push({ b: +(e.bodyYaw ?? e.yaw ?? 0).toFixed(2), h: +(e.headYaw || 0).toFixed(2), p: +(e.pitch || 0).toFixed(2), ls: +(e.limbSwing || 0).toFixed(2), la: +(e.limbAmt || 0).toFixed(2),
          baby: e.baby ? 1 : 0, sh: e.sheared ? 1 : 0, wc: e.woolColor || 0, sz: typeof e.size === 'number' ? e.size : undefined, fuse: e.fuse, ht: e.hurtTime || 0, dt: e.deathTime || 0, sw: e.swingT || 0, held: e.heldId ?? (e.hand && e.hand.id), name: e.customName });
      } else continue;
      ents.push(r);
    }
    // the host itself, as a player
    const hp = g.player;
    ents.push([-1, 'player', +hp.pos[0].toFixed(2), +hp.pos[1].toFixed(2), +hp.pos[2].toFixed(2), +hp.yaw.toFixed(2), { name: this.hostName(), look: Skins.portable(g), held: hp.inv.held ? hp.inv.held.id : null, armor: hp.inv.slots.slice(36, 40).map((s) => s && s.id), sneak: !!hp.sneaking, swing: hp.swingT > 0, pitch: hp.pitch, swim: !!hp.swimming }]);
    return { t: 'E', list: ents };
  }
  // a block changed in the host's world (game play, not generation): to the guests, and the chunk marked changed
  onBlock(x, y, z, id, meta, wl) { if (this.peers.size) this.blocks.push([x, y, z, id, meta, wl]); }
  // a light roster with measured RTTs: the Tab list and the room panel use it on host and guests
  hostName() { return this.g.playerName || (Account.loggedIn && Account.name) || this.g.settings.netName || '房主'; }
  // 逐个房客的模组权限：默认都关；房主在 房间 → 模组 里打开后立即发过去
  modPerm(name) {
    if (!this.modPerms) this.modPerms = new Map();
    return Object.assign({ chain: false, ore: false }, this.modPerms.get(String(name).toLowerCase()) || {});
  }
  setModPerm(name, key, on) {
    if (!this.modPerms) this.modPerms = new Map();
    const n = String(name).toLowerCase(), cur = this.modPerm(name);
    cur[key] = !!on; this.modPerms.set(n, cur);
    for (const p of this.peers.values()) if (p.joined && String(p.name).toLowerCase() === n && p.link && p.link.send) p.link.send({ t: 'modperm', perms: cur });
  }
  roster() {
    const out = [{ name: this.hostName(), ping: 0, host: true }];
    for (const p of this.peers.values()) if (p.joined) out.push({ name: p.name, ping: typeof p.latency === 'number' ? p.latency : null });
    return out;
  }
  sendRoster() { this.toAll({ t: 'roster', players: this.roster() }); }
  pingPeers() {
    for (const p of this.peers.values()) if (p.joined && p.link && p.link.send) {
      p.pingAt = performance.now();
      p.link.send({ t: 'ping', i: 'hp' + (this.pingSeq++) });
    }
  }
  kick(id) { const p = this.peers.get(id); if (!p) return; if (this.relay && this.relay.ws && this.relay.ws.readyState === 1) this.relay.ws.send(JSON.stringify({ t: 'kick', id })); else p.link.send({ t: 'kicked', reason: '房主请你离开了房间' }); setTimeout(() => this.dropPeer(id, '被房主请出了房间'), 300); }
  close() {
    this.state = 'closed';
    clearInterval(this.pollTimer);
    for (const p of this.peers.values()) { p.link.send({ t: 'closed' }); p.link.close(); if (p.avatar) p.avatar.dead = true; }
    this.peers.clear();
    if (this.relay) this.relay.close();
    else if (this.code && this.pid) p2pApi('leave', { code: this.code, peerId: this.pid }).catch(() => { });
    if (this.g.p2pHost === this) this.g.p2pHost = null;
  }
}

// ================================== the guest ==================================
class LocalGuest {
  constructor(g, code, name) { this.g = g; this.code = code; this.name = name; this.reqs = new Map(); this.nextReq = 1; this.mirrors = new Map(); this.picks = new Map(); this.beSnap = new Map(); this.outBlocks = []; this.state = 'connecting'; this.latency = null; this.pingSeq = 0; this.pingAt = 0; this.roster = null; this.looks = new Map(); this.lookKey = null; }
  async join() {
    let useRelay = typeof Relay !== 'undefined' && Relay.enabled();
    if (useRelay && Relay.backend) { try { useRelay = await Relay.backend(); } catch (e) { useRelay = true; } }
    if (useRelay) {
      this.state = 'connecting';
      return this.joinRelay().catch((e) => {
        // 兼容：房主可能还在旧版“本地房间”（PHP + WebRTC）页面，自动改走旧信令加入。
        try { this.relayGuest && this.relayGuest.close(); } catch (x) { }
        this.relayGuest = null; this.link = null; this.state = 'connecting';
        this.g.ui.message('房间连接暂时不通，正在尝试另一种连接方式…', '#FFD24A');
        return this.joinSignal().catch((e2) => {
          throw new Error('房间连接失败。房主可能已经离开，或网络暂时不通；请刷新页面后重新加入。');
        });
      });
    }
    return this.joinSignal();
  }
  // 中继房间：一条 WebSocket 走服务器，不受 NAT / 公网 IP 影响
  joinRelay() {
    return new Promise((res, rej) => {
      this.res = res; this.rej = rej; this.state = 'connecting';
      const G = this.relayGuest = new RelayGuest(this.code, this.name);
      G.join()
        .then((j) => {
          this.pid = j.peerId; this.hostName = j.host;
          this.link = G.attach((x) => this.onMsg(x), (st) => {
            if ((st === 'failed' || st === 'closed' || st === 'disconnected') && this.state !== 'left') this.lost(st === 'failed' ? '中继连接失败' : '和房主的中继连接断开了');
          });
          setTimeout(() => { if (this.state === 'connecting') this.lost('连接超时：房主可能不在，或中继服务器繁忙'); }, 30000);
          res();
        })
        .catch((e) => { this.state = 'left'; rej(new Error(e.message || '连不上中继服务器')); });
    });
  }
  joinSignal() {
    return new Promise((res, rej) => {
      this.res = res; this.rej = rej; this.state = 'connecting';
      p2pApi('join', { code: this.code, name: this.name })
        .then((j) => {
          this.pid = j.peerId; this.hostName = j.host;
          this.link = new P2PLink(j.ice, (x) => this.onMsg(x), (st) => {
            if ((st === 'failed' || st === 'closed' || st === 'disconnected') && this.state !== 'left') this.lost(st === 'failed' ? '没连上房主（网络不通：可以换个网络再试，或者让房主开服务器上的公开房间）' : '和房主的连接断开了');
          });
          const pc = this.link.make((d) => this.sig(d));
          pc.ondatachannel = (ev) => this.link.wire(ev.channel);
          this.startPoll();
          setTimeout(() => { if (this.state === 'connecting') this.lost('连接超时：房主的网络可能不通'); }, 30000);
          res();
        })
        .catch((e) => { this.state = 'left'; rej(new Error(e.message || '连不上游戏服务器')); });
    });
  }
  sig(data) { p2pApi('signal', { code: this.code, from: this.pid, to: 'host', data }).catch(() => { }); }
  startPoll() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(async () => {
      if (this.state === 'left') return;
      try { const j = await p2pApi('poll', { code: this.code, peerId: this.pid }); (j.messages || []).forEach((m) => this.onSignal(m)); } catch (e) { }
    }, p2pPollEvery);
  }
  onSignal(m) {
    if (m.t === 'signal') this.link && this.link.signal(m.data, (d) => this.sig(d)).catch((err) => console.warn('p2p', err));
    else if (m.t === 'closed') this.lost('房主关闭了房间');
  }
  lost(why) {
    if (this.state === 'left') return;
    const was = this.state; this.state = 'left';
    clearInterval(this.pollTimer);
    try { this.link && this.link.close(); } catch (e) { }
    try { this.relayGuest && this.relayGuest.close(); } catch (e) { }
    if (!this.relayGuest && was !== 'connecting' && this.code && this.pid) p2pApi('leave', { code: this.code, peerId: this.pid }).catch(() => { });
    const g = this.g;
    if (was === 'connecting') { this.rej && this.rej(new Error(why)); return; }
    if (g.p2pGuest === this) { g.p2pGuest = null; g.worldMeta = null; g.startTitle(); g.ui.open(new ConfirmScreen(g, '离开了联机房间', why, '返回标题画面', () => g.ui.open(new TitleScreen(g)))); }
  }
  leave() {
    if (this.state === 'left') return;
    this.sendState(true);
    this.state = 'left';
    clearInterval(this.pollTimer);
    if (this.relayGuest) this.relayGuest.close();
    else if (this.code && this.pid) p2pApi('leave', { code: this.code, peerId: this.pid }).catch(() => { });
    setTimeout(() => { try { this.link && this.link.close(); } catch (e) { } }, 300);
  }
  send(o) { return this.link && this.link.send(o); }
  // the host's world, as a world of this game: its store id makes the chunk reads go to the host
  async onWelcome(m) {
    const g = this.g, id = 'p2p~' + this.code;
    const permNorm = (p) => (typeof modPermNormalize === 'function' ? modPermNormalize(p) : { chain: !!(p && p.chain), ore: !!(p && p.ore) });
    this.modPerms = permNorm(m.modPerms);
    g.guestModPerms = this.modPerms; g._oreCache = null;
    this.meta = {
      id, name: m.name + '（联机）', seed: String(m.seed), gen: m.gen || 2, mode: m.mode, flat: !!m.flat, flatLayers: m.flatLayers, flatBiome: m.flatBiome, flatOpts: m.flatOpts, biome: m.biome, worldType: m.worldType, experiments: m.experiments, gameRules: m.gameRules || {},
      structures: m.structures !== false, difficulty: m.difficulty, hardcore: m.hardcore, cheats: true,
      time: m.time, weather: m.weather, rainTarget: m.rain, spawn: m.spawn, tutorial: -1, dims: { overworld: { blockEntities: Object.fromEntries(this.wbes || []), mobs: [] } },
      player: m.saved || null, created: Date.now(), lastPlayed: Date.now(),
    };
    this.keys = new Set(this.wkeys || []);
    for (const [k, be] of this.wbes || []) this.beSnap.set(k, beJson(be));
    this.roster = Array.isArray(m.roster) ? m.roster.slice() : [{ name: m.host || '房主', ping: 0, host: true }];
    if (!this.roster.some((p) => p.name === this.name)) this.roster.push({ name: this.name, ping: null });
    // skins already known when entering: the host and the other guests, each with its PNG when custom
    if (Array.isArray(m.looks)) for (const x of m.looks) { const l = p2pLook(x && x.look); if (l && x.name) this.looks.set(String(x.name), l); }
    if (m.hostLook) { const l = p2pLook(m.hostLook); if (l) this.looks.set(m.host || '房主', l); }
    g.p2pGuest = this; this.state = 'joined';
    await g.loadWorld(id);
    // 房客的页面往往不是从世界里的点击开始音效上下文；进房间后必须再初始化一次，否则整套 Sound.ctx 为空、
    // 连自己的走路/挖掘都没有声音（2026-11-23 房客反馈）。
    try { if (typeof Sound !== 'undefined') { Sound.init(); if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume(); } } catch (e) { }
    // a first visit: next to the host
    // 第一次进房：用房主所在的 XZ 柱子的真实地表高度出生，而不是房主坐标 +1/+0.5。
    // 房主刚落地、在斜坡边或站在树下时，+1/+0.5 会把房客塞进树干/山体，进世界满屏是方块内壁，
    // 看起来像“卡在地形下载”。surfaceY 是当前区块已经生成后的最高实体方块，脚站在它上面一定在空气里。
    if (!m.saved && m.near) {
      const p = g.player, wx = Math.floor(m.near[0]), wz = Math.floor(m.near[2]);
      let wy = g.world.surfaceY(wx, wz) + 1;
      if (!(wy > 1)) wy = m.near[1] + 2;
      p.pos = [wx + 0.5, wy, wz + 0.5]; p.prev = [...p.pos]; p.spawn = m.spawn;
    }
    if (m.sponsor && m.sponsor.text) g.pendingPin = { text: String(m.sponsor.text).slice(0, 80), ms: clamp(+m.sponsor.seconds || 30, 0, 300) * 1000 };
    g.ui.message(`已进入 ${m.host} 的联机房间` + (m.players && m.players.length ? `（还有 ${m.players.join('、')}）` : ''), '#55FF55');
    this.res && this.res();
  }
  onMsg(m) {
    const g = this.g;
    if (m.t === 'rules') { g.gameRules = Object.assign({}, m.rules || {}); if (g.worldMeta) g.worldMeta.gameRules = Object.assign({}, g.gameRules); return; }
    if (m instanceof Uint8Array) {
      const id = m.length >= 5 ? new DataView(m.buffer, m.byteOffset).getUint32(1) : -1, r = this.reqs.get(id);
      if (m[0] === 1) { if (r) { this.reqs.delete(id); r(m.length > 5 ? p2pUnpackChunk(m.subarray(5)) : null); } }
      // a chunk in pieces (p2pFrames): put together at the last one
      else if (m[0] === 2 && r && m.length > 6) {
        const ps = this.pieces || (this.pieces = new Map()), l = ps.get(id) || []; l.push(m.slice(6));
        if (!m[5]) { ps.set(id, l); return; }
        ps.delete(id); this.reqs.delete(id);
        const all = new Uint8Array(l.reduce((s, b) => s + b.length, 0)); let o = 0; for (const b of l) { all.set(b, o); o += b.length; }
        // (its length as its header says, or nothing: a piece lost on the way gave a chunk of shifted blocks)
        const dv = all.length >= 12 ? new DataView(all.buffer) : null;
        r(dv && 12 + dv.getUint32(0) * 2 + dv.getUint32(4) * 2 + dv.getUint32(8) * 4 === all.length ? p2pUnpackChunk(all) : null);
      }
      return;
    }
    switch (m.t) {
      case 'wkeys': (this.wkeys || (this.wkeys = [])).push(...m.list); break;
      case 'wbes': (this.wbes || (this.wbes = [])).push(...m.list); break;
      // 房主（及其他房客经房主转来）的声音，在本机同一套音效引擎里播放
      case 'snd': if (window.p2pPlaySound) window.p2pPlaySound(m); break;
      // RTT：房主回 pong；房主广播的 roster 里有所有人的延迟（房主自己的不算）
      case 'ping': this.send({ t: 'pong', i: m.i }); break;
      case 'pong': if (typeof m.i === 'string' && m.i[0] === 'g' && this.pingAt) {
        this.latency = Math.max(0, Math.round(performance.now() - this.pingAt)); this.pingAt = 0;
      } break;
      case 'roster': if (Array.isArray(m.players)) this.roster = m.players; break;
      case 'modperm': {
        this.modPerms = (typeof modPermNormalize === 'function' ? modPermNormalize(m.perms) : { chain: !!(m.perms && m.perms.chain), ore: !!(m.perms && m.perms.ore) }); g.guestModPerms = this.modPerms; g._oreCache = null;
        const on = Object.keys(this.modPerms).filter((k) => this.modPerms[k]);
        g.ui.message(on.length ? '房主允许你使用：' + (this.modPerms.chain ? '连锁挖掘 ' : '') + (this.modPerms.ore ? '矿透视' : '') : '房主关闭了你的模组权限', on.length ? '#55FF55' : '#FFAA00');
        break;
      }
      case 'look': {
        const l = p2pLook(m.look), name = String(m.name || '');
        if (!l || !name) break;
        this.looks.set(name, l);
        for (const e of g.entities) if (e.type === 'player' && e.name === name) e.look = l;
        break;
      }
      case 'welcome': this.onWelcome(m).catch((e) => this.lost('进入失败：' + e.message)); break;
      case 'B': {
        const w = g.world; if (!w || g.worldMeta !== this.meta) break;
        p2pBlocks.applying++;
        try {
          for (const [x, y, z, id, meta, wl] of m.list) {
            const k = ckey(x >> 4, z >> 4);
            this.keys.add(k); if (w.savedIndex) w.savedIndex.add(k);
            if (w.chunks.has(k)) { w.setBlock(x, y, z, id, meta, 3); if (wl !== undefined) w.setWaterlogged(x, y, z, !!wl); }
            else if (w.savedChunks) w.savedChunks.delete(k); // (read again from the host when it loads)
          }
        } finally { p2pBlocks.applying--; }
        break;
      }
      case 'be': if (beKey(m.k) && m.data) { const be = g.blockEntities.get(m.k); if (be) { for (const k in m.data) be[k] = m.data[k]; } else g.blockEntities.set(m.k, m.data); this.beSnap.set(m.k, beJson(g.blockEntities.get(m.k))); } break;
      case 'E': {
        if (!Array.isArray(m.list)) break;
        if (m.more) { (this.eParts || (this.eParts = [])).push(...m.list); break; }
        const list = this.eParts ? this.eParts.concat(m.list) : m.list; this.eParts = null;
        this.onEntities(list); break;
      }
      case 'env': g.worldTime = m.time; g.weather = m.weather; g.rainTarget = m.rain; g.difficulty = m.difficulty; break;
      case 'hurt': {
        const p = g.player; if (!p || p.deathTime > 0) break;
        const from = m.from ? { pos: m.from, type: 'mob', name: m.name } : null;
        try { p.hurt(m.dmg, { type: m.kind === 'player' ? 'player' : m.kind || 'mob', attacker: from, entity: from }); } catch (e) { p.hurt(m.dmg, { type: 'generic' }); }
        break;
      }
      // what didn't fit goes back to the host's world (inv.add returns the count left: the old check, left.count, was
      // never true - the rest was lost); an item this game doesn't have goes back whole
      case 'give': {
        if (!m.stack || typeof m.stack !== 'object') break;
        const st = knownStack({ ...m.stack }, g, 'p2p give'), left = st ? g.player.inv.add(st) : m.stack.count | 0;
        if (st && left < st.count) Sound.ev && Sound.ev('entity.item.pickup', null, 0.2, 1.5);
        if (left > 0) this.send({ t: 'drop', stack: { ...(st || m.stack), count: left }, pos: g.player.pos.slice(0, 3) });
        break;
      }
      case 'xp': g.addXp(m.n | 0); Sound.ev && Sound.ev('entity.experience_orb.pickup', null, 0.1, 1); break;
      case 'chat': g.ui.message(m.sys ? m.text : `<${m.name}> ${m.text}`, m.sys ? '#FFFF55' : '#FFFFFF'); break;
      case 'mark': Marks.add(String(m.name).slice(0, 16), (m.pos || []).map((v) => v | 0)); g.ui.message(`${m.name} 标记了一个位置`, '#FFD24A'); break;
      case 'kicked': this.lost(m.reason || '房主请你离开了房间'); break;
      case 'closed': this.lost('房主关闭了房间'); break;
    }
  }
  // the host's entities, as mirrors: made, moved, removed
  onEntities(list) {
    const g = this.g, seen = new Set(), live = new Set(g.entities);
    for (const r of list) {
      if (!Array.isArray(r)) continue;
      const [id, type, x, y, z, yaw, d] = r;
      if (![x, y, z].every(Number.isFinite) || (type === 'player' && !(d && typeof d === 'object'))) continue;
      // (a dropped item as this game has it, or not at all: the mirror's stack was taken as sent, with no check -
      // an item of a newer version threw wherever it was drawn or read)
      const st = type === 'item' ? d && knownStack({ id: d.id, count: d.n || 1, dmg: 0 }, g, 'p2p item') : null;
      if (type === 'item' && !st) continue;
      seen.add(id);
      let e = this.mirrors.get(id);
      // a mirror no longer in the world (its tick threw 5 times running - tickEntity drops those -, or it finished
      // dying): made again. It was kept and moved, never drawn - a player seen once and then never again
      if (e && (e.dead || !live.has(e) || e.mirrorType !== type)) { if (e.mirrorType === type && e.deathTime > 0 && d && d.dt) continue; e.dead = true; e = null; }
      if (!e) {
        if (type === 'player') e = new NetPlayer(g, x, y, z, d.name);
        else if (type === 'item') { e = new ItemEntity(g, x, y, z, st, [0, 0, 0]); e.tick = netItemTick; e.pickup = 1e9; }
        else if (type === 'xp') { e = new ExperienceOrb(g, x, y, z, d.v || 1); e.tick = netItemTick; }
        else { try { e = createMob(g, type, x, y, z); } catch (err) { e = null; } if (!e) continue; }
        e.p2pMirror = true; e.p2pId = id; e.mirrorType = type; e.remote = true; e.alwaysTick = true; e.persistent = false;
        if (type !== 'item' && type !== 'xp') e.tick = netEntityTick;
        e.netPos = [x, y, z]; e.lerpN = 0; e.netYaw = e.yaw = e.bodyYaw = e.prevBodyYaw = yaw;
        // hitting a mirror hits the host's mob
        if (type !== 'item' && type !== 'xp') e.hurt = (dmg, src) => { if (type === 'player') return false; const p = g.player, k = [e.pos[0] - p.pos[0], e.pos[2] - p.pos[2]]; this.send({ t: 'hit', id, dmg, kb: k }); e.hurtTime = 10; return true; };
        g.entities.push(e); this.mirrors.set(id, e);
      }
      e.netPos = [x, y, z]; e.lerpN = 3; e.netYaw = yaw;
      if (type === 'player') { e.name = String(d.name || '?').slice(0, 32); e.look = p2pLook(d.look) || this.looks.get(e.name) || null; e.heldId = p2pItem(d.held); e.armorItems = (Array.isArray(d.armor) ? d.armor : []).map((i) => (p2pItem(i) == null ? null : { id: i, count: 1 })); e.sneaking = d.sneak; if (d.swing && !(e.swingT > 0)) e.swingT = 6; e.netPitch = d.pitch; e.netHead = yaw; e.netSwim = d.swim; }
      else if (d && type !== 'item' && type !== 'xp') {
        e.netHead = yaw + (d.h || 0); e.netPitch = d.p; e.limbSwing = d.ls; e.limbAmt = d.la; e.prevLimb = d.ls;
        if (d.baby) e.baby = true; e.sheared = !!d.sh; e.woolColor = d.wc; if (d.sz !== undefined) e.size = d.sz; if (d.fuse !== undefined) e.fuse = d.fuse;
        if (d.ht > (e.hurtTime || 0)) e.hurtTime = d.ht; if (d.dt && !e.deathTime) e.deathTime = 1; if (d.sw) e.swingT = d.sw; e.heldId = p2pItem(d.held); if (d.name) e.customName = d.name;
      } else if (type === 'item' && (!e.stack || e.stack.id !== st.id || e.stack.count !== st.count)) e.stack = st;
    }
    for (const [id, e] of this.mirrors) if (!seen.has(id)) { if (!(e.deathTime > 0)) e.dead = true; this.mirrors.delete(id); this.picks.delete(id); }
  }
  // this player, ten times a second
  sendState(final) {
    const g = this.g, p = g.player; if (!p) return;
    const m = { t: 'state', pos: p.pos.map((v) => +v.toFixed(2)), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), sneak: !!p.sneaking, swing: p.swingT > 0, held: p.inv.held ? p.inv.held.id : null,
      armor: p.inv.slots.slice(36, 40).map((s) => s && s.id), mode: g.mode, dead: p.deathTime > 0, flying: !!p.flying, swim: !!p.swimming };
    // (the look is big with a custom skin's PNG: only the first state and after a change carry it)
    const key = Skins.key(g);
    if (final || key !== this.lookKey) { this.lookKey = key; m.look = Skins.share(g); }
    this.send(m);
    if (final || g.tickCount % 200 === 0) this.send({ t: 'pstate', data: { pos: [...p.pos], yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, sat: p.saturation, xp: p.xp, inv: p.inv.slots, sel: p.inv.sel, flying: p.flying, effects: [] } });
  }
  // the guest's own tick: the player and the mirrors; the host simulates the world
  tick() {
    const g = this.g, p = g.player;
    if (this.state === 'joined' && g.tickCount % 100 === 0) {
      this.pingAt = performance.now();
      this.send({ t: 'ping', i: 'gp' + (this.pingSeq++) });
    }
    // (each part on its own: a throw in one skipped the rest of the tick - the dead mirrors stayed in the world, as
    // game.js's tick returns before its own clean-up for a guest)
    if (g.tickCount % 2 === 0) g.guard('p2p state', () => this.sendState());
    for (const e of g.entities) if (!e.dead) g.tickEntity(e);
    g.entities = g.entities.filter((e) => !e.dead);
    g.guard('particles', () => g.particles.tick());
    if (g.dim === 'overworld' && g.weather > 0.2 && g.tickCount % 2 === 0) g.guard('rain', () => g.rainParticles());
    // items and orbs within reach: asked for (the host gives them if they are still there); an item only with room for
    // it (vanilla: a full inventory leaves it on the ground - asked for anyway it came, went back, and came again)
    const fits = (st) => { const ms = maxStack(st.id); for (let i = 0; i < 36; i++) { const s = p.inv.slots[i]; if (!s || (sameKind(s, st) && s.count < ms && !ITEMS[s.id].durability)) return true; } return false; };
    for (const [id, e] of this.mirrors) {
      if (!(e instanceof ItemEntity || e instanceof ExperienceOrb) || e.dead || p.deathTime > 0 || g.mode === 'spectator') continue;
      if (Math.hypot(e.pos[0] - p.pos[0], e.pos[1] + 0.25 - (p.pos[1] + 0.9), e.pos[2] - p.pos[2]) > 1.6) continue;
      if (e instanceof ItemEntity && !(e.stack && ITEMS[e.stack.id] && fits(e.stack))) continue;
      const t = this.picks.get(id) || 0; if (performance.now() - t < 600) continue;
      this.picks.set(id, performance.now()); this.send({ t: 'pickup', id });
    }
    if (this.outBlocks.length && this.link) p2pSendList(this.link, 'b', this.outBlocks.splice(0));
    // block entities this player changed (a chest it put things in): to the host
    if (g.tickCount % 10 === 0) for (const [k, be] of g.blockEntities) {
      if (!beKey(k)) continue;
      const j = beJson(be);
      if (this.beSnap.get(k) !== j) { this.beSnap.set(k, j); this.send({ t: 'be', k, data: JSON.parse(j) }); }
    }
    // 房客的世界没有走 Game.tickWorld：必须在这里更新听者位置，否则远端音效全按 (0,0,0) 计算距离
    try { if (typeof Sound !== 'undefined') Sound.listener = { x: p.pos[0], y: p.pos[1] + 1.6, z: p.pos[2], yaw: p.yaw }; } catch (e) { }
  }
  // a chunk the host's world changed: read from the host
  requestChunk(cx, cz) {
    // 同一个区块被视野、存档加载和镜像同时请求时只发一次；否则一次飞行会产生几十个重复请求，
    // 每个都要等房主回一整块数据，客人这边看起来就是“卡住”。
    this.chunkPending = this.chunkPending || new Map();
    const key = cx + ',' + cz, old = this.chunkPending.get(key);
    if (old) return old;
    const promise = new Promise((res) => {
      const id = this.nextReq++;
      this.reqs.set(id, res);
      if (!this.send({ t: 'chunk', id, cx, cz })) { this.reqs.delete(id); this.chunkPending.delete(key); res(null); }
      // 房主后台标签页 / 手机网络慢时，一块存档区块可能几十秒才回；房客不能把整个 3×3 都押在
      // 这一块上。3 秒没回就先按本地种子生成，房主之后真回了也不会再改这块（未修改区块两边一致）。
      setTimeout(() => { if (this.reqs.has(id)) { this.reqs.delete(id); if (this.pieces) this.pieces.delete(id); this.chunkPending.delete(key); res(null); } }, 3000);
    });
    this.chunkPending.set(key, promise);
    promise.then(() => this.chunkPending.delete(key), () => this.chunkPending.delete(key));
    return promise;
  }
}

// ---- the game around them ----
(() => {
  // the guest's world lives in the host: its store reads go there, nothing of it is saved here
  const isP2P = (id) => typeof id === 'string' && id.startsWith('p2p~');
  const gw = DB.getWorld.bind(DB), pw = DB.putWorld.bind(DB), pc = DB.putChunks.bind(DB), gc = DB.getChunk.bind(DB), ck = DB.chunkKeys.bind(DB);
  DB.getWorld = (id) => (isP2P(id) ? Promise.resolve(game.p2pGuest && game.p2pGuest.meta) : gw(id));
  DB.putWorld = (w) => (isP2P(w && w.id) ? Promise.resolve() : pw(w));
  DB.putChunks = (id, list) => (isP2P(id) ? Promise.resolve() : pc(id, list));
  DB.chunkKeys = (id) => { if (!isP2P(id)) return ck(id); const G = game.p2pGuest, out = new Set(); if (G && !id.includes('~nether') && !/~end$/.test(id.replace(/^p2p~/, ''))) for (const k of G.keys) out.add(k); return Promise.resolve(out); };
  DB.getChunk = (id, cx, cz) => (isP2P(id) ? (game.p2pGuest ? game.p2pGuest.requestChunk(cx, cz) : Promise.resolve(undefined)) : gc(id, cx, cz));
  // block changes: the host's go to the guests; the guest's to the host (unless they came from there)
  const sb = World.prototype.setBlock, sm = World.prototype.setMeta, swl = World.prototype.setWaterlogged;
  const relay = (w, x, y, z) => {
    const g = typeof game !== 'undefined' && game; if (!g || g.world !== w) return;
    const id = w.getBlock(x, y, z), meta = w.getMeta(x, y, z), wl = w.isWaterlogged(x, y, z) ? 1 : 0;
    if (g.p2pHost) g.p2pHost.onBlock(x, y, z, id, meta, wl);
    else if (g.p2pGuest && !p2pBlocks.applying && g.p2pGuest.state === 'joined') g.p2pGuest.outBlocks.push([x, y, z, id, meta, wl]);
  };
  World.prototype.setBlock = function (x, y, z, ...a) { const r = sb.call(this, x, y, z, ...a); if (r !== false) relay(this, x, y, z); return r; };
  World.prototype.setMeta = function (x, y, z, meta) { const before = this.getMeta(x, y, z); const r = sm.call(this, x, y, z, meta); if (before !== meta) relay(this, x, y, z); return r; };
  World.prototype.setWaterlogged = function (x, y, z, v) { const r = swl.call(this, x, y, z, v); relay(this, x, y, z); return r; };
  // a guest's dropped items land in the host's world (anyone may pick them up)
  const di = Game.prototype.dropItem;
  Game.prototype.dropItem = function (x, y, z, stack, vel) {
    if (this.p2pGuest && this.p2pGuest.state === 'joined' && stack && stack.count > 0) { this.p2pGuest.send({ t: 'drop', stack: { ...stack }, pos: [x, y, z], vel }); return null; }
    return di.call(this, x, y, z, stack, vel);
  };
  // the host's hostile mobs: each one's tick sees its nearest player as "the player" (who it chases, hits, and whose
  // distance keeps it from despawning)
  const te = Game.prototype.tickEntity;
  Game.prototype.tickEntity = function (e) {
    const H = this.p2pHost;
    if (!H || !H.peers.size || !(e instanceof Mob) || e instanceof GuestAvatar || !(e.T && e.T.hostile)) return te.call(this, e);
    let best = this.player, bd = e.distTo(this.player);
    for (const p of H.peers.values()) { const a = p.avatar; if (a && !a.dead && !a.deadGuest && !a.creative && !a.spectator) { const d = e.distTo(a); if (d < bd) { bd = d; best = a; } } }
    if (best === this.player) return te.call(this, e);
    const hp = this.player; this.player = best;
    try { return te.call(this, e); } finally { this.player = hp; }
  };
  // while a room is open nothing pauses the world (the others go on playing). For the tick the screen's pauses is an
  // own property false, put back as it was after: a screen whose pauses is a getter only (物品图鉴) can't be assigned -
  // the throw skipped the whole tick, so the host's world stood still for everyone while it was open (telemetry
  // 11-02/03: 94 devices, 21,464 times; iOS 'Attempted to assign to readonly property', 18)
  const tick = Game.prototype.tick;
  Game.prototype.tick = function () {
    const sc = this.ui && this.ui.screen, hold = sc && sc.pauses && (this.p2pHost || this.p2pGuest);
    const own = hold ? Object.getOwnPropertyDescriptor(sc, 'pauses') : null;
    if (hold) try { Object.defineProperty(sc, 'pauses', { value: false, writable: true, configurable: true }); } catch (e) { }
    try { tick.call(this); } finally { if (hold) try { if (own) Object.defineProperty(sc, 'pauses', own); else delete sc.pauses; } catch (e) { } }
    if (this.p2pHost && this.state === 'play') this.guard('p2p host', () => this.p2pHost.tick());
  };
  // chat: a guest's goes to the host; the host's (not commands) to the guests
  const rc = runCommand;
  runCommand = function (g, text) {
    // 本地房间的客人也允许执行命令：命令在客人本地执行，setblock/fill 等改动仍经 World.setBlock
    // 回到房主；这样 /gamemode、/tp、/give、计分板等不会因为“在房间里”而完全失效。
    if (g.p2pGuest) { if (text.startsWith('/')) return rc(g, text); g.ui.message(`<${g.p2pGuest.name}> ${text}`); g.p2pGuest.send({ t: 'chat', text }); return; }
    if (g.p2pHost && !text.startsWith('/')) { const n = g.playerName || (Account.loggedIn && Account.name) || '房主'; g.ui.message(`<${n}> ${text}`); g.p2pHost.toAll({ t: 'chat', name: n, text }); return; }
    return rc(g, text);
  };
  // markers in a local room go through the host
  const mp = Marks.place;
  Marks.place = function (g) {
    if (g.p2pGuest || g.p2pHost) {
      const t = g.target, pos = t ? [...t.pos] : g.player.pos.map(Math.floor), me = g.p2pGuest ? g.p2pGuest.name : (Account.loggedIn && Account.name) || '房主';
      if (g.p2pGuest) g.p2pGuest.send({ t: 'mark', pos }); else g.p2pHost.toAll({ t: 'mark', name: me, pos });
      Marks.add(me, pos, '#55FF55'); return;
    }
    return mp.call(this, g);
  };
  // other dimensions: guests stay in the overworld, and the host stays with them
  const cd = Game.prototype.changeDimension;
  Game.prototype.changeDimension = function (...a) {
    if (this.p2pGuest) { this.ui.pinMessage('联机房间里客人暂时不能去其他维度', 3000, '#FF8080'); return; }
    if (this.p2pHost && this.p2pHost.peers.size) { this.ui.pinMessage('房间里有朋友时不能去其他维度（先关掉联机房间）', 3000, '#FF8080'); return; }
    return cd.apply(this, a);
  };
  // leaving: the host closes the room, a guest leaves it (its inventory stays with the host's world)
  const q = Game.prototype.quitToTitle;
  Game.prototype.quitToTitle = async function () {
    if (this.p2pGuest) { const G = this.p2pGuest; G.leave(); this.p2pGuest = null; this.worldMeta = null; this.startTitle(); return; }
    if (this.p2pHost) this.p2pHost.close();
    return q.call(this);
  };
  // the other players' names over their heads, as on a server (vanilla's name tags: a fixed size, faint through walls,
  // dimmed while sneaking - net.js drawNames). A local room drew none: a friend behind a hill or a wall was nowhere to
  // be found ("玩家进入不会显示模型看不到名字", "房主看不到房间成员名字和实体", feedback 11-01 / 11-02)
  const den = Game.prototype.drawEntities;
  Game.prototype.drawEntities = function (a, env) {
    const r = den.call(this, a, env);
    if ((this.p2pHost || this.p2pGuest) && !this.net && !this.ui.hideHud && this.state === 'play') try { NetClient.prototype.drawNames.call({ g: this }, a); } catch (err) { this.reportError('name tags', err, true); }
    return r;
  };
  // a guest's own tick (the world is the host's): in game.js tick, where the server branch is
  // saving a guest's world does nothing here (the host keeps it)
  const sw = Game.prototype.saveWorld;
  Game.prototype.saveWorld = async function (quiet) { if (this.p2pGuest) { this.p2pGuest.sendState(true); return; } return sw.call(this, quiet); };
})();

// ================================== the screens ==================================
// 开本地房间: the warning, the device check, the invite code
class LocalRoomScreen extends FormScreen {
  constructor(game, parent, code = '') {
    super(game, '开联机房间', parent); this.pauses = false; this.titleY = 8; this.code = code || ''; this.busy = false;
    const fps = game.fps || 0, mem = navigator.deviceMemory || 8;
    this.weak = (fps && fps < 30) || mem <= 2 || TouchDevice.kind === 'phone';
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = {};
    this.addField('code', cx - 100, u.h - 82, 200, '邀请码（6–12 位英文字母或数字，朋友输入它来加入）', 12, (v) => v.replace(/[^A-Za-z0-9]/g, '').slice(0, 12));
    this.widgets = [
      { x: cx - 100, y: u.h - 54, w: 98, h: 20, gold: true, label: () => (this.busy ? '正在开房间…' : '我知道了，开房间'), enabled: !this.busy, onClick: () => this.submit() },
      { x: cx + 2, y: u.h - 54, w: 98, h: 20, label: '随机邀请码', onClick: () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += A[(Math.random() * A.length) | 0]; this.code = s; this.layout(); } },
      { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '返回', onClick: () => this.back() },
    ];
    // 手机上打开开房页不再自动聚焦邀请码：旧版会立刻弹输入法，底部按钮被键盘顶住，看起来像退不出去。
    if (!(typeof TouchDevice !== 'undefined' && (TouchDevice.kind === 'phone' || TouchDevice.kind === 'tablet'))) this.focus('code');
  }
  async submit() {
    const g = this.game;
    if (!/^[A-Za-z0-9]{6,12}$/.test(this.code)) { this.say('邀请码要 6–12 位英文字母或数字', true); return; }
    this.busy = true; this.say('正在开房间…'); this.layout();
    const meta = g.worldMeta || {}, roomTitle = (meta.name || (Account.loggedIn && Account.name) || g.settings.netName || '玩家') + '的房间';
    const h = new LocalHost(g, this.code, { public: true, title: roomTitle, max: 4, mode: meta.mode || 'survival', difficulty: meta.difficulty != null ? ['peaceful','easy','normal','hard'][meta.difficulty] || 'normal' : 'normal', flat: !!meta.flat });
    try { await h.open(); g.p2pHost = h; this.code = h.code; g.ui.hideInput(); g.ui.close(); g.ui.message(`联机房间已经开好：邀请码 ${this.code}（暂停 → 房间 可以复制邀请、查看在场的人）`, '#55FF55'); Telemetry.count && Telemetry.count('p2p_host'); }
    catch (e) {
      // 手机端点“开房间”后如果服务端不可用，原来只在输入框下面闪一行红字，键盘还开着，
      // 底部的“返回”被键盘/安全区挡住，看起来像进了一个退不出去的错误页。
      // 现在收起键盘并打开独立的错误页，按钮放在屏幕中部，返回永远可点。
      this.busy = false; g.ui.hideInput();
      g.ui.open(new LocalRoomErrorScreen(g, this.parent, e && e.message ? e.message : '连不上游戏服务器', this.code));
    }
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, w = Math.min(340, ui.w - 16), x = Math.floor(cx - w / 2);
    drawCard(c, x, 22, w, 92, true);
    const lines = [['联机房间由房主浏览器运行整个世界，朋友通过邀请码加入：', '#FFD24A'], ['手机 / 电脑会更耗电、发热，人多时可能卡顿；你的网络不好时，其他人也会卡；', '#FFFFFF'],
      ['你关掉游戏、切到后台或者断网，房间里所有人都会被断开。', '#FF8080'], ['建议：用电脑 + 有线或稳定的 Wi-Fi。联机房间最多 4 人（含你），同一 Wi-Fi 也可局域网直连。', '#A0A0A0'],
      ['朋友在时你不能去下界 / 末地；朋友的背包会保存在你的存档里。', '#A0A0A0']];
    let y = 28;
    for (const [t, col] of lines) { let s = t; while (s.length) { let n = s.length; while (n > 1 && Font.width(s.slice(0, n)) > w - 12) n--; Font.draw(c, s.slice(0, n), x + 6, y, col); s = s.slice(n); y += 10; } }
    if (this.weak) Font.center(c, fitText(TouchDevice.kind === 'phone' ? '在手机上开房间不太推荐：发热和后台断开都很常见' : '你的设备现在帧率偏低，不太推荐开本地房间', ui.w - 8), cx, 118, '#FF8080');
    this.drawFields(ui);
  }
}
// 开房失败：独立错误页，重试 / 返回；手机上不再把按钮压在输入法或屏幕圆角下面
class LocalRoomErrorScreen extends MenuScreen {
  constructor(game, parent, message, code) {
    super(game, '没能开联机房间'); this.parent = parent; this.message = String(message || '连不上游戏服务器'); this.code = code || ''; this.pauses = false; this.titleY = 10;
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, phone = TouchDevice.kind === 'phone';
    const w = Math.min(phone ? 300 : 330, u.w - 20);
    const by = Math.max(150, Math.min(u.h - (phone ? 104 : 82), Math.floor(u.h / 2) + 22));
    this.widgets = [
      { x: cx - w / 2, y: by, w, h: 26, gold: true, label: '重试', onClick: () => { this.game.ui.hideInput(); this.game.ui.open(new LocalRoomScreen(this.game, this.parent, this.code)); } },
      { x: cx - w / 2, y: by + 32, w, h: 26, label: '返回', onClick: () => this.back() },
    ];
    this.card = { x: cx - w / 2, y: Math.max(24, by - 116), w, h: 104 };
  }
  drawExtra(ui) {
    const c = ui.ctx, C = this.card;
    c.fillStyle = 'rgba(16,16,16,.90)'; c.fillRect(C.x, C.y, C.w, C.h);
    c.strokeStyle = '#7a2020'; c.lineWidth = 2; c.strokeRect(C.x + 1, C.y + 1, C.w - 2, C.h - 2);
    Font.center(c, '开房失败', ui.w / 2, C.y + 8, '#FF8080');
    const hint = this.message;
    let line = '', y = C.y + 24;
    for (const ch of hint) {
      if (ch === '\n' || Font.width(line + ch) > C.w - 16) { Font.center(c, line, ui.w / 2, y, '#FFFFFF'); line = ''; y += 11; if (y > C.y + C.h - 20) break; }
      if (ch !== '\n') line += ch;
    }
    if (line && y <= C.y + C.h - 20) Font.center(c, line, ui.w / 2, y, '#FFFFFF');
    Font.center(c, fitText('请稍后重试；也可以返回多人游戏，用邀请码加入', C.w - 12), ui.w / 2, C.y + C.h - 12, '#A0A0A0');
  }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent || new TitleScreen(this.game)); }
  onEsc() { this.back(); }
}

// 本地房间 (pause menu, hosting): the code, who is in, sending someone away, closing the room
class LocalRoomStatusScreen extends MenuScreen {
  constructor(game, parent) { super(game, '联机房间'); this.parent = parent; this.pauses = false; this.titleY = 10; this.note = ''; this.lan = null; this.lanTried = false; }
  get H() { return this.game.p2pHost; }
  fetchLan() {
    if (this.lanTried) return; this.lanTried = true;
    fetch('/api/lan').then((r) => r.json()).then((j) => { this.lan = (j.urls || []).filter((x) => !x.ip.startsWith('169.254.')); this.layout(); }).catch(() => { });
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, H = this.H;
    this.fetchLan();
    this.widgets = [];
    const compact = u.h < 220;
    if (H) {
      // 四个按钮横排：邀请、邀请码、设置、关闭；手机上不再把“完成”和邀请码挤在底部
      const bw = compact ? 72 : 72, gap = 4, x0 = Math.floor(cx - (bw * 4 + gap * 3) / 2);
      this.widgets.push(
        { x: x0, y: compact ? 22 : 30, w: bw, h: 18, gold: true, label: '复制邀请', onClick: async () => { this.note = (await copyText(`来我的 OpusMC 联机房间玩：多人游戏 → 输入邀请码 ${H.code}`)) ? '已复制，发给朋友吧' : '复制失败：邀请码 ' + H.code; } },
        { x: x0 + bw + gap, y: compact ? 22 : 30, w: bw, h: 18, label: '邀请码', onClick: async () => { this.note = (await copyText(H.code)) ? '邀请码已复制' : '复制失败'; } },
        { x: x0 + (bw + gap) * 2, y: compact ? 22 : 30, w: bw, h: 18, label: '设置', onClick: () => this.game.ui.open(new RoomSettingsScreen(this.game, this, H)) },
        { x: x0 + (bw + gap) * 3, y: compact ? 22 : 30, w: bw, h: 18, label: '关闭', onClick: () => { H.close(); this.game.ui.message('联机房间已关闭', '#AAAAAA'); this.game.ui.open(this.parent); } },
      );
      [...H.peers.values()].filter((p) => p.joined).forEach((p, i) => this.widgets.push({ x: cx + 82, y: (compact ? 76 : 80) + i * (compact ? 16 : 18), w: 56, h: compact ? 14 : 16, label: '请离开', onClick: () => { H.kick(p.id); setTimeout(() => this.layout(), 400); } }));
      if (this.lan && this.lan.length) this.widgets.push({ x: cx - 100, y: u.h - (compact ? 44 : 52), w: 200, h: 16, label: '复制局域网地址', onClick: async () => { this.note = (await copyText(this.lan[0].url)) ? '局域网地址已复制' : '复制失败：' + this.lan[0].url; } });
    }
    this.widgets.push({ x: cx - 100, y: u.h - 22, w: 200, h: 18, label: '完成', onClick: () => this.game.ui.open(this.parent) });
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, H = this.H;
    if (!H) { Font.center(c, '没有开联机房间', cx, 50, '#A0A0A0'); return; }
    const compact = ui.h < 220;
    const ps = [...H.peers.values()].filter((p) => p.joined);
    Font.draw(c, `邀请码 ${H.code}　${ps.length + 1}/${H.max} 人　${H.public ? '公开' : '不公开'}`, cx - 152, compact ? 46 : 54, '#FFFF55');
    Font.draw(c, this.lan && this.lan.length ? '同一 Wi-Fi：' + this.lan[0].url : '同一 Wi-Fi：正在读取本机地址…', cx - 152, compact ? 60 : 66, '#80FF80');
    const rows = [{ name: ((Account.loggedIn && Account.name) || '你') + '（房主）', host: true }, ...ps];
    rows.forEach((p, i) => {
      const y = (compact ? 76 : 80) + i * (compact ? 16 : 18), h = compact ? 14 : 16;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 152, y, 290, h);
      Font.draw(c, fitText(i === 0 ? p.name : p.name, 180), cx - 148, y + (compact ? 3 : 4), '#FFFFFF');
      const txt = i === 0 ? '房主' : typeof p.latency === 'number' ? p.latency + 'ms' : '…';
      Font.draw(c, txt, cx + 50, y + (compact ? 3 : 4), typeof p.latency === 'number' && p.latency > 300 ? '#FF8080' : '#80FF80');
    });
    if (!ps.length) Font.draw(c, '把邀请码发给朋友；同一 Wi-Fi 可直接打开上面的局域网地址', cx - 152, (compact ? 76 : 80) + (compact ? 20 : 24), '#A0A0A0');
    if (this.note) Font.center(c, this.note, cx, ui.h - (compact ? 32 : 38), '#80FF80');
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 房间设置：公开 / 人数 / 房间名。房主可以随时改，公开房间列表会跟着更新。
class RoomSettingsScreen extends FormScreen {
  constructor(game, parent, host) { super(game, '房间设置', parent); this.host = host; this.title = host.title || '我的世界'; this.max = host.max || 4; this.public = host.public !== false; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.fields = {};
    this.addField('title', cx - 100, 54, 200, '房间名（公开列表里显示）', 32, (v) => v.slice(0, 32));
    const sizes = [2, 4, 6, 8, 10];
    this.widgets = [
      { x: cx - 100, y: 86, w: 98, h: 18, label: () => '公开房间：' + (this.public ? '开' : '关'), onClick: () => { this.public = !this.public; } },
      { x: cx + 2, y: 86, w: 98, h: 18, label: () => '人数：' + this.max, tip: ['包括房主；人数越多，房主浏览器负担越大'], onClick: () => { this.max = sizes[(sizes.indexOf(this.max) + 1) % sizes.length]; } },
      { x: cx - 100, y: u.h - 52, w: 200, h: 18, gold: true, label: '应用设置', onClick: () => this.apply() },
      { x: cx - 100, y: u.h - 30, w: 200, h: 18, label: '返回', onClick: () => this.game.ui.open(this.parent) },
    ];
    if (this.fields.title) this.game.ui.showInput(cx - 96, 60, 192, 10, this.title, () => this.apply(), { onInput: (v) => { this.title = v; }, onEsc: () => this.game.ui.open(this.parent), max: 32 });
  }
  drawExtra(ui) { this.drawFields(ui); if (this.note) Font.center(ui.ctx, fitText(this.note, ui.w - 8), ui.w / 2, ui.h - 66, this.noteColor); }
  apply() {
    const H = this.host, t = (this.title || '我的世界').slice(0, 32);
    H.title = t; H.public = this.public; H.max = this.max;
    if (H.relay && H.relay.update) H.relay.update({ public: this.public, title: t, max: this.max });
    this.game.ui.hideInput();
    this.game.ui.message(`房间设置：${this.public ? '公开' : '不公开'} · 最多 ${this.max} 人`, '#55FF55');
    this.game.ui.open(this.parent);
  }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  onEsc() { this.back(); }
}
(() => {
  // the pause menu: open a local room (single player), or see it (hosting)
  const lay = PauseScreen.prototype.layout;
  PauseScreen.prototype.layout = function () {
    lay.call(this);
    const g = this.game;
    if (g.net || g.p2pGuest) return;
    const b = this.widgets.find((w) => typeof w.label === 'function' && String(w.label()).startsWith('模式：'));
    if (!b) return;
    // (the game-mode button gives up half of its width)
    b.w = 48;
    this.widgets.push({ x: b.x + 50, y: b.y, w: 48, h: 20, gold: !g.p2pHost, label: g.p2pHost ? '房间…' : '开房间', tip: g.p2pHost ? ['联机房间：邀请码、局域网地址、在场的人'] : ['开一个联机房间，朋友用邀请码加入你的世界（最多 4 人）'],
      onClick: () => onlineGate(g, () => g.ui.open(g.p2pHost ? new LocalRoomStatusScreen(g, this) : new LocalRoomScreen(g, this)), this) });
  };
  // 公开房间：本地 server.js 的 /api/public 列表；行内“进入”直接走同一个中继协议。
  const PublicRooms = {
    async list() {
      // Node server.js：/api/public 是权威列表；PHP 站点没有这个路由，回退到 api/p2p.php?action=public。
      try {
        if (location.protocol === 'http:' || location.protocol === 'https:') {
          const r = await fetch('/api/public', { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            return { rooms: j.rooms || [], capacity: j.capacity || null };
          }
        }
      } catch (e) { }
      try {
        const j = await p2pApi('public', {});
        return { rooms: j.rooms || [], capacity: j.capacity || null };
      } catch (e) {
        throw new Error('公开房间列表暂时连不上');
      }
    },
  };
  // 从“新建世界”直接进入：世界已经加载好，再开一个公开房间；返回时打开暂停菜单而不是退回多人列表。
  async function hostCreatedWorld(g, meta) {
    const wm = meta || g.worldMeta || {};
    const diff = ['peaceful','easy','normal','hard'][g.difficulty == null ? (wm.difficulty || 2) : g.difficulty] || 'normal';
    const h = new LocalHost(g, '', { public: true, title: (wm.name || '我的世界') + '的房间', max: 4, mode: g.mode || wm.mode || 'survival', difficulty: diff, flat: !!wm.flat });
    try {
      await h.open(); g.p2pHost = h;
      g.ui.open(new LocalRoomStatusScreen(g, new PauseScreen(g)));
      g.ui.message('世界已创建，公开房间已开好：邀请码 ' + h.code, '#55FF55');
    } catch (e) { g.ui.open(new LocalRoomErrorScreen(g, new PauseScreen(g), e.message || '开房失败', h.code)); }
  }
  MultiplayerScreen.prototype.load = async function () {
    this.loading = true;
    try { const r = await PublicRooms.list(); this.list = r.rooms; this.cap = r.capacity; this.loadErr = null; }
    catch (e) {
      this.list = [];
      this.loadErr = location.protocol === 'file:'
        ? '公开房间列表暂时连不上；请从网站地址打开，或用邀请码加入'
        : '公开房间列表暂时连不上；点“刷新列表”再试，或用邀请码加入';
    }
    this.loading = false;
    if (this.game.ui.screen === this) this.layout();
  };
  MultiplayerScreen.prototype.rows = function () { return Math.max(1, Math.floor((this.game.ui.h - 148) / 24)); };
  MultiplayerScreen.prototype.layout = function () {
    const u = this.game.ui, cx = u.w / 2, list = this.list || [], n = this.rows();
    // constructor 的旧提示（RoomService 未配置）在这里没有意义：公开列表由本地 server.js 提供
    if (this.note && /没有配置房间服务|联机服务器地址/.test(this.note)) this.note = '';
    this.fields = {};
    if (!(typeof Account !== 'undefined' && Account.loggedIn)) this.addField('name', cx - 152, 42, 148, '你的名字（英文、数字、下划线）', 16, nameOnly);
    else this.name = Account.name;
    this.addField('code', cx + 4, 42, 98, '邀请码', 12, codeOnly);
    const pages = Math.max(1, Math.ceil(list.length / n));
    this.page = Math.min(Math.max(0, this.page || 0), pages - 1);
    this.widgets = [
      { x: cx + 106, y: 42, w: 46, h: 20, label: '加入', onClick: () => this.submit() },
      { x: cx + 106, y: 66, w: 22, h: 14, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } },
      { x: cx + 132, y: 66, w: 22, h: 14, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } },
    ];
    list.slice(this.page * n, this.page * n + n).forEach((r, i) => {
      const full = r.players >= r.max;
      this.widgets.push({ x: cx + 106, y: 84 + i * 24, w: 46, h: 20, label: full ? '已满' : '进入', enabled: !full,
        tip: [r.name, `房主 ${r.owner}，${r.players}/${r.max} 人，${this.modeCn(r.gamemode)}`], onClick: () => joinLocalRoom(this.game, r.code, this) });
    });
    // 手机上四个按钮不能还按桌面的 98 宽排：按屏宽算，最小 68 宽，仍然一行放得下。
    const bw = Math.max(68, Math.min(98, Math.floor((u.w - 24 - 12) / 4)));
    const bx = Math.floor(cx - (bw * 4 + 12) / 2);
    this.widgets.push(
      { x: bx, y: u.h - 52, w: bw, h: 18, gold: true, label: '创建房间', onClick: () => { const n = this.okName(); if (n) this.game.ui.open(new PublicRoomCreateScreen(this.game, this)); } },
      { x: bx + bw + 4, y: u.h - 52, w: bw, h: 18, label: '新建世界', tip: ['进入创建世界界面：类型、种子、模式、结构都能选', '创建好后会直接进入世界，并开一个公开房间'], onClick: () => {
        const n = this.okName(); if (!n) return;
        this.game.ui.hideInput();
        this.game.ui.open(new CreateWorldScreen(this.game, this, null, (meta) => hostCreatedWorld(this.game, meta)));
      } },
      { x: bx + (bw + 4) * 2, y: u.h - 52, w: bw, h: 18, label: this.loading ? '刷新中…' : '刷新列表', onClick: () => { this.list = null; this.loadErr = null; this.layout(); this.load(); } },
      { x: bx + (bw + 4) * 3, y: u.h - 52, w: bw, h: 18, label: '开邀请房', onClick: () => { const n = this.okName(); if (n) this.game.ui.open(new LocalRoomScreen(this.game, this)); } },
      { x: cx - 100, y: u.h - 28, w: 200, h: 18, label: '返回', onClick: () => this.back() },
    );
    // 桌面端自动把光标放到名字/邀请码，手机端由 showInput 统一挡住自动键盘
    if (this.field) this.focus(this.field);
  };
  MultiplayerScreen.prototype.modeCn = (m) => ({ survival: '生存', creative: '创造', adventure: '冒险', spectator: '旁观' }[m] || '生存');
  MultiplayerScreen.prototype.submit = async function () {
    const code = String(this.code || '').replace(/[^A-Za-z0-9]/g, '');
    if (code.length < 4) { this.say('输入邀请码，或从下面的公开房间里选一个', true); return; }
    const n = this.okName(); if (!n) return;
    return joinLocalRoom(this.game, code, this);
  };
  MultiplayerScreen.prototype.drawExtra = function (ui) {
    const c = ui.ctx, cx = ui.w / 2, list = this.list || [], n = this.rows();
    this.drawFields(ui);
    if (typeof Account !== 'undefined' && Account.loggedIn) { Font.draw(c, '你的名字', cx - 152, 31, '#A0A0A0'); Font.draw(c, fitText(Account.name, 146), cx - 150, 48, '#FFFFFF'); }
    Font.draw(c, '公开房间' + (list.length ? `（${list.length}）` : ''), cx - 152, 70, '#FFFFFF');
    if (this.loading) Font.center(c, '正在读取公开房间…', cx, 100, '#A0A0A0');
    else if (this.loadErr) Font.center(c, fitText(this.loadErr, ui.w - 8), cx, 100, '#FF8080');
    else if (!list.length) Font.center(c, '现在还没有公开房间，创建一个吧', cx, 100, '#A0A0A0');
    list.slice(this.page * n, this.page * n + n).forEach((r, i) => {
      const y = 84 + i * 24, full = r.players >= r.max;
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 152, y, 254, 20);
      Font.draw(c, fitText(r.name, 248), cx - 149, y + 2, '#FFFFFF');
      Font.draw(c, fitText(`房主 ${r.owner} · ${r.players}/${r.max} 人 · ${this.modeCn(r.gamemode)}${r.flat ? ' · 超平坦' : ''}`, 248), cx - 149, y + 11, full ? '#FF9090' : '#90C890');
    });
    if (this.note) Font.center(c, fitText(this.note, ui.w - 8), cx, ui.h - 60, this.noteColor);
  };
  // 创建公开房间：世界来源 = 新世界 / 当前世界 / 现有存档；公开房间会出现在上面的列表里
  class PublicRoomCreateScreen extends FormScreen {
    constructor(game, parent) {
      super(game, '创建公开房间', parent);
      const s = game.settings, nm = (Account.loggedIn && Account.name) || s.netName || '玩家';
      this.roomName = nm + ' 的世界'; this.owner = nm; this.publicRoom = true; this.max = 4;
      this.mode = 'survival'; this.difficulty = 'normal'; this.world = { type: game.state === 'play' && game.worldMeta ? 'current' : 'new', name: game.worldMeta ? game.worldMeta.name : '' }; this.worldIcon = game.state === 'play' && game.worldMeta ? game.worldMeta.icon || null : null; this.busy = false;
    }
    size() { this.addField('name', this.game.ui.w / 2 - 100, 44, 200, '房间名', 32, (v) => v.slice(0, 32)); }
    layout() {
      const u = this.game.ui, cx = u.w / 2;
      this.fields = {}; this.addField('name', cx - 100, 44, 200, '房间名', 32, (v) => v.slice(0, 32));
      const sizes = [2, 4, 6, 8, 10];
      const wname = this.world.type === 'current' ? ('当前世界' + (this.world.name ? '：' + this.world.name : '')) : this.world.type === 'save' ? '存档：' + (this.world.name || '') : '新世界（可自定义）';
      this.widgets = [
        { x: cx - 100, y: 74, w: 98, h: 18, label: () => '公开：' + (this.publicRoom ? '开' : '关'), onClick: () => { this.publicRoom = !this.publicRoom; } },
        { x: cx + 2, y: 74, w: 98, h: 18, label: () => '人数：' + this.max, onClick: () => { this.max = sizes[(sizes.indexOf(this.max) + 1) % sizes.length]; } },
        { x: cx - 100, y: 98, w: 200, h: 18, label: () => fitText('世界：' + wname, 192), onClick: () => this.game.ui.open(new PublicWorldPickScreen(this.game, this)) },
        { x: cx - 100, y: u.h - 52, w: 200, h: 18, gold: true, label: () => this.busy ? '正在准备…' : '创建并进入', enabled: !this.busy, onClick: () => this.submit() },
        { x: cx - 100, y: u.h - 30, w: 200, h: 18, label: '返回', onClick: () => this.back() },
      ];
      this.game.ui.showInput(cx - 96, 50, 192, 10, this.roomName, () => this.submit(), { onInput: (v) => { this.roomName = v; }, onEsc: () => this.back(), max: 32 });
    }
    drawExtra(ui) {
      this.drawFields(ui);
      if (this.worldIcon) {
        if (!this.iconImg || this.iconSrc !== this.worldIcon) { this.iconSrc = this.worldIcon; this.iconImg = new Image(); this.iconImg.src = this.worldIcon; }
        if (this.iconImg.complete && this.iconImg.naturalWidth) { ui.ctx.imageSmoothingEnabled = true; ui.ctx.drawImage(this.iconImg, ui.w / 2 - 132, 96, 24, 24); ui.ctx.imageSmoothingEnabled = false; }
      }
      if (this.note) Font.center(ui.ctx, fitText(this.note, ui.w - 8), ui.w / 2, ui.h - 62, this.noteColor);
    }
    async submit() {
      if (this.busy) return;
      const g = this.game;
      // 新世界必须先走完整的“创建新的世界”界面，不能用一个默认种子偷偷建好。
      if (this.world.type === 'new') {
        g.ui.hideInput();
        g.ui.open(new CreateWorldScreen(g, this, null, (meta) => {
          this.world = { type: 'current', name: meta.name };
          this.worldIcon = meta.icon || null;
          g.ui.open(this);
          setTimeout(() => { if (g.ui.screen === this) this.submit(); }, 350);
        }));
        return;
      }
      this.busy = true; this.say('正在准备世界…'); this.layout();
      const name = this.roomName.trim() || (this.owner + ' 的世界');
      try {
        if (this.world.type === 'save' && this.world.id) {
          g.ui.open(new LoadingScreen(g, '正在打开存档…')); await g.loadWorld(this.world.id);
        } else if (!(g.state === 'play' && g.worldMeta)) {
          await g.createWorld(name, '', this.mode, false, { cheats: true, difficulty: this.difficulty === 'hard' ? 3 : this.difficulty === 'easy' ? 1 : this.difficulty === 'peaceful' ? 0 : 2 });
        }
        this.waitPlay(g, () => this.openRoom(name));
      } catch (e) { this.busy = false; this.say(e.message || '创建世界失败', true); this.game.ui.open(this); }
    }
    waitPlay(g, cb) {
      let n = 0;
      const t = setInterval(() => {
        if (g.state === 'play' && g.worldMeta) { clearInterval(t); this.busy = false; setTimeout(cb, 250); }
        else if (++n > 180) { clearInterval(t); this.busy = false; g.ui.open(new ConfirmScreen(g, '世界没有加载完成', '请稍后再试', '返回', () => g.ui.open(this.parent))); }
      }, 300);
    }
    async openRoom(name) {
      const g = this.game, wm = g.worldMeta || {};
      const dmode = ['peaceful','easy','normal','hard'][g.difficulty == null ? (wm.difficulty || 2) : g.difficulty] || 'normal';
      const h = new LocalHost(g, '', { public: this.publicRoom, title: name, max: this.max, mode: g.mode || wm.mode || this.mode, difficulty: dmode, flat: !!wm.flat });
      try { await h.open(); g.p2pHost = h; g.ui.open(new LocalRoomStatusScreen(g, new PauseScreen(g))); g.ui.message('公开房间已开好，邀请码 ' + h.code, '#55FF55'); }
      catch (e) { g.ui.open(new LocalRoomErrorScreen(g, new PauseScreen(g), e.message || '开房失败', h.code)); }
    }
    back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
    onEsc() { this.back(); }
  }
  // 选世界：新建世界（完整自定义界面）/ 当前世界 / 已有存档（带封面图标）
  class PublicWorldPickScreen extends MenuScreen {
    constructor(game, parent) {
      super(game, '房间的世界'); this.parent = parent; this.worlds = null; this.icons = {}; this.scroll = 0; this.loadErr = null;
      this.rowH = 40; this.load();
    }
    async load() {
      try { this.worlds = await DB.listWorlds(); }
      catch (e) { this.worlds = []; this.loadErr = '读取存档失败：' + String(e && e.message || e); }
      if (this.game.ui.screen === this) this.layout();
    }
    rows() {
      const g = this.game, W = this.worlds || [], out = [{ type: 'new', name: '新建世界', desc: '选择世界类型、种子、模式，再开房间' }];
      if (g.state === 'play' && g.worldMeta) out.push({ type: 'current', name: '当前世界', desc: g.worldMeta.name || '', icon: g.worldMeta.icon });
      W.forEach((w) => out.push({ type: 'save', name: w.name, desc: (w.mode === 'creative' ? '创造' : w.mode === 'spectator' ? '旁观' : w.mode === 'adventure' ? '冒险' : '生存') + (w.flat ? ' · 超平坦' : '') + ' · ' + new Date(w.lastPlayed || w.created || Date.now()).toLocaleDateString(), id: w.id, icon: w.icon, world: w }));
      return out;
    }
    layout() {
      const u = this.game.ui;
      this.listTop = 42; this.listBottom = u.h - 34;
      this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '返回', onClick: () => this.back() }];
    }
    iconFor(row) {
      if (row.icon) {
        let im = this.icons[row.id || 'current'];
        if (!im) { im = this.icons[row.id || 'current'] = new Image(); im.src = row.icon; }
        if (im.complete && im.naturalWidth) return im;
      }
      return this.game.ui.img.unknown_server;
    }
    pick(row) {
      if (row.type === 'new') {
        this.game.ui.hideInput();
        // 进入真正的“创建新的世界”界面：世界类型、种子、结构、奖励箱、实验性玩法、超平坦自定义都在这里。
        this.game.ui.open(new CreateWorldScreen(this.game, this, null, (meta) => {
          const room = this.parent;
          room.world = { type: 'current', name: meta.name };
          room.worldIcon = meta.icon || null;
          this.game.ui.open(room);
          setTimeout(() => { if (this.game.ui.screen === room) room.submit(); }, 350);
        }));
        return;
      }
      if (row.type === 'current' && this.game.worldMeta) {
        this.parent.world = { type: 'current', name: this.game.worldMeta.name };
        this.parent.worldIcon = this.game.worldMeta.icon || null;
      } else if (row.type === 'save' && row.world) {
        this.parent.world = { type: 'save', id: row.world.id, name: row.world.name };
        this.parent.worldIcon = row.world.icon || null;
      }
      this.game.ui.open(this.parent);
    }
    drawExtra(ui) {
      const c = ui.ctx, cx = ui.w / 2, R = this.rows(), top = this.listTop, bottom = this.listBottom, rowH = this.rowH;
      ui.listBackground(top, bottom);
      if (this.loadErr) { Font.center(c, fitText(this.loadErr, ui.w - 8), cx, top + 20, '#FF8080'); return; }
      const vis = Math.max(1, Math.floor((bottom - top) / rowH));
      this.scroll = clamp(this.scroll, 0, Math.max(0, R.length - vis));
      const x0 = Math.floor(cx - 154), w = 308;
      c.save(); c.beginPath(); c.rect(0, top, ui.w, bottom - top); c.clip();
      R.slice(this.scroll, this.scroll + vis + 1).forEach((r, i) => {
        const y = top + 4 + i * rowH, ix = x0 + 4;
        const hov = ui.mouse.y >= y && ui.mouse.y < y + rowH - 4 && ui.mouse.x >= x0 && ui.mouse.x < x0 + w;
        c.fillStyle = hov ? 'rgba(144,144,144,0.35)' : 'rgba(0,0,0,0.28)';
        c.fillRect(x0, y, w, rowH - 4);
        const im = this.iconFor(r);
        c.imageSmoothingEnabled = true;
        c.drawImage(im, ix, y + 4, 28, 28);
        // 新建世界用一个小小的“+”叠在图标上，和已有存档一眼区分
        if (r.type === 'new' || r.type === 'current') {
          c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(ix, y + 4, 28, 28);
          Font.center(c, r.type === 'new' ? '+' : '当前', ix + 14, y + 13, '#FFFF55');
        }
        c.imageSmoothingEnabled = false;
        Font.draw(c, fitText(r.name || '未命名', 245), ix + 36, y + 5, r.type === 'new' ? '#FFFF55' : '#FFFFFF');
        Font.draw(c, fitText(r.desc || '', 245), ix + 36, y + 17, '#A0A0A0');
      });
      c.restore();
      if (!this.worlds) Font.center(c, '正在读取存档…', cx, top + 20, '#A0A0A0');
      else if (!R.length) Font.center(c, '还没有存档，可以新建世界', cx, top + 20, '#A0A0A0');
      if (R.length > vis) {
        const sx = x0 + w + 3, h = bottom - top, bh = Math.max(24, Math.floor(h * h / (R.length * rowH + 4)));
        ui.nine('wscroller_bg', sx, top, 5, h, 1); ui.nine('wscroller', sx, top + Math.floor((h - bh) * this.scroll / Math.max(1, R.length - vis)), 5, bh, 1);
      }
    }
    mouseDown(ui, mx, my, b) {
      if (my >= this.listTop && my < this.listBottom && mx >= Math.floor(ui.w / 2 - 154) && mx < Math.floor(ui.w / 2 + 154)) {
        const i = Math.floor((my - this.listTop - 4) / this.rowH) + this.scroll, R = this.rows();
        if (i >= 0 && i < R.length) { Sound.init(); Sound.click(); this.pick(R[i]); return; }
        return;
      }
      super.mouseDown(ui, mx, my, b);
    }
    wheel(ui, dy) { this.scroll += Math.sign(dy); this.layout(); }
    back() { this.game.ui.open(this.parent); }
    onEsc() { this.back(); }
  }
  window.PublicRoomCreateScreen = PublicRoomCreateScreen;
  window.PublicWorldPickScreen = PublicWorldPickScreen;
})();
async function joinLocalRoom(g, code, parent) {
  const name = (Account.loggedIn && Account.name) || nameOnly(g.settings.netName || '') || ('Steve' + Math.floor(Math.random() * 900 + 100));
  // 点击“加入/进入”属于用户手势：在这里同步创建音频上下文，后面异步 welcome 时就不会丢手势。
  try { if (typeof Sound !== 'undefined') Sound.init(); } catch (e) { }
  g.ui.hideInput();
  g.ui.open(new LoadingScreen(g, '正在连接联机房间 ' + code + '…'));
  const G = new LocalGuest(g, code, name);
  try { await G.join(); }
  catch (e) { g.ui.open(new ConfirmScreen(g, '没能进入联机房间', e.message, '返回', () => g.ui.open(parent || new TitleScreen(g)))); }
}

// ---- 客人的房间面板 + 暂停菜单入口：本版原来只有房主能打开房间信息，客人不知道自己在哪个房间、怎么退出 ----
class LocalGuestRoomScreen extends MenuScreen {
  constructor(game, parent) { super(game, '联机房间'); this.parent = parent; this.pauses = false; this.titleY = 10; this.note = ''; }
  get G() { return this.game.p2pGuest; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, G = this.G;
    this.widgets = [
      { x: cx - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx + 4, y: 30, w: 98, h: 20, label: '复制邀请码', onClick: async () => { this.note = (await copyText(G.code)) ? '邀请码已复制' : '复制失败'; } },
      { x: cx - 102, y: u.h - 52, w: 98, h: 20, label: '离开房间', onClick: () => this.leave() },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, G = this.G;
    if (!G) { Font.center(c, '不在联机房间', cx, 50, '#A0A0A0'); return; }
    Font.draw(c, '房间邀请码 ' + G.code, cx - 102, 54, '#FFFF55');
    Font.draw(c, '房主：' + (G.hostName || '房主'), cx - 102, 76, '#FFFFFF');
    const roster = (G.roster && G.roster.length) ? G.roster : [{ name: G.hostName || '房主', host: true, ping: 0 }, { name: G.name, self: true, ping: G.latency }];
    const top = 92, maxRows = Math.max(1, Math.floor((ui.h - top - 58) / 14));
    Font.draw(c, '房间成员', cx - 102, top, '#A0A0A0');
    roster.slice(0, maxRows).forEach((p, i) => {
      const y = top + 11 + i * 14;
      Font.draw(c, fitText((p.name || '玩家') + (p.host ? '（房主）' : '') + (p.self ? '（你）' : ''), 100), cx - 102, y, '#FFFFFF');
      const txt = p.host && p.ping === 0 ? '房主' : typeof p.ping === 'number' ? p.ping + 'ms' : '…';
      Font.draw(c, txt, cx + 4, y, typeof p.ping === 'number' && p.ping > 300 ? '#FF8080' : '#80FF80');
    });
    if (this.note) Font.center(c, this.note, cx, ui.h - 60, '#80FF80');
  }
  leave() {
    const g = this.game, G = this.G;
    if (G) G.leave();
    g.p2pGuest = null; g.worldMeta = null; g.startTitle();
    g.ui.message('已离开联机房间', '#AAAAAA');
    g.ui.open(new TitleScreen(g));
  }
  onEsc() { this.game.ui.open(this.parent); }
}
(() => {
  const lay = PauseScreen.prototype.layout;
  PauseScreen.prototype.layout = function () {
    lay.call(this);
    const g = this.game, u = this.game.ui;
    if (!g.p2pGuest) return;
    this.widgets.push({ x: u.w / 2 + 4, y: u.h / 2 + 67, w: 98, h: 20, label: '房间…', tip: ['联机房间：邀请码、房主、离开'],
      onClick: () => g.ui.open(new LocalGuestRoomScreen(g, this)) });
  };
})();

// ---- 中继房间的声音同步 ----------------------------------------------------
// 房间里的世界由房主时间线驱动，但每个客户端都有独立的 Sound 引擎：之前只有各自的动作有声音，
// 房主 / 其他房客的挖掘、放置、受伤、怪物叫声、爆炸等不会传过来（房客听起来就是“没有声音”）。
// 这里在 Sound.ev / Sound.block 的出口处挂一层：本机事件带位置就发给房间；收到远端事件用原来的
// 函数播放，并用 remote 标志阻止再次广播，避免无限回声。
(() => {
  if (typeof Sound === 'undefined' || !Sound.ev || !Sound.block || Sound.__p2pSound) return;
  Sound.__p2pSound = true;
  let remote = false, inBlock = false;
  const posOk = (p) => Array.isArray(p) && p.length >= 3 && p[0] != null && p[1] != null && p[2] != null
    && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) && Number.isFinite(+p[2]);
  const cleanPos = (p) => [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)];
  const send = (o) => {
    if (remote) return;
    const g = window.game; if (!g) return;
    try {
      if (g.p2pHost) g.p2pHost.toAll(o);
      else if (g.p2pGuest && g.p2pGuest.state === 'joined') g.p2pGuest.send(o);
    } catch (e) { }
  };
  const ev0 = Sound.ev.bind(Sound), block0 = Sound.block.bind(Sound);
  Sound.ev = function (event, pos, vol = 1, pitch = 1) {
    const r = ev0(event, pos, vol, pitch);
    if (!inBlock && !remote && posOk(pos)) send({ t: 'snd', k: 'ev', n: String(event).slice(0, 80), p: cleanPos(pos), v: +vol || 1, q: +pitch || 1 });
    return r;
  };
  Sound.block = function (kind, mat, pos) {
    inBlock = true; let r;
    try { r = block0(kind, mat, pos); } finally { inBlock = false; }
    if (!remote && posOk(pos)) send({ t: 'snd', k: 'bl', b: String(kind).slice(0, 12), m: String(mat).slice(0, 24), p: cleanPos(pos) });
    return r;
  };
  // 收到房间的声音：只读、限幅、用原来的播放函数，不触发本机广播
  window.p2pPlaySound = (m) => {
    if (!m || remote) return;
    let pos = posOk(m.p) ? cleanPos(m.p) : null;
    remote = true;
    try {
      if (m.k === 'bl' && pos) block0(String(m.b || 'break').slice(0, 12), String(m.m || 'stone').slice(0, 24), pos);
      else if (m.k === 'ev' && pos) ev0(String(m.n || '').slice(0, 80), pos, clamp(+m.v || 1, 0.05, 8), clamp(+m.q || 1, 0.5, 2));
    } catch (e) { }
    remote = false;
  };
})();
