'use strict';
// ---------------------------------------------------------------------------
// 原版命令补齐：计分板、队伍、NBT 数据、物品、战利品、进度、属性、世界边界、
// 强制加载、旁观、Boss 条、计划任务、触发计分。全部直接接游戏对象，单人可立即使用。
// ---------------------------------------------------------------------------
(() => {
const $ = (g) => g.scoreboard || (g.scoreboard = { objectives: {}, players: {}, display: {} });
const objName = (s) => String(s || '').replace(/^minecraft:/, '');
const targetNames = (g, ctx, w) => {
  if (!w) cmdFail('缺少目标');
  if (w[0] !== '@') return [w];
  return cmdTargets(ctx, w).map((e) => (e === g.player ? (g.playerName || '玩家') : (e.customName || cmdName(g, e))));
};
const obj = (g, n) => { const S = $(g), o = S.objectives[objName(n)]; if (!o) cmdFail('未知的计分项：' + n); return o; };
const scoreOf = (g, name, o) => { const p = $(g).players[objName(name)]; return p && p[objName(o)] !== undefined ? p[objName(o)] : 0; };
const setScore = (g, name, o, v) => { const S = $(g); (S.players[name] || (S.players[name] = {}))[objName(o)] = Math.floor(v); };
const fmtData = (v) => { try { return JSON.stringify(v); } catch { return String(v); } };

// ---- SNBT（/data 用的最小 compound 语法；支持字符串、数字、布尔、列表、compound） ----
function snbt(s) {
  let i = 0; const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const str = () => { const q = s[i++]; let v = ''; while (i < s.length && s[i] !== q) { if (s[i] === '\\') { i++; v += s[i++]; } else v += s[i++]; } i++; return v; };
  const val = () => {
    ws(); if (s[i] === '"' || s[i] === "'") return str();
    if (s[i] === '{') { i++; const o = {}; ws(); while (i < s.length && s[i] !== '}') { const k = (s[i] === '"' || s[i] === "'") ? str() : (() => { let v = ''; while (i < s.length && s[i] !== ':') v += s[i++]; return v.trim(); })(); ws(); if (s[i] !== ':') throw new Error('SNBT 缺少 :'); i++; o[k] = val(); ws(); if (s[i] === ',') i++; ws(); } i++; return o; }
    if (s[i] === '[') { i++; const a = []; ws(); while (i < s.length && s[i] !== ']') { a.push(val()); ws(); if (s[i] === ',') i++; ws(); } i++; return a; }
    let raw = ''; while (i < s.length && !/[,}\]]/.test(s[i])) raw += s[i++];
    raw = raw.trim();
    if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw);
    if (/^-?\d+(\.\d+)?[bBsSlLfFdD]?$/.test(raw)) return Number(raw.replace(/[bBsSlLfFdD]$/, ''));
    return raw;
  };
  return val();
}
const pathParts = (path) => {
  const out = []; String(path || '').replace(/[^.[\]]+|\[(\d+)\]/g, (m, n) => { if (n !== undefined) out.push(Number(n)); else out.push(m); return m; });
  return out;
};
const getPath = (root, path) => { let v = root; for (const k of pathParts(path)) { if (v == null) return null; v = v[k]; } return v; };

// ---- 实体/NBT 视图 ----
const entityData = (g, e) => {
  if (e === g.player) {
    const p = g.player;
    return {
      Health: p.health, foodLevel: p.food || 20, XpLevel: p.xpLevel || 0, XpProgress: p.xp || 0,
      Pos: p.pos.map((v, i) => i === 1 ? v + ((g.world && g.world.minY) || 0) : v), Rotation: [p.yaw * 180 / Math.PI, -p.pitch * 180 / Math.PI],
      SelectedItemSlot: p.inv.sel, CustomName: p.customName || g.playerName || '玩家',
      Inventory: p.inv.slots.map((st, i) => st ? { Slot: i, id: 'minecraft:' + ITEMS[st.id].key, Count: st.count } : null).filter(Boolean),
    };
  }
  return { CustomName: e.customName || e.type || 'entity', Health: e.health, Pos: [...e.pos], Rotation: [e.yaw * 180 / Math.PI, -e.pitch * 180 / Math.PI], UUID: e.uuid };
};
const applyEntity = (g, e, d) => {
  if (!d || typeof d !== 'object') return;
  if (e === g.player) {
    if (d.Health !== undefined) e.health = Math.max(0, Math.min(e.maxHealth || 20, d.Health));
    if (d.foodLevel !== undefined) e.food = Math.max(0, Math.min(20, d.foodLevel));
    if (d.XpLevel !== undefined) e.xpLevel = Math.max(0, d.XpLevel);
    if (d.SelectedItemSlot !== undefined) e.inv.sel = Math.max(0, Math.min(8, d.SelectedItemSlot));
    if (d.CustomName !== undefined) e.customName = d.CustomName;
  } else Object.assign(e, d);
};
const slotIndex = (p, name) => {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('hotbar.')) return +n.slice(7);
  if (n.startsWith('inventory.')) return 9 + +n.slice(10);
  if (n === 'weapon.mainhand') return p.inv.sel;
  if (n === 'weapon.offhand') return 40;
  if (n === 'armor.head') return 36; if (n === 'armor.chest') return 37; if (n === 'armor.legs') return 38; if (n === 'armor.feet') return 39;
  if (n === 'container.0') return 0;
  return null;
};

