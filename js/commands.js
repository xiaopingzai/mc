'use strict';
// ---------------------------------------------------------------------------
// Commands: one list for the chat box's suggestions (like vanilla's CommandSuggestions: the matching commands or
// arguments above the input, Tab to take one, the usage below) and the /help menu (each command and what it does;
// a click puts it in the chat box). Single player runs them itself (runCommand); on a server they are the
// server's, in vanilla's syntax.
// ---------------------------------------------------------------------------
const CMD_ITEMS = () => Object.keys(ITEM_KEY);
const CMD_MOBS = () => [...Object.keys(MOB_TYPES), 'ender_dragon', 'tnt'];
const CMD_STRUCTS = ['village', 'stronghold', 'fortress', 'bastion_remnant', 'pillager_outpost', 'ancient_city', 'trial_chambers', 'trail_ruins', 'abandoned_camp',
  'desert_pyramid', 'jungle_pyramid', 'swamp_hut', 'igloo', 'shipwreck', 'ocean_ruin_cold', 'ocean_ruin_warm', 'ruined_portal', 'mineshaft',
  'buried_treasure', 'end_city', 'monument', 'mansion'];
const CMD_PLAYERS = (g) => ['@s', '@p', '@a', ...(g.net ? [...g.net.players.values()].filter(Boolean) : [])];
const CMD_DIMS = ['overworld', 'nether', 'end'];
const CMD_MODES = ['survival', 'creative', 'spectator', 'adventure'];
// [name, usage, what it does, the choices for each argument (a list, or a function of the game giving one)]
const CMD_SEL = ['@s', '@p', '@a', '@r', '@e', '@e[type='];
const CMD_EFFECTS = () => Object.keys(EFFECTS);
const CMD_ENCH = () => (typeof ENCH !== 'undefined' ? Object.keys(ENCH) : []);
const CMD_BLOCKS = () => Object.keys(BID);
const CMD_RULES = () => (typeof GAME_RULES !== 'undefined' ? Object.keys(GAME_RULES) : []);
const CMD_XYZ = [['~'], ['~'], ['~']];
// single player: vanilla's syntax (cmdrun.js runs them)
const CMDS_LOCAL = [
  ['gamemode', '/gamemode <模式> [目标]', '切换游戏模式', [CMD_MODES, CMD_SEL]],
  ['difficulty', '/difficulty [难度]', '查看或设置难度', [['peaceful', 'easy', 'normal', 'hard']]],
  ['time', '/time set|add|query <时间>', '设置时间：day / noon / night / midnight、数值或 10s / 1d', [['set', 'add', 'query'], ['day', 'noon', 'night', 'midnight', 'sunrise', 'sunset', 'daytime', 'gametime', 'day']]],
  ['weather', '/weather clear|rain|thunder [时长]', '设置天气', [['clear', 'rain', 'thunder']]],
  ['give', '/give <目标> <物品> [数量]', '给予物品，如 /give @s diamond 64', [(g) => [...CMD_SEL, ...CMD_ITEMS()], CMD_ITEMS]],
  ['clear', '/clear [目标] [物品] [最大数量]', '清除物品栏里的物品', [CMD_SEL, CMD_ITEMS]],
  ['tp', '/tp [目标] <x y z | 目标实体> [偏航 俯仰]', '传送（~ 相对位置，^ 视线方向的局部坐标）', [(g) => ['~', '^', ...CMD_SEL], ['~', '^'], ['~', '^']]],
  ['execute', '/execute as|at|positioned|rotated|if|unless ... run <命令>', '链式执行（as 目标 / at 目标 / positioned 坐标 / if block / if entity）', [['as', 'at', 'positioned', 'rotated', 'if', 'unless', 'run'], CMD_SEL]],
  ['summon', '/summon <实体> [x y z]', '生成实体（含 lightning_bolt、tnt）', [() => [...CMD_MOBS(), 'lightning_bolt', 'experience_orb'], ...CMD_XYZ]],
  ['kill', '/kill [目标]', '杀死实体，如 /kill @e[type=zombie]', [CMD_SEL]],
  ['effect', '/effect give|clear <目标> [效果] [秒数] [等级] [隐藏粒子]', '给予或清除状态效果', [['give', 'clear'], CMD_SEL, CMD_EFFECTS, ['30', 'infinite'], ['0', '1', '2', '4', '9', '255'], ['true', 'false']]],
  ['enchant', '/enchant <目标> <魔咒> [等级]', '给手上的物品附魔', [CMD_SEL, CMD_ENCH]],
  ['xp', '/xp add|set|query <目标> <数量> [points|levels]', '经验（/xp 30L 也可以）', [['add', 'set', 'query'], CMD_SEL, [], ['points', 'levels']]],
  ['setblock', '/setblock <x y z> <方块> [destroy|keep|replace]', '放置方块，可带状态：oak_stairs[facing=east]', [['~'], ['~'], ['~'], CMD_BLOCKS, ['destroy', 'keep', 'replace']]],
  ['fill', '/fill <x1 y1 z1> <x2 y2 z2> <方块> [destroy|hollow|keep|outline|replace [过滤]]', '填充区域（最多 32768 格）', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], CMD_BLOCKS, ['destroy', 'hollow', 'keep', 'outline', 'replace'], CMD_BLOCKS]],
  ['clone', '/clone <x1 y1 z1> <x2 y2 z2> <目标 x y z> [replace|masked] [normal|force|move]', '复制区域', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['~'], ['replace', 'masked'], ['normal', 'force', 'move']]],
  ['gamerule', '/gamerule <规则> [值]', '查看或修改游戏规则', [CMD_RULES, ['true', 'false']]],
  ['locate', '/locate structure <结构>', '查找最近的结构', [['structure'], CMD_STRUCTS]],
  ['tpdim', '/tpdim <维度>', '直接前往某个维度', [CMD_DIMS]],
  ['spawnpoint', '/spawnpoint [目标] [x y z]', '设置重生点', [CMD_SEL, ...CMD_XYZ]],
  ['setworldspawn', '/setworldspawn [x y z]', '设置世界重生点', CMD_XYZ],
  ['title', '/title <目标> title|subtitle|actionbar|clear|reset|times <文本>', '在屏幕上显示标题', [CMD_SEL, ['title', 'subtitle', 'actionbar', 'clear', 'reset', 'times']]],
  ['tellraw', '/tellraw <目标> <JSON 文本>', '发送 JSON 格式的消息', [CMD_SEL]],
  ['say', '/say <消息>', '向所有人说话', []],
  ['me', '/me <动作>', '以第三人称说话', []],
  ['msg', '/msg <玩家> <消息>', '悄悄话', [CMD_SEL]],
  ['playsound', '/playsound <声音> [来源] [目标] [x y z] [音量] [音调]', '播放声音', [() => (typeof SOUND_EVENTS !== 'undefined' ? Object.keys(SOUND_EVENTS) : []), ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice'], CMD_SEL]],
  ['particle', '/particle <粒子> [x y z] [dx dy dz] [速度] [数量]', '显示粒子', [() => Object.keys(CMD_PARTICLES)]],
  ['damage', '/damage <目标> <伤害> [伤害类型]', '对实体造成伤害', [CMD_SEL]],
  ['ride', '/ride <目标> mount <载具> | dismount', '骑乘实体', [CMD_SEL, ['mount', 'dismount'], CMD_SEL]],
  ['tag', '/tag <目标> add|remove|list [标签]', '给实体加标签（选择器 tag= 可用）', [CMD_SEL, ['add', 'remove', 'list']]],
  ['defaultgamemode', '/defaultgamemode <模式>', '设置默认游戏模式', [CMD_MODES]],
  ['random', '/random value|roll <范围>', '随机数，如 /random roll 1..6', [['value', 'roll'], ['1..6', '1..100']]],
  ['list', '/list', '在线玩家', []],
  ['seed', '/seed', '显示世界种子', []],
  ['help', '/help', '打开这个命令列表', []],
];
// on a server: vanilla's commands (what this player may use is up to the server)
const CMDS_NET = [
  ['gamemode', '/gamemode <模式> [玩家]', '切换游戏模式', [CMD_MODES, CMD_PLAYERS]],
  ['time', '/time set|add|query <时间>', '设置 / 查询时间', [['set', 'add', 'query'], ['day', 'noon', 'night', 'midnight', 'daytime', 'gametime']]],
  ['weather', '/weather clear|rain|thunder [时长]', '设置天气', [['clear', 'rain', 'thunder']]],
  ['give', '/give <玩家> <物品> [数量]', '给予物品', [CMD_PLAYERS, CMD_ITEMS]],
  ['tp', '/tp <目标> | <x> <y> <z>', '传送', [(g) => ['~', ...CMD_PLAYERS(g)], ['~'], ['~']]],
  ['summon', '/summon <实体> [x y z]', '生成实体', [CMD_MOBS]],
  ['kill', '/kill [目标]', '杀死实体', [(g) => ['@e[type=', ...CMD_PLAYERS(g)]]],
  ['locate', '/locate structure <结构>', '查找最近的结构', [['structure', 'biome', 'poi'], CMD_STRUCTS]],
  ['effect', '/effect give <目标> <效果> [秒] [等级]', '给予状态效果', [['give', 'clear'], CMD_PLAYERS, () => Object.keys(EFFECTS)]],
  ['enchant', '/enchant <目标> <魔咒> [等级]', '给手上的物品附魔', [CMD_PLAYERS]],
  ['xp', '/xp add <目标> <数量> [levels]', '给予经验', [['add', 'set', 'query'], CMD_PLAYERS]],
  ['clear', '/clear [玩家] [物品]', '清除物品', [CMD_PLAYERS, CMD_ITEMS]],
  ['difficulty', '/difficulty <难度>', '设置难度', [['peaceful', 'easy', 'normal', 'hard']]],
  ['gamerule', '/gamerule <规则> [值]', '修改游戏规则', [['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning', 'mobGriefing', 'doFireTick', 'naturalRegeneration', 'showDeathMessages']]],
  ['setblock', '/setblock <x> <y> <z> <方块>', '放置方块', [['~'], ['~'], ['~'], CMD_ITEMS]],
  ['fill', '/fill <x1> <y1> <z1> <x2> <y2> <z2> <方块>', '填充区域', [['~'], ['~'], ['~'], ['~'], ['~'], ['~'], CMD_ITEMS]],
  ['spawnpoint', '/spawnpoint [玩家]', '设置重生点', [CMD_PLAYERS]],
  ['msg', '/msg <玩家> <消息>', '悄悄话', [CMD_PLAYERS]],
  ['me', '/me <动作>', '以第三人称说话', []],
  ['list', '/list', '在线玩家', []],
  ['seed', '/seed', '显示世界种子', []],
  ['help', '/help', '打开这个命令列表', []],
];
const cmdList = (g) => (g.net ? CMDS_NET : CMDS_LOCAL);

// words of a command with where each starts, quotes kept whole ("a b" is one argument) - offsets in the original text
function cmdTokens(text) {
  const out = []; let i = 0;
  while (i < text.length) {
    while (i < text.length && text[i] === ' ') i++;
    if (i >= text.length) break;
    const start = i; let q = null;
    while (i < text.length) { const ch = text[i]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ' ') break; i++; }
    out.push({ w: text.slice(start, i), start });
  }
  // a space after the last word means "the next argument is empty": all of its choices are shown
  if (text.endsWith(' ')) out.push({ w: '', start: text.length });
  return out;
}
const EXEC_KEYWORDS = ['as', 'at', 'positioned', 'rotated', 'facing', 'anchored', 'align', 'in', 'if', 'unless', 'run'];
const EXEC_IF = ['block', 'entity', 'score', 'dimension', 'data', 'predicate', 'biome', 'items', 'function'];