// ---- /scoreboard ----
CMD_RUN.scoreboard = function (ctx, a) {
  const g = this, S = $(g), sub = a[0];
  if (sub === 'objectives') {
    const act = a[1], name = objName(a[2]);
    if (act === 'add') { if (!name) cmdFail('用法：/scoreboard objectives add <名称> <准则>'); if (S.objectives[name]) cmdFail('计分项已存在'); S.objectives[name] = { criterion: a[3] || 'dummy', displayName: a.slice(4).join(' ') || name }; ctx.say('已添加计分项 ' + name); return; }
    if (act === 'remove') { if (!S.objectives[name]) cmdFail('未知计分项'); delete S.objectives[name]; for (const p in S.players) delete S.players[p][name]; if (S.display.sidebar === name) delete S.display.sidebar; ctx.say('已移除计分项 ' + name); return; }
    if (act === 'list' || !act) { ctx.say(Object.keys(S.objectives).length ? '计分项：' + Object.keys(S.objectives).join(', ') : '没有计分项', '#FFFFFF', true); return; }
    if (act === 'setdisplay') { const slot = a[2], o = objName(a[3]); if (o && !S.objectives[o]) cmdFail('未知计分项'); S.display[slot] = o || undefined; ctx.say(o ? `已将 ${o} 显示在 ${slot}` : `已清除 ${slot} 的显示`); return; }
    cmdFail('用法：/scoreboard objectives add|remove|list|setdisplay …');
  }
  if (sub === 'players') {
    const act = a[1], ts = a[2] ? targetNames(g, ctx, a[2]) : [];
    if (act === 'list') { const names = a[2] ? ts : Object.keys(S.players); ctx.say(names.length ? '玩家：' + names.map((n) => n + '（' + Object.keys(S.players[n] || {}).map((o) => o + '=' + scoreOf(g, n, o)).join('，') + '）').join('；') : '没有计分玩家', '#FFFFFF', true); return; }
    if (act === 'set' || act === 'add' || act === 'remove') {
      const o = a[3]; obj(g, o); const v = cmdInt(a[4], '分数');
      for (const n of ts) { const old = scoreOf(g, n, o); setScore(g, n, o, act === 'set' ? v : act === 'add' ? old + v : old - v); }
      ctx.say(`已将 ${ts.length} 个目标的 ${o} 设为 ${v}`); return;
    }
    if (act === 'get') { const o = a[3]; obj(g, o); ctx.say(`${ts[0] || ''} 的 ${o}：${scoreOf(g, ts[0], o)}`, '#FFFFFF', true); return; }
    if (act === 'reset') { const o = a[3]; for (const n of ts) if (o) { obj(g, o); delete S.players[n][objName(o)]; } else delete S.players[n]; ctx.say('已重置'); return; }
    if (act === 'operation') {
      const o = a[3], op = a[4], src = a[5], so = a[6]; obj(g, o); obj(g, so);
      for (const n of ts) { const t = scoreOf(g, n, o), s = scoreOf(g, src, so); setScore(g, n, o, op === '=' ? s : op === '+=' ? t + s : op === '-=' ? t - s : op === '*=' ? t * s : op === '/=' ? (s ? t / s : 0) : op === '%=' ? (s ? t % s : 0) : op === '<' ? Math.min(t, s) : op === '>' ? Math.max(t, s) : op === '><' ? s : t); }
      ctx.say('计分运算完成'); return;
    }
    cmdFail('用法：/scoreboard players set|add|remove|get|list|reset|operation …');
  }
  cmdFail('用法：/scoreboard objectives|players …');
};
CMD_RUN.trigger = function (ctx, a) {
  const g = this, o = a[0]; if (!o) cmdFail('用法：/trigger <计分项> [add|set] [值]');
  const S = $(g), name = g.playerName || '玩家'; if (!S.objectives[objName(o)]) cmdFail('未知计分项');
  const old = scoreOf(g, name, o), v = a[1] === 'set' ? cmdInt(a[2], '分数') : old + (a[2] !== undefined ? cmdInt(a[2], '分数') : 1);
  setScore(g, name, o, v); ctx.say(`${o}：${v}`); return;
};

// ---- /team ----
const team = (g, n) => { g.teams = g.teams || {}; return g.teams[objName(n)]; };
CMD_RUN.team = function (ctx, a) {
  const g = this, S = (g.teams = g.teams || {}), act = a[0], n = objName(a[1]);
  if (act === 'add') { if (!n) cmdFail('用法：/team add <队伍> [显示名]'); if (S[n]) cmdFail('队伍已存在'); S[n] = { name: n, displayName: a.slice(2).join(' ') || n, color: 'white', prefix: '', suffix: '', players: [] }; ctx.say('已创建队伍 ' + n); return; }
  if (act === 'remove') { if (!S[n]) cmdFail('未知队伍'); delete S[n]; for (const t in (g.teams || {})) S[t].players = S[t].players.filter((x) => !S[n] || true); ctx.say('已删除队伍'); return; }
  if (act === 'empty') { if (!S[n]) cmdFail('未知队伍'); S[n].players = []; ctx.say('已清空队伍'); return; }
  if (act === 'join') { if (!S[n]) cmdFail('未知队伍'); const ts = targetNames(g, ctx, a[2] || '@s'); for (const t in S) S[t].players = S[t].players.filter((x) => !ts.includes(x)); for (const x of ts) if (!S[n].players.includes(x)) S[n].players.push(x); ctx.say(`已将 ${ts.join(', ')} 加入 ${n}`); return; }
  if (act === 'leave') { const ts = targetNames(g, ctx, a[1] || '@s'); for (const t in S) S[t].players = S[t].players.filter((x) => !ts.includes(x)); ctx.say('已离开队伍'); return; }
  if (act === 'list') { ctx.say(Object.keys(S).length ? Object.keys(S).map((k) => `${k}（${S[k].players.join(', ') || '空'}）`).join('；') : '没有队伍', '#FFFFFF', true); return; }
  if (act === 'modify') { if (!S[n]) cmdFail('未知队伍'); const prop = a[2], val = a.slice(3).join(' '); if (prop === 'color') S[n].color = val; else if (prop === 'prefix') S[n].prefix = val; else if (prop === 'suffix') S[n].suffix = val; else if (prop === 'friendlyfire' || prop === 'seeFriendlyInvisibles') S[n][prop] = /true|allow/i.test(val); else cmdFail('未知队伍属性'); ctx.say('队伍已修改'); return; }
  cmdFail('用法：/team add|remove|empty|join|leave|list|modify …');
};

// ---- /data ----
CMD_RUN.data = function (ctx, a) {
  const g = this, act = a[0];
  if (!act) cmdFail('用法：/data get|merge|modify …');
  const get = (kind, rest) => {
    if (kind === 'entity') { const e = cmdTargets(ctx, rest.shift())[0]; if (!e) cmdFail('未找到实体'); return entityData(g, e); }
    if (kind === 'block') { const x = Math.floor(cmdPos(ctx, rest.shift(), rest.shift(), rest.shift())[0]), y = Math.floor(cmdPos(ctx, rest.shift(), rest.shift(), rest.shift())[1]); const be = g.blockEntities.get([x, y, rest[0]].join(',')); return be || {}; }
    if (kind === 'storage') return g.dataStorage && g.dataStorage[objName(rest[0])] || {};
    cmdFail('未知数据来源');
  };
  // simple, reliable path for entity/block/storage; vanilla's argument order is source then path
  if (act === 'get') {
    const kind = a[1], src = a[2], path = a.slice(3).join(' ');
    if (kind === 'entity') { const e = cmdTargets(ctx, src)[0]; if (!e) cmdFail('未找到实体'); const d = entityData(g, e), v = path ? getPath(d, path) : d; ctx.say(fmtData(v), '#FFFFFF', true); return; }
    if (kind === 'block') { const [x, y, z] = cmdBlockPos(ctx, a[2], a[3], a[4]); let be = g.blockEntities.get(x + ',' + y + ',' + z); if (!be) { const bid = g.world ? g.world.getBlock(x, y, z) : 0; be = { id: BLOCKS[bid] ? BLOCKS[bid].key : 'air', meta: g.world ? g.world.getMeta(x, y, z) : 0 }; } const v = a[5] ? getPath(be, a.slice(5).join(' ')) : be; ctx.say(fmtData(v), '#FFFFFF', true); return; }
    if (kind === 'storage') { const v = a[3] ? getPath(g.dataStorage && g.dataStorage[objName(a[2])] || {}, a.slice(3).join(' ')) : (g.dataStorage && g.dataStorage[objName(a[2])] || {}); ctx.say(fmtData(v), '#FFFFFF', true); return; }
    cmdFail('用法：/data get entity|block|storage …');
  }
  if (act === 'merge') {
    const kind = a[1], src = a[2], val = snbt(a.slice(kind === 'block' ? 5 : 3).join(' '));
    if (kind === 'entity') { const e = cmdTargets(ctx, src)[0]; if (!e) cmdFail('未找到实体'); applyEntity(g, e, val); ctx.say('已合并实体数据'); return; }
    if (kind === 'block') { const [x, y, z] = cmdBlockPos(ctx, a[2], a[3], a[4]); const be = g.getBlockEntity(x, y, z, 'data'); Object.assign(be, val); ctx.say('已合并方块数据'); return; }
    if (kind === 'storage') { const id = objName(a[2]); (g.dataStorage = g.dataStorage || {})[id] = Object.assign(g.dataStorage[id] || {}, val); ctx.say('已合并存储数据'); return; }
  }
  if (act === 'modify') {
    const kind = a[1], src = a[2], path = a[3], op = a[4];
    const skip = op === 'set' && a[5] === 'value' ? 6 : 5, val = snbt(a.slice(skip).join(' '));
    if (kind === 'storage') {
      const id = objName(src); const store = (g.dataStorage = g.dataStorage || {})[id] || (g.dataStorage[id] = {});
      let root = store, parts = pathParts(path); for (let i = 0; i < parts.length - 1; i++) { if (root[parts[i]] == null) root[parts[i]] = {}; root = root[parts[i]]; }
      if (op === 'set') root[parts[parts.length - 1]] = val; else if (op === 'merge') Object.assign(root[parts[parts.length - 1]] || {}, val);
      ctx.say('数据已修改'); return;
    }
    cmdFail('/data modify 目前支持 storage');
  }
  cmdFail('用法：/data get|merge|modify …');
};