// ---- block states in arguments: /setblock ~ ~ ~ oak_stairs[ … --------------------------------
// vanilla lists each property (facing=, half=, waterlogged=) and then its values; without it a portal
// frame could not even be given its eye (players' feedback 2026-11-25)
const BLOCK_STATE_CACHE = {};
function blockStateProps(key) {
  if (BLOCK_STATE_CACHE[key]) return BLOCK_STATE_CACHE[key];
  const id = BID[key], b = id !== undefined ? BLOCKS[id] : null;
  const props = new Map();
  if (!b) return (BLOCK_STATE_CACHE[key] = props);
  const add = (k, v) => { if (!props.has(k)) props.set(k, []); const a = props.get(k); v = String(v); if (!a.includes(v)) a.push(v); };
  if (b.states) for (const st of b.states) for (const k in st) add(k, st[k]);
  // older hand-made blocks: every meta's vanilla state says what they can take (stairs, slabs, doors …)
  if (!b.states && typeof vanillaState === 'function') for (let m = 0; m < 64; m++) {
    try { const vs = vanillaState(b, m, null); for (const k in vs.p) add(k, vs.p[k]); } catch (e) { }
  }
  // the values the meta-only blocks keep in a few bits are not all reachable by counting metas
  if (b.stairs) { for (const f of ['east', 'west', 'north', 'south']) add('facing', f); for (const h of ['bottom', 'top']) add('half', h);
    for (const s of ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right']) add('shape', s); }
  if (b.slab) for (const t of ['bottom', 'top', 'double']) add('type', t);
  if (b.axis) for (const a of ['x', 'y', 'z']) add('axis', a);
  if (b.facing) for (const f of ['east', 'west', 'north', 'south']) add('facing', f);
  if (b.waterlogged) { add('waterlogged', 'true'); add('waterlogged', 'false'); }
  if (b.door) { add('half', 'lower'); add('half', 'upper'); add('hinge', 'left'); add('hinge', 'right'); add('open', 'true'); add('open', 'false'); }
  if (b.trapdoor) { add('open', 'true'); add('open', 'false'); }
  for (const k of props.keys()) props.get(k).sort();
  return (BLOCK_STATE_CACHE[key] = props);
}
function blockStateSuggest(last, at) {
  const lb = last.indexOf('[');
  if (lb < 0) return null;
  const key = last.slice(0, lb).replace(/^minecraft:/, '').replace(/^[^a-z0-9_]+/i, '');
  if (BID[key] === undefined) return null;
  const inside = last.slice(lb + 1);
  if (inside.includes(']')) return null;
  const segs = inside.split(','), used = new Set(segs.slice(0, -1).map((s) => s.split('=')[0].trim()));
  const cur = segs[segs.length - 1], props = blockStateProps(key);
  if (cur.includes('=')) {
    const eq = cur.indexOf('='), prop = cur.slice(0, eq).trim(), q = cur.slice(eq + 1).trim(), vals = props.get(prop) || [];
    const atV = at + lb + 1 + inside.length - cur.length + eq + 1;
    // 这是最后一个能多选的属性时顺手补上 ]，否则 Tab 补完 eye=true 命令会缺右括号、执行失败
    const left = [...props].filter(([p, vs]) => vs.length > 1 && !used.has(p) && p !== prop).length;
    const close = left === 0;
    return { list: vals.filter((v) => v.startsWith(q) && v !== q).slice(0, 50).map((v) => close ? v + ']' : v), at: atV, tight: true, usage: '/' + key + '[…]' };
  }
  const start = at + lb + 1 + inside.length - cur.length, q = cur.trim(), list = [];
  for (const [p, vals] of props) if (vals.length > 1 && !used.has(p) && p.startsWith(q)) list.push(p + '=');
  return { list: list.slice(0, 50), at: start, usage: '/' + key + '[…]' };
}
// the same for selectors: @e[type=, distance=, sort= … and the entity names after type=
const SELECTOR_PROPS = ['type=', 'name=', 'distance=', 'x=', 'y=', 'z=', 'dx=', 'dy=', 'dz=', 'tag=', 'team=', 'limit=', 'sort=', 'gamemode=', 'level=', 'scores=', 'nbt=', 'predicate=', 'advancements='];
function selectorSuggest(g, last, at) {
  const lb = last.indexOf('[');
  if (lb < 0) return null;
  const inside = last.slice(lb + 1);
  if (inside.includes(']')) return null;
  const segs = inside.split(','), used = new Set(segs.slice(0, -1).map((s) => s.split('=')[0].trim()));
  const cur = segs[segs.length - 1];
  if (cur.includes('=')) {
    const eq = cur.indexOf('='), prop = cur.slice(0, eq).trim(), q = cur.slice(eq + 1).trim();
    let vals = [];
    if (prop === 'type') vals = [...CMD_MOBS(), 'player', 'item', 'experience_orb', 'lightning_bolt'];
    else if (prop === 'gamemode') vals = CMD_MODES;
    else if (prop === 'sort') vals = ['nearest', 'furthest', 'random'];
    else if (prop === 'limit') vals = ['1', '2', '3', '5', '10'];
    const atV = at + lb + 1 + inside.length - cur.length + eq + 1;
    return { list: vals.filter((v) => v.startsWith(q) && v !== q).slice(0, 50), at: atV, tight: true, usage: '/@e[type=…]' };
  }
  const start = at + lb + 1 + inside.length - cur.length, q = cur.trim();
  return { list: SELECTOR_PROPS.filter((p) => !used.has(p.slice(0, -1)) && p.startsWith(q)).slice(0, 50), at: start, usage: '/@e[type=…]' };
}

// /execute's chain: as|at take a selector, positioned|rotated take ~ coordinates, if|unless a condition,
// and everything after "run" is just another command - that is where the suggestions for long chains were
// missing altogether ("超长指令里命令分支直接不显示", players' feedback 2026-11-25)
function executeSuggest(g, text, depth) {
  const toks = cmdTokens(text);
  if (toks.length < 2) return null;
  const last = toks[toks.length - 1], at = last.start, partial = last.w;
  // the last "run" that is followed by the rest of a command: the rest is suggested as a command of its own
  let run = -1;
  for (let i = toks.length - 1; i >= 1; i--) if (toks[i].w === 'run') { run = i; break; }
  if (run >= 0 && run < toks.length - 1 && depth < 3) {
    const start = toks[run + 1].start, sub = '/' + text.slice(start), r = cmdSuggest(g, sub, depth + 1);
    if (r) {
      // the sub-command already worked out which choices match (minecraft: included where it was typed)
      return { list: r.list, at: start + r.at - 1, tight: r.tight, usage: r.usage || '/execute … run <命令>' };
    }
  }
  const before = toks.slice(1, run >= 0 ? run : toks.length - 1);
  const prev = before.length ? before[before.length - 1].w : '';
  // if|unless block <x y z> <方块>, if|unless entity <选择器 …>
  const ki = before.findIndex((t) => t.w === 'if' || t.w === 'unless');
  const kind = ki >= 0 ? before[ki + 1] && before[ki + 1].w : '';
  const afterKind = ki >= 0 ? before.slice(ki + 2) : [];
  let choices;
  if (kind === 'block') {
    if (afterKind.length >= 3) {
      if (partial.includes('[')) { const ss = blockStateSuggest(partial, at); if (ss) return ss; }
      choices = CMD_BLOCKS;
    } else choices = ['~'];
  } else if (kind === 'entity') {
    if (partial.includes('[')) { const ss = selectorSuggest(g, partial, at); if (ss) return ss; }
    choices = CMD_SEL;
  } else if (prev === 'as' || prev === 'at') choices = [...CMD_SEL, '@e[type=', ...(g && g.net ? [...g.net.players.values()].filter(Boolean) : [])];
  else if (prev === 'positioned' || prev === 'rotated' || prev === 'align' || prev === 'anchored') choices = ['~'];
  else if (prev === 'if' || prev === 'unless') choices = EXEC_IF;
  else if (prev === 'in') choices = CMD_DIMS;
  else if (prev === 'facing') choices = ['~'];
  else if (prev === 'block' || prev === 'entity' || prev === 'score' || prev === 'data' || prev === 'predicate' || prev === 'biome' || prev === 'items') choices = [];
  else choices = EXEC_KEYWORDS;
  const list = (choices || []).filter((v) => v.startsWith(partial) && v !== partial);
  return { list: list.slice(0, 50), at, usage: '/execute … run <命令>' };
}

// the suggestions for what is typed so far: { list, at (where the word being completed starts), usage }; null if none
function cmdSuggest(g, text, depth) {
  depth = depth || 0;
  if (!text.startsWith('/')) return null;
  // (extra spaces don't count as empty words: suggestions went away after a double space)
  const words = text.slice(1).replace(/^ +/, '').split(/ +/), rawLast = words[words.length - 1];
  const last = rawLast.replace(/^minecraft:/, ''), prefixLen = rawLast.length - last.length;
  const at = text.length - rawLast.length;
  const cmds = cmdList(g);
  if (words.length === 1) {
    const list = cmds.map((c) => c[0]).filter((n) => n.startsWith(last));
    const exact = cmds.find((c) => c[0] === last);
    return { list: exact && list.length === 1 ? [] : list, at, usage: exact ? exact[1] : null };
  }
  if (words[0] === 'execute' && depth === 0) return executeSuggest(g, text, depth);
  const spec = cmds.find((c) => c[0] === words[0]);
  if (!spec) return null;
  let ch = spec[3][words.length - 2];
  const isBlocks = ch === CMD_BLOCKS;
  if (typeof ch === 'function') ch = ch(g);
  // inside […] a block lists its state properties and their values, a selector its arguments
  if (last.includes('[')) {
    const ss = last.startsWith('@') ? selectorSuggest(g, last, at + prefixLen) : (isBlocks ? blockStateSuggest(last, at + prefixLen) : null);
    if (ss) return { ...ss, usage: spec[1] };
  }
  const list = (ch || []).filter((v) => v.startsWith(last) && v !== last);
  // the ones starting with the word first, then the ones where a part of the name does (… _sword)
  if (last.length > 1 && ch && list.length < 10) for (const v of ch) if (!v.startsWith(last) && v.includes('_' + last) && !list.includes(v)) list.push(v);
  return { list: list.slice(0, 50), at, usage: spec[1] };
}

// ---- the chat box: suggestions drawn above it, Up / Down choose among them, Tab takes one ----
(() => {
  const _layout = ChatScreen.prototype.layout, _draw = ChatScreen.prototype.draw;
  ChatScreen.prototype.layout = function () {
    _layout.call(this);
    const el = this.game.ui.input, prev = el.onkeydown;
    this.sugSel = 0; this.sugFor = null;
    el.onkeydown = (e) => {
      const s = this.sug && this.sug.list.length ? this.sug : null;
      if (s && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); e.stopPropagation();
        this.sugSel = (this.sugSel + (e.key === 'ArrowUp' ? -1 : 1) + s.list.length) % s.list.length;
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (s) this.takeSuggestion(el); return; }
      // /help (with nothing after it) opens the list instead of asking anyone
      if (e.key === 'Enter' && el.value.trim() === '/help') { e.preventDefault(); e.stopPropagation(); this.game.ui.close(); this.game.ui.open(new CommandHelpScreen(this.game)); return; }
      prev(e);
    };
  };
  ChatScreen.prototype.takeSuggestion = function (el) {
    const s = this.sug; if (!s || !s.list.length) return;
    const v = s.list[this.sugSel] || s.list[0];
    el.value = el.value.slice(0, s.at) + v + (s.tight || v.endsWith('=') || v.endsWith('[') ? '' : ' ');
    this.sugSel = 0;
  };
  // cut a suggestion that would be wider than the screen, with … at the end
  ChatScreen.prototype.fitSuggestion = function (t, maxW) {
    if (Font.width(t) <= maxW) return t;
    let s = t;
    while (s.length && Font.width(s + '…') > maxW) s = s.slice(0, -1);
    return s + '…';
  };
  // where the list goes: under the word being typed, but never off the right of the screen - a long
  // /execute … run chain put it past the edge and nothing at all was drawn (players' feedback 2026-11-25)
  ChatScreen.prototype.sugBox = function (ui) {
    const s = this.sug; if (!s || !s.list.length) return null;
    const el = ui.input, v = el.value, y0 = ui.h - 14, maxW = Math.max(60, ui.w - 10);
    const n = Math.min(10, s.list.length), first = Math.max(0, Math.min(s.list.length - n, this.sugSel - 4));
    const shown = s.list.slice(first, first + n).map((t) => this.fitSuggestion(t, maxW - 4));
    const w = Math.min(maxW, Math.max(...shown.map((t) => Font.width(t))) + 2);
    let x0 = 4 + Font.width(v.slice(0, s.at));
    x0 = Math.max(2, Math.min(x0, ui.w - w - 3));
    return { n, first, shown, w, x0, y0 };
  };
  ChatScreen.prototype.draw = function (ui) {
    _draw.call(this, ui);
    const el = ui.input, v = el.value;
    if (v !== this.sugFor) { this.sugFor = v; this.sug = cmdSuggest(this.game, v); this.sugSel = 0; }
    const s = this.sug; if (!s) return;
    const c = ui.ctx, y0 = ui.h - 14;
    // the usage, just above the box (vanilla shows it in grey where the suggestions would be)
    if (!s.list.length) {
      if (s.usage) {
        const w = Math.min(ui.w - 6, Font.width(s.usage) + 2);
        let x = Math.max(2, Math.min(4 + Font.width(v.slice(0, s.at)), ui.w - w - 3));
        c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(x - 1, y0 - 12, w, 12);
        Font.draw(c, this.fitSuggestion(s.usage, w - 4), x + 1, y0 - 10, '#AAAAAA');
      }
      return;
    }
    // ten at a time around the chosen one, kept inside the screen
    const box = this.sugBox(ui); if (!box) return;
    c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(box.x0 - 1, y0 - 12 * box.n, box.w, 12 * box.n);
    box.shown.forEach((t, i) => Font.draw(c, t, box.x0, y0 - 12 * box.n + 2 + i * 12, box.first + i === this.sugSel ? '#FFFF00' : '#AAAAAA'));
    if (s.usage) {
      // to the right of the list where it fits; a long chain leaves no room there, so put it above the list
      const uw = Math.min(ui.w - 6, Font.width(s.usage) + 2);
      let ux = box.x0 + box.w + 4, uy = y0 - 10;
      if (ux + uw > ui.w) { ux = Math.max(2, Math.min(box.x0, ui.w - uw - 3)); uy = box.y0 - 12 * box.n - 12; }
      c.fillStyle = 'rgba(0,0,0,0.8)'; c.fillRect(ux - 1, uy - 2, uw, 12);
      Font.draw(c, this.fitSuggestion(s.usage, uw - 4), ux + 1, uy, '#AAAAAA');
    }
  };
  // a click on a suggestion takes it
  const _md = ChatScreen.prototype.mouseDown;
  ChatScreen.prototype.mouseDown = function (ui, mx, my, button) {
    const s = this.sug;
    if (s && s.list.length && button === 0) {
      const box = this.sugBox(ui); if (!box) return _md ? _md.call(this, ui, mx, my, button) : undefined;
      const i = Math.floor((my - (box.y0 - 12 * box.n)) / 12);
      if (mx >= box.x0 - 1 && mx <= box.x0 + box.w && my >= box.y0 - 12 * box.n && i >= 0 && i < box.n) {
        this.sugSel = box.first + i; this.takeSuggestion(ui.input); ui.input.focus(); return;
      }
    }
    if (_md) return _md.call(this, ui, mx, my, button);
  };
})();

// ---- /help: every command and what it does, a page at a time; a click puts it in the chat box ----
class CommandHelpScreen extends MenuScreen {
  constructor(game) { super(game, '命令'); this.page = 0; }
  layout() {
    const ui = this.game.ui, g = this.game, list = cmdList(g), cx = ui.w / 2;
    const per = Math.max(4, Math.floor((ui.h - 90) / 22)), pages = Math.ceil(list.length / per);
    this.page = clamp(this.page, 0, pages - 1);
    const bw = Math.min(420, ui.w - 20);
    this.widgets = list.slice(this.page * per, this.page * per + per).map((c, i) => ({
      // the usage and, where it fits, what it does
      x: cx - bw / 2, y: 44 + i * 22, w: bw, h: 20, label: Font.width(c[1] + '   ' + c[2]) < bw - 12 ? c[1] + '   ' + c[2] : c[1], tip: [c[2], '点击填入聊天框'],
      onClick: () => { ui.close(); ui.open(new ChatScreen(g, '/' + c[0] + (c[3].length ? ' ' : ''))); },
    }));
    const y = ui.h - 30;
    if (pages > 1) {
      this.widgets.push({ x: cx - 150, y, w: 70, h: 20, label: '<', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } });
      this.widgets.push({ x: cx + 80, y, w: 70, h: 20, label: '>', enabled: this.page < pages - 1, onClick: () => { this.page++; this.layout(); } });
      this.widgets.push({ text: `${this.page + 1} / ${pages}`, x: cx, y: y - 11, color: '#AAAAAA' });
    }
    this.widgets.push({ x: cx - 70, y, w: 140, h: 20, label: '完成', onClick: () => ui.close() });
  }
  drawExtra(ui) { Font.center(ui.ctx, this.game.net ? '服务器上能不能用由服务器决定' : (this.game.cheats ? '' : '这个世界没有开作弊，只有 /help /seed 等可用'), ui.w / 2, 32, '#AAAAAA'); }
}