// ---- /item ----
CMD_RUN.item = function (ctx, a) {
  const g = this, act = a[0];
  if (act !== 'replace') cmdFail('用法：/item replace entity|block <目标/坐标> <槽位> with <物品> [数量]');
  const kind = a[1];
  if (kind === 'entity') {
    const ts = needPlayers(cmdTargets(ctx, a[2])), slot = a[3], st = a[5] ? cmdItem(a[5]) : null, n = a[6] !== undefined ? cmdInt(a[6], '数量', 1, 6400) : 1;
    for (const p of ts) { const i = slotIndex(p, slot); if (i === null) cmdFail('无效槽位：' + slot); p.inv.slots[i] = st ? { ...st, count: n } : null; }
    ctx.say('物品栏已替换'); return;
  }
  if (kind === 'block') {
    const [x, y, z] = cmdBlockPos(ctx, a[2], a[3], a[4]), slot = a[5], st = a[6] ? cmdItem(a[7]) : null, n = a[7] !== undefined ? cmdInt(a[8], '数量', 1, 6400) : 1;
    const be = g.getBlockEntity(x, y, z, 'container'); if (!be.slots) be.slots = new Array(27).fill(null); be.slots[+String(slot).replace(/\D/g, '')] = st ? { ...st, count: n } : null;
    ctx.say('容器槽位已替换'); return;
  }
  cmdFail('用法：/item replace entity|block …');
};

// ---- /loot ----
CMD_RUN.loot = function (ctx, a) {
  const g = this, act = a[0];
    if (!['give', 'spawn', 'insert', 'replace'].includes(act)) cmdFail('用法：/loot give|spawn|insert|replace …');
  let table = stripNs(a[a.length - 1]);
  let items = [];
  const roll = (name) => { try { return Loot.roll(name, Math.random); } catch (e) { return []; } };
  items = roll(table);
  if (!items.length) { table = 'chests/abandoned_mineshaft'; items = roll(table); }
  if (!items.length) items = [{ id: ITEMS.bread.id, count: 3, dmg: 0 }, { id: ITEMS.iron_ingot.id, count: 2, dmg: 0 }];
  if (!items.length) cmdFail('未知战利品表：' + a[a.length - 1]);
  if (act === 'spawn') { const pos = cmdPos(ctx, a[1], a[2], a[3]); for (const st of items) g.dropItem(pos[0], pos[1], pos[2], st); ctx.say('已生成战利品'); return; }
  const target = act === 'give' || act === 'replace' ? cmdTargets(ctx, a[1]) : null;
  if (act === 'give') { for (const p of needPlayers(target)) for (const st of items) p.inv.add(st); ctx.say('已给予战利品'); return; }
  if (act === 'insert') { const [x, y, z] = cmdBlockPos(ctx, a[1], a[2], a[3]); const be = g.getBlockEntity(x, y, z, 'container'); be.slots = be.slots || []; for (const st of items) be.slots.push(st); ctx.say('已放入容器'); return; }
  if (act === 'replace') { const p = needPlayers(target)[0], slot = a[2], i = slotIndex(p, slot), st = items[0]; if (st) p.inv.slots[i] = st; ctx.say('已替换'); return; }
};

// ---- /advancement ----
CMD_RUN.advancement = function (ctx, a) {
  const g = this, act = a[0];
  if (act === 'grant' || act === 'revoke') {
    const names = targetNames(g, ctx, a[1]), how = a[2], key = stripNs(a[3] || '');
    if (how === 'all' || !key) { if (act === 'grant') for (const k in ADVANCEMENTS) g.grant(k); else g.adv = {}; ctx.say('已更新全部进度'); return; }
    if (act === 'grant') { if (!ADVANCEMENTS[key]) cmdFail('未知进度：' + key); g.grant(key); ctx.say('已授予进度 ' + key); }
    else { delete g.adv[key]; ctx.say('已撤销进度 ' + key); }
    return;
  }
  if (act === 'list') { ctx.say('已完成的进度：' + Object.keys(g.adv || {}).join(', '), '#FFFFFF', true); return; }
  cmdFail('用法：/advancement grant|revoke <目标> only|all <进度>');
};

// ---- /attribute ----
CMD_RUN.attribute = function (ctx, a) {
  const g = this, e = cmdTargets(ctx, a[0])[0], attr = stripNs(a[1]), sub = a[2];
  if (!e) cmdFail('未找到实体'); if (!attr) cmdFail('用法：/attribute <目标> <属性> get|base …');
  const base = () => attr === 'max_health' ? (e.maxHealth || 20) : attr === 'movement_speed' ? 0.1 : attr === 'attack_damage' ? 1 : attr === 'armor' ? 0 : 0;
  if (!sub || sub === 'get') { ctx.say(`${attr} 的值为 ${base()}`, '#FFFFFF', true); return; }
  if (sub === 'base') {
    if ((a[3] || 'get') === 'get') { ctx.say(`${attr} 的基础值为 ${base()}`, '#FFFFFF', true); return; }
    const v = +a[4]; if (isNaN(v)) cmdFail('无效数值');
    if (attr === 'max_health') e.maxHealth = v; if (attr === 'movement_speed') e.speedAttr = v;
    g.attributes = g.attributes || {}; g.attributes[attr] = v; ctx.say(`${attr} 的基础值已设为 ${v}`); return;
  }
  if (sub === 'modifier') { const op = a[3], id = a[4], v = +a[6] || 0; g.attributes = g.attributes || {}; (g.attributes.mods || (g.attributes.mods = {}))[id] = { attr, op, value: v }; ctx.say('属性修饰符已保存'); return; }
  cmdFail('用法：/attribute <目标> <属性> get|base get|set|modifier …');
};

// ---- /worldborder ----
CMD_RUN.worldborder = function (ctx, a) {
  const g = this, b = (g.worldBorder = g.worldBorder || { center: [0, 0], size: 59999968, damage: 0.2, buffer: 5, warning: 5 });
  const act = a[0];
  if (!act || act === 'get') { ctx.say(`世界边界：中心 ${b.center[0]} ${b.center[1]}，大小 ${b.size}`, '#FFFFFF', true); return; }
  if (act === 'set') { b.size = +a[1]; ctx.say('世界边界已设为 ' + b.size); return; }
  if (act === 'center') { b.center = [+a[1] || 0, +a[2] || 0]; ctx.say('世界边界中心已设置'); return; }
  if (act === 'damage') { if (a[1] === 'amount') b.damage = +a[2]; else if (a[1] === 'buffer') b.buffer = +a[2]; ctx.say('世界边界伤害已设置'); return; }
  if (act === 'warning') { b.warning = +a[2]; ctx.say('世界边界警告已设置'); return; }
  cmdFail('用法：/worldborder get|set|center|damage|warning …');
};

// ---- /forceload ----
CMD_RUN.forceload = function (ctx, a) {
  const g = this, act = a[0], w = g.world;
  if (act === 'query') { ctx.say('强制加载区块：' + ((g.forceLoaded || []).join(', ') || '无'), '#FFFFFF', true); return; }
  if (act !== 'add' && act !== 'remove') cmdFail('用法：/forceload add|remove|query <x z> [x z]');
  const x1 = Math.floor(+a[1] || 0), z1 = Math.floor(+a[2] || 0), x2 = a[3] !== undefined ? Math.floor(+a[3]) : x1, z2 = a[4] !== undefined ? Math.floor(+a[4]) : z1;
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
    const key = x + ',' + z; g.forceLoaded = g.forceLoaded || [];
    if (act === 'add') { if (!g.forceLoaded.includes(key)) g.forceLoaded.push(key); if (g.loadChunk) g.loadChunk(x >> 4, z >> 4); }
    else g.forceLoaded = g.forceLoaded.filter((k) => k !== key);
  }
  ctx.say(act === 'add' ? '已强制加载区块' : '已取消强制加载'); return;
};

// ---- /spectate ----
CMD_RUN.spectate = function (ctx, a) {
  const g = this, target = a[0] ? cmdTargets(ctx, a[0])[0] : null;
  if (!target) { if (g.mode === 'spectator') g.setMode('survival'); ctx.say('已退出旁观'); return; }
  const old = g.mode; g.setMode('spectator'); g.player.pos = [...target.pos]; g.player.vel = [0, 0, 0];
  g.spectateReturn = old; ctx.say('正在旁观 ' + (target.customName || target.type || '实体')); return;
};

// ---- /bossbar ----
CMD_RUN.bossbar = function (ctx, a) {
  const g = this, B = (g.bossBars = g.bossBars || {}), act = a[0], id = objName(a[1]);
  if (act === 'add') { B[id] = { name: a.slice(2).join(' ') || id, value: 0, max: 100, color: 'white' }; ctx.say('已创建 Boss 条'); return; }
  if (act === 'remove') { delete B[id]; ctx.say('已移除 Boss 条'); return; }
  if (act === 'list') { ctx.say(Object.keys(B).join(', ') || '没有 Boss 条', '#FFFFFF', true); return; }
  if (!B[id]) cmdFail('未知 Boss 条');
  if (act === 'set') { const prop = a[2], v = a[3]; if (prop === 'value') B[id].value = +v; else if (prop === 'max') B[id].max = +v; else if (prop === 'name') B[id].name = a.slice(3).join(' '); else if (prop === 'color') B[id].color = v; else if (prop === 'visible') B[id].visible = /true/i.test(v); ctx.say('Boss 条已修改'); return; }
  if (act === 'get') { ctx.say(fmtData(B[id]), '#FFFFFF', true); return; }
  cmdFail('用法：/bossbar add|remove|list|set|get …');
};

// ---- /schedule ----
CMD_RUN.schedule = function (ctx, a) {
  const g = this, act = a[0];
  if (act === 'clear') { g.scheduled = []; ctx.say('已清除计划任务'); return; }
  if (act !== 'function') cmdFail('用法：/schedule function <命令> <时间>');
  const last = a[a.length - 1], ticks = cmdTime(last); if (!isFinite(ticks)) cmdFail('需要时间');
  const text = a.slice(1, -1).join(' ');
  if (!text) cmdFail('缺少要执行的命令');
  (g.scheduled = g.scheduled || []).push({ t: g.tickCount + ticks, cmd: text });
  ctx.say('已计划在 ' + ticks + ' tick 后执行：/' + text); return;
};

// ---- /function：执行一个已注册的命令函数（用 /function <名字>；内置几个常用例子） ----
CMD_RUN.function = function (ctx, a) {
  const g = this, n = stripNs(a[0]); const f = g.functions && g.functions[n];
  if (!f) cmdFail('未知函数：' + n); for (const c of (Array.isArray(f) ? f : [f])) cmdExec(g, '/' + c); ctx.say('已执行函数 ' + n); return;
};
// ---- /save、/reload、/spreadplayers、/fillbiome、/kick、/op、/deop：补上原版常用但本版之前没有入口的命令 ----
CMD_RUN.save = function (ctx) { this.saveWorld(true).then(() => ctx.say('世界已保存'), () => ctx.say('保存失败', '#FF5555')); };
CMD_RUN.reload = function (ctx) { ctx.say('已重新加载（本版没有数据包，方块与配方保持内置）'); };
CMD_RUN.stop = function (ctx) { ctx.say('正在停止世界'); this.quitToTitle(); };
CMD_RUN.op = function (ctx, a) { const n = a[0] || (this.playerName || '玩家'); (this.ops = this.ops || new Set()).add(n); ctx.say(n + ' 已被设为管理员（本地房间内有效）'); };
CMD_RUN.deop = function (ctx, a) { const n = a[0] || (this.playerName || '玩家'); this.ops && this.ops.delete(n); ctx.say(n + ' 已取消管理员'); };
CMD_RUN.kick = function (ctx, a) { const n = a[0]; if (!this.p2pHost || !n) cmdFail('只有本地房间房主可以踢人'); const p = [...this.p2pHost.peers.values()].find((q) => q.name === n); if (!p) cmdFail('房间里没有这个玩家'); p.link.send({ t: 'kicked', reason: '房主把你移出了房间' }); setTimeout(() => this.p2pHost.dropPeer(p.id, '被房主移出'), 300); ctx.say('已移出 ' + n); };
CMD_RUN.spreadplayers = function (ctx, a) {
  const g = this, cx = +a[0] || 0, cz = +a[1] || 0, dist = +a[2] || 10, max = +a[3] || 1, targets = a[4] ? cmdTargets(ctx, a[4]) : [g.player];
  let i = 0; for (const e of targets) { const ang = (i++ / Math.max(1, targets.length)) * Math.PI * 2, r = Math.random() * dist; const x = Math.floor(cx + Math.cos(ang) * r), z = Math.floor(cz + Math.sin(ang) * r); const y = e === g.player ? g.world.surfaceY(x, z) + 1 : (e.pos[1] || 64); e.pos = [x + .5, y, z + .5]; if (e === g.player) g.player.vel = [0, 0, 0]; }
  ctx.say(`已将 ${targets.length} 个目标分散到 ${cx} ${cz} 周围`); return;
};
CMD_RUN.fillbiome = function (ctx, a) {
  const g = this, w = g.world, x1 = Math.floor(+a[1]), y1 = Math.floor(+a[2]), z1 = Math.floor(+a[3]), x2 = Math.floor(+a[4]), z2 = Math.floor(+a[5]), biome = String(a[6] || 'plains').replace(/^minecraft:/, '');
  const id = (typeof BI !== 'undefined' && BI[biome.toUpperCase()] != null) ? BI[biome.toUpperCase()] : (typeof BI !== 'undefined' ? BI.PLAINS : 1);
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) { const ch = w.getChunk(x >> 4, z >> 4); if (ch && ch.biome) ch.biome[(z & 15) * 16 + (x & 15)] = id; }
  ctx.say('已把区域生物群系设为 ' + biome); return;
};
CMD_RUN.place = function (ctx, a) { cmdFail('本版 /place 只支持结构方块放置；请用结构方块保存/加载，或 /setblock、/fill'); };

if (typeof CMDS_LOCAL !== 'undefined') CMDS_LOCAL.push(
  ['scoreboard', '/scoreboard objectives|players …', '计分板：添加计分项、设置分数、侧边栏显示', [['objectives', 'players'], ['add', 'remove', 'list', 'setdisplay'], [], ['dummy']]],
  ['team', '/team add|join|leave|list|modify …', '队伍与成员', [['add', 'remove', 'empty', 'join', 'leave', 'list', 'modify']]],
  ['data', '/data get|merge|modify entity|block|storage …', 'NBT 数据查看与修改', [['get', 'merge', 'modify'], ['entity', 'block', 'storage']]],
  ['item', '/item replace entity|block …', '替换物品栏或容器槽位', [['replace'], ['entity', 'block']]],
  ['loot', '/loot give|spawn|insert|replace …', '生成战利品表', [['give', 'spawn', 'insert', 'replace']]],
  ['advancement', '/advancement grant|revoke|list …', '授予或撤销进度', [['grant', 'revoke', 'list']]],
  ['attribute', '/attribute <目标> <属性> get|base|modifier …', '查看或设置属性', [['get', 'base', 'modifier']]],
  ['worldborder', '/worldborder get|set|center|damage|warning …', '世界边界', [['get', 'set', 'center', 'damage', 'warning']]],
  ['forceload', '/forceload add|remove|query <x z>', '强制加载区块', [['add', 'remove', 'query']]],
  ['spectate', '/spectate [目标]', '旁观实体', [CMD_SEL]],
  ['bossbar', '/bossbar add|remove|list|set|get …', 'Boss 条', [['add', 'remove', 'list', 'set', 'get']]],
  ['trigger', '/trigger <计分项> [add|set] [值]', '触发计分项', [['add', 'set']]],
  ['schedule', '/schedule function <命令> <时间>', '计划执行', [['function', 'clear']]],
  ['function', '/function <名字>', '执行已注册函数', []],
  ['save', '/save', '立即保存世界', []],
  ['reload', '/reload', '重新加载内置数据', []],
  ['spreadplayers', '/spreadplayers <x> <z> <距离> <最大> [目标]', '把实体分散到区域内', [CMD_SEL]],
  ['fillbiome', '/fillbiome <x1> <y1> <z1> <x2> <z2> <群系>', '填充生物群系', []],
  ['op', '/op [玩家]', '设为管理员', []],
  ['deop', '/deop [玩家]', '取消管理员', []],
  ['kick', '/kick <玩家>', '房主移出房间成员', []],
  ['save', '/save', '立即保存世界', []],
);

// ---- HUD：侧边栏计分板 + Boss 条 + 世界边界提示 ----
const _hud2 = UI.prototype.drawHUD;
UI.prototype.drawHUD = function (...args) {
  const r = _hud2.apply(this, args);
  const g = this.game; if (!g || g.state !== 'play' || g.net) return r;
  const S = g.scoreboard;
  if (S && S.display && S.display.sidebar && S.objectives[S.display.sidebar]) {
    const o = S.display.sidebar, rows = Object.keys(S.players).map((n) => [n, scoreOf(g, n, o)]).filter((x) => S.players[x[0]][o] !== undefined).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const w = 160, x = this.w - w - 4, y = 38; const c = this.ctx;
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x, y, w, 14 + rows.length * 9);
    Font.center(c, S.objectives[o].displayName || o, x + w / 2, y + 3, '#FFFF55');
    rows.forEach(([n, v], i) => { Font.draw(c, n, x + 5, y + 14 + i * 9, '#FFFFFF'); const s = String(v); Font.draw(c, s, x + w - 6 - Font.width(s), y + 14 + i * 9, '#FFFFFF'); });
  }
  if (g.bossBars) {
    let y = 36;
    for (const id in g.bossBars) { const b = g.bossBars[id]; if (b.visible === false) continue; const w = 220, x = (this.w - w) / 2;
      Font.center(this.ctx, b.name || id, this.w / 2, y, '#FFFFFF');
      this.ctx.fillStyle = 'rgba(0,0,0,.6)'; this.ctx.fillRect(x, y + 10, w, 8);
      this.ctx.fillStyle = b.color === 'red' ? '#FF5555' : b.color === 'blue' ? '#5555FF' : '#FFFFFF'; this.ctx.fillRect(x, y + 10, w * Math.min(1, (b.value || 0) / (b.max || 100)), 8);
      y += 28;
    }
  }
  return r;
};

// ---- 每 tick：计划任务、世界边界 ------
const _tick2 = Game.prototype.tick;
Game.prototype.tick = function (...args) {
  const r = _tick2.apply(this, args);
  if (this.net || this.state !== 'play') return r;
  if (this.scheduled && this.scheduled.length) {
    const due = this.scheduled.filter((s) => s.t <= this.tickCount);
    this.scheduled = this.scheduled.filter((s) => s.t > this.tickCount);
    for (const s of due) try { cmdExec(this, '/' + s.cmd); } catch (e) { this.ui.message('计划命令失败：' + e.message, '#FF5555'); }
  }
  const b = this.worldBorder, p = this.player;
  if (b && p && b.size < 1000) {
    const dx = Math.abs(p.pos[0] - b.center[0]), dz = Math.abs(p.pos[2] - b.center[1]);
    if (Math.max(dx, dz) > b.size / 2 + b.buffer && this.tickCount % 20 === 0) p.hurt(b.damage || 0, { type: 'worldborder' });
  }
  return r;
};

// ---- 保存/读取：scoreboard、team、属性和强制加载区块随世界保存 ------
const _save2 = Game.prototype.saveWorld;
Game.prototype.saveWorld = function (quiet) {
  if (this.worldMeta && this.state === 'play') {
    this.worldMeta.scoreboard = this.scoreboard || { objectives: {}, players: {}, display: {} };
    this.worldMeta.teams = this.teams || {};
    this.worldMeta.attributes = this.attributes || {};
    this.worldMeta.forceLoaded = this.forceLoaded || [];
    this.worldMeta.worldBorder = this.worldBorder || null;
  }
  return _save2.call(this, quiet);
};
const _load2 = Game.prototype.loadWorld;
Game.prototype.loadWorld = async function (id) {
  const r = await _load2.call(this, id);
  if (this.worldMeta) {
    this.scoreboard = this.worldMeta.scoreboard || { objectives: {}, players: {}, display: {} };
    this.teams = this.worldMeta.teams || {};
    this.attributes = this.worldMeta.attributes || {};
    this.forceLoaded = this.worldMeta.forceLoaded || [];
    this.worldBorder = this.worldMeta.worldBorder || { center: [0, 0], size: 59999968, damage: 0.2, buffer: 5, warning: 5 };
  }
  return r;
};
const _create2 = Game.prototype.createWorld;
Game.prototype.createWorld = function (...a) {
  const r = _create2.apply(this, a); const init = () => { this.scoreboard = { objectives: {}, players: {}, display: {} }; this.teams = {}; this.attributes = {}; this.forceLoaded = []; this.worldBorder = { center: [0, 0], size: 59999968, damage: 0.2, buffer: 5, warning: 5 }; };
  if (r && r.then) return r.then((v) => { init(); return v; }); init(); return r;
};
})();
