'use strict';
// ---------------------------------------------------------------------------
// JEI-style item and recipe lookup for OpusMC.
// The item list is every item this game has; the recipes come from the same
// vanilla data the crafting table uses (RECIPES / COOKING / STONECUTTING /
// SMITHING in blocks.js), so a recipe shown here is the recipe that will work.
// Recipe and Uses tabs, search, keyboard (J, R, U), mouse and touch.
// ---------------------------------------------------------------------------
class JEIScreen extends MenuScreen {
  constructor(game) {
    super(game, 'JEI 物品配方查询');
    this.search = ''; this.page = 0; this.sel = null; this.tab = 'recipe'; this.rpage = 0;
    this.searching = false; this.cols = 6; this.rows = 6; this.per = 36;
    this.sel = (typeof ITEM_KEY !== 'undefined' && ITEM_KEY.crafting_table !== undefined) ? ITEM_KEY.crafting_table : null;
    this.all = null;
  }
  items() {
    if (this.all) return this.all;
    const seen = new Set(), out = [];
    for (let i = 0; i < ITEMS.length; i++) {
      const d = ITEMS[i];
      if (!d || !d.key || d.key === 'air' || seen.has(i) || (BLOCKS[i] && BLOCKS[i].noItem)) continue;
      seen.add(i); out.push(i);
    }
    this.all = out;
    return out;
  }
  filtered() {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((id) => {
      const d = ITEMS[id]; if (!d) return false;
      return String(d.cn || '').toLowerCase().includes(q) || String(d.key || '').toLowerCase().includes(q);
    });
  }
  layout() {
    const u = this.game.ui, W = u.w, H = u.h;
    this.panel = { x: 3, y: 3, w: W - 6, h: H - 6 };
    const lw = Math.min(196, Math.max(126, Math.floor(W * 0.37)));
    this.listRect = { x: this.panel.x + 4, y: this.panel.y + 28, w: lw, h: this.panel.h - 56 };
    this.detailRect = { x: this.listRect.x + lw + 5, y: this.panel.y + 4, w: this.panel.x + this.panel.w - (this.listRect.x + lw + 5) - 4, h: this.panel.h - 8 };
    this.closeBtn = { x: this.panel.x + this.panel.w - 45, y: this.panel.y + 4, w: 40, h: 17 };
    this.searchRect = { x: this.listRect.x + 2, y: this.listRect.y + 2, w: this.listRect.w - 4, h: 16 };
    this.prevBtn = { x: this.listRect.x + 2, y: this.listRect.y + this.listRect.h - 18, w: 28, h: 16 };
    this.nextBtn = { x: this.listRect.x + this.listRect.w - 30, y: this.listRect.y + this.listRect.h - 18, w: 28, h: 16 };
    this.cols = Math.max(3, Math.floor((this.listRect.w - 4) / 21));
    this.rows = Math.max(2, Math.floor((this.listRect.h - 40) / 21));
    this.per = this.cols * this.rows;
    const list = this.filtered();
    this.pages = Math.max(1, Math.ceil(list.length / this.per));
    this.page = clamp(this.page, 0, this.pages - 1);
    this.cells = [];
    list.slice(this.page * this.per, this.page * this.per + this.per).forEach((id, i) => {
      this.cells.push({ x: this.listRect.x + 3 + (i % this.cols) * 21, y: this.listRect.y + 22 + Math.floor(i / this.cols) * 21, w: 20, h: 20, id });
    });
    this.tabRecipe = { x: this.detailRect.x + 2, y: this.detailRect.y + 26, w: 54, h: 17 };
    this.tabUses = { x: this.detailRect.x + 58, y: this.detailRect.y + 26, w: 54, h: 17 };
    this.rPrev = { x: this.detailRect.x + 2, y: this.detailRect.y + this.detailRect.h - 18, w: 24, h: 16 };
    this.rNext = { x: this.detailRect.x + 29, y: this.detailRect.y + this.detailRect.h - 18, w: 24, h: 16 };
    this.rpage = Math.max(0, this.rpage || 0);
  }
  // ---- recipe data -----------------------------------------------------------
  ingHas(alts, id) { return (alts || []).includes(id); }
  recipesFor(id) {
    const out = [];
    for (const r of (typeof RECIPES !== 'undefined' ? RECIPES : [])) if (r.result === id) out.push({ kind: 'crafting', r });
    for (const kind in (typeof COOKING !== 'undefined' ? COOKING : {})) {
      for (const inId in COOKING[kind]) if (COOKING[kind][inId].result === id) out.push({ kind, input: +inId, rec: COOKING[kind][inId] });
    }
    for (const inId in (typeof STONECUTTING !== 'undefined' ? STONECUTTING : {})) {
      for (const rec of STONECUTTING[inId]) if (rec.result === id) out.push({ kind: 'stonecutting', input: +inId, rec });
    }
    for (const s of (typeof SMITHING !== 'undefined' ? SMITHING : [])) if (s.result === id) out.push({ kind: 'smithing', s });
    return out;
  }
  usesFor(id) {
    const out = [];
    for (const r of (typeof RECIPES !== 'undefined' ? RECIPES : [])) {
      const ing = r.type === 'shaped' ? Object.values(r.keys || {}) : (r.ing || []);
      if (ing.some((alts) => this.ingHas(alts, id))) out.push({ kind: 'crafting', r });
    }
    for (const kind in (typeof COOKING !== 'undefined' ? COOKING : {})) {
      for (const inId in COOKING[kind]) if (+inId === id) out.push({ kind, input: +inId, rec: COOKING[kind][inId] });
    }
    for (const inId in (typeof STONECUTTING !== 'undefined' ? STONECUTTING : {})) {
      if (+inId === id) for (const rec of STONECUTTING[inId]) out.push({ kind: 'stonecutting', input: +inId, rec });
    }
    for (const s of (typeof SMITHING !== 'undefined' ? SMITHING : [])) {
      if (this.ingHas(s.template, id) || this.ingHas(s.base, id) || this.ingHas(s.addition, id)) out.push({ kind: 'smithing', s });
    }
    return out;
  }
  entries() {
    if (!this.sel) return [];
    const key = this.sel + '|' + this.tab;
    if (this._ek !== key) {
      this._ek = key;
      this._entries = this.tab === 'uses' ? this.usesFor(this.sel) : this.recipesFor(this.sel);
    }
    return this._entries || [];
  }
  label(e) {
    if (e.kind === 'crafting') return '工作台合成';
    if (e.kind === 'smelting') return '熔炉烧炼';
    if (e.kind === 'blasting') return '高炉烧炼';
    if (e.kind === 'smoking') return '烟熏炉烹饪';
    if (e.kind === 'campfire_cooking') return '营火烹饪';
    if (e.kind === 'stonecutting') return '切石机';
    if (e.kind === 'smithing') return '锻造台';
    return e.kind;
  }
  // ---- drawing helpers -------------------------------------------------------
  btn(c, r, text, on) {
    c.fillStyle = on ? '#6C6C6C' : '#454545'; c.fillRect(r.x, r.y, r.w, r.h);
    c.fillStyle = on ? '#DDDDDD' : '#A0A0A0'; c.fillRect(r.x + 1, r.y + 1, r.w - 2, 1);
    Font.center(c, text, r.x + r.w / 2, r.y + 5, on ? '#202020' : '#DDDDDD');
  }
  drawItem(ui, id, x, y, count) {
    if (id === undefined || id === null || !ITEMS[id]) return;
    ui.drawItem({ id, count: count || 1 }, x, y);
  }
  drawGrid(ui, r, dx, dy, w, h) {
    const c = ui.ctx;
    const slot = Math.max(11, Math.min(20, Math.floor(Math.min((w - 78) / 3, (h - 18) / 3))));
    const gx = dx + Math.max(4, Math.floor((w - slot * 3 - 54) / 2));
    const gy = dy + 24;
    const grid = new Array(9).fill(null);
    if (r.type === 'shaped') {
      for (let y = 0; y < Math.min(3, r.h); y++) for (let x = 0; x < Math.min(3, r.w); x++) {
        const ch = r.pattern[y][x];
        if (ch && ch !== ' ') { const alts = r.keys[ch]; if (alts && alts.length) grid[y * 3 + x] = alts[0]; }
      }
    } else {
      (r.ing || []).slice(0, 9).forEach((alts, i) => { if (alts && alts.length) grid[i] = alts[0]; });
    }
    for (let i = 0; i < 9; i++) {
      const x = gx + (i % 3) * slot, y = gy + Math.floor(i / 3) * slot;
      c.fillStyle = '#2A2A2A'; c.fillRect(x, y, slot, slot);
      c.strokeStyle = '#5A5A5A'; c.strokeRect(x + .5, y + .5, slot - 1, slot - 1);
      if (grid[i] !== null) this.drawItem(ui, grid[i], x + 1, y + 1);
    }
    // result + arrow
    const ox = gx + slot * 3 + 14, oy = gy + slot + Math.floor(slot / 2) - 8;
    Font.draw(c, '→', gx + slot * 3 + 3, gy + slot + 1, '#FFFFFF');
    c.fillStyle = '#2A2A2A'; c.fillRect(ox, oy, slot, slot);
    c.strokeStyle = '#8A6A2A'; c.strokeRect(ox + .5, oy + .5, slot - 1, slot - 1);
    this.drawItem(ui, r.result, ox + 1, oy + 1, r.count);
    // result name under the arrow (tiny, clipped to the detail panel)
    if (h > 80) Font.center(c, fitText(ITEMS[r.result] ? ITEMS[r.result].cn : ''), dx + w / 2, dy + h - 14, '#D0D0D0');
  }
  drawSingle(ui, e, dx, dy, w, h) {
    const c = ui.ctx, kind = e.kind;
    if (kind === 'crafting') return this.drawGrid(ui, e.r, dx, dy, w, h);
    Font.draw(c, this.label(e), dx + 4, dy + 2, '#FFFF55');
    const slot = 20;
    if (kind === 'stonecutting') {
      const ix = dx + 12, iy = dy + 26;
      this.drawItem(ui, e.input, ix, iy); Font.draw(c, '→', ix + 24, iy + 4, '#FFFFFF');
      this.drawItem(ui, e.rec.result, ix + 42, iy, e.rec.count);
    } else if (kind === 'smithing') {
      const s = e.s, iy = dy + 26;
      this.drawItem(ui, s.template[0], dx + 8, iy); Font.draw(c, '+', dx + 29, iy + 4, '#FFFFFF');
      this.drawItem(ui, s.base[0], dx + 41, iy); Font.draw(c, '+', dx + 62, iy + 4, '#FFFFFF');
      this.drawItem(ui, s.addition[0], dx + 74, iy); Font.draw(c, '→', dx + 96, iy + 4, '#FFFFFF');
      if (s.result !== null) this.drawItem(ui, s.result, dx + 114, iy);
      Font.center(c, '锻造模板 + 底材 + 添加物', dx + w / 2, dy + h - 14, '#D0D0D0');
    } else {
      const ix = dx + 12, iy = dy + 26;
      this.drawItem(ui, e.input, ix, iy); Font.draw(c, '→', ix + 24, iy + 4, '#FFFFFF');
      this.drawItem(ui, e.rec.result, ix + 42, iy);
      if (e.rec.time) Font.draw(c, Math.round(e.rec.time / 20) + ' 秒', dx + 72, iy + 4, '#B0B0B0');
    }
    if (kind !== 'smithing') Font.center(c, fitText(ITEMS[e.rec.result] ? ITEMS[e.rec.result].cn : ''), dx + w / 2, dy + h - 14, '#D0D0D0');
  }
  drawDetail(ui) {
    const c = ui.ctx, d = this.detailRect;
    if (!this.sel) {
      Font.draw(c, '从左边选一个物品', d.x + 6, d.y + 8, '#B0B0B0');
      Font.draw(c, 'J 打开，R 配方，U 用途', d.x + 6, d.y + 22, '#808080');
      return;
    }
    const it = ITEMS[this.sel];
    this.drawItem(ui, this.sel, d.x + 2, d.y + 2);
    Font.draw(c, fitText(it.cn || it.key, d.w - 28), d.x + 23, d.y + 6, '#FFFFFF');
    Font.draw(c, '#' + (it.key || '') , d.x + 23, d.y + 16, '#707070');
    this.btn(c, this.tabRecipe, '配方', this.tab === 'recipe');
    this.btn(c, this.tabUses, '用途', this.tab === 'uses');
    const list = this.entries();
    if (!list.length) {
      Font.draw(c, this.tab === 'uses' ? '没有找到用到它的配方' : '这个物品没有配方', d.x + 6, d.y + 50, '#FFAA55');
      return;
    }
    this.rpage = clamp(this.rpage, 0, list.length - 1);
    const e = list[this.rpage];
    Font.draw(c, (this.tab === 'uses' ? '用于：' : '') + this.label(e), d.x + 3, d.y + 45, '#FFFF55');
    this.drawSingle(ui, e, d.x + 2, d.y + 54, d.w - 4, d.h - 78);
    Font.draw(c, (this.rpage + 1) + '/' + list.length, d.x + d.w - 30, d.y + 31, '#A0A0A0');
  }
  draw(ui) {
    const c = ui.ctx, p = this.panel, d = this.detailRect;
    ui.dim(0.78);
    c.fillStyle = 'rgba(14,14,14,0.96)'; c.fillRect(p.x, p.y, p.w, p.h);
    c.strokeStyle = '#707070'; c.strokeRect(p.x + .5, p.y + .5, p.w - 1, p.h - 1);
    Font.draw(c, 'JEI 物品配方查询', p.x + 5, p.y + 5, '#FFFFFF');
    this.btn(c, this.closeBtn, '关闭', ui.hit(this.closeBtn));
    // search
    c.fillStyle = '#252525'; c.fillRect(this.searchRect.x, this.searchRect.y, this.searchRect.w, this.searchRect.h);
    c.strokeStyle = '#666666'; c.strokeRect(this.searchRect.x + .5, this.searchRect.y + .5, this.searchRect.w - 1, this.searchRect.h - 1);
    if (!this.searching && !this.search) Font.draw(c, '搜索物品…', this.searchRect.x + 3, this.searchRect.y + 4, '#777777');
    else if (!this.searching) Font.draw(c, fitText(this.search, this.searchRect.w - 6), this.searchRect.x + 3, this.searchRect.y + 4, '#E0E0E0');
    // item cells
    for (const cell of this.cells) {
      c.fillStyle = cell.id === this.sel ? 'rgba(255,220,90,0.22)' : 'rgba(255,255,255,0.04)';
      c.fillRect(cell.x, cell.y, cell.w, cell.h);
      c.strokeStyle = cell.id === this.sel ? '#FFD24A' : '#4D4D4D';
      c.strokeRect(cell.x + .5, cell.y + .5, cell.w - 1, cell.h - 1);
      this.drawItem(ui, cell.id, cell.x + 2, cell.y + 2);
    }
    Font.center(c, (this.page + 1) + '/' + this.pages + '  ' + this.filtered().length + ' 个物品', this.listRect.x + this.listRect.w / 2, this.listRect.y + this.listRect.h - 14, '#909090');
    if (this.pages > 1) { this.btn(c, this.prevBtn, '上页', ui.hit(this.prevBtn)); this.btn(c, this.nextBtn, '下页', ui.hit(this.nextBtn)); }
    // detail
    c.fillStyle = 'rgba(255,255,255,0.035)'; c.fillRect(d.x, d.y, d.w, d.h);
    c.strokeStyle = '#505050'; c.strokeRect(d.x + .5, d.y + .5, d.w - 1, d.h - 1);
    this.drawDetail(ui);
    const list = this.entries();
    if (list.length > 1) { this.btn(c, this.rPrev, '‹', ui.hit(this.rPrev)); this.btn(c, this.rNext, '›', ui.hit(this.rNext)); }
    // hovered item name at the bottom of the list
    const hov = this.cells.find((x) => ui.hit(x));
    if (hov) Font.draw(c, fitText(ITEMS[hov.id].cn || ITEMS[hov.id].key, this.listRect.w - 6), this.listRect.x + 3, this.listRect.y + this.listRect.h - 28, '#FFFFFF');
  }
  // ---- input -----------------------------------------------------------------
  openSearch() {
    const ui = this.game.ui, r = this.searchRect;
    this.searching = true;
    ui.showInput(r.x, r.y, r.w, r.h, this.search, () => { this.searching = false; this.page = 0; this.layout(); }, {
      onInput: (v) => { this.search = v; this.page = 0; this.layout(); },
      onEsc: () => { ui.hideInput(); this.searching = false; },
      max: 40,
    });
  }
  mouseDown(ui, mx, my, button) {
    if (button !== 0) return;
    if (ui.hit(this.closeBtn, mx, my)) { ui.close(); return; }
    if (ui.hit(this.searchRect, mx, my)) { this.openSearch(); return; }
    if (this.pages > 1 && ui.hit(this.prevBtn, mx, my)) { this.page--; this.layout(); Sound.click(); return; }
    if (this.pages > 1 && ui.hit(this.nextBtn, mx, my)) { this.page++; this.layout(); Sound.click(); return; }
    for (const cell of this.cells) if (ui.hit(cell, mx, my)) { this.sel = cell.id; this.rpage = 0; this._ek = null; Sound.click(); return; }
    if (ui.hit(this.tabRecipe, mx, my)) { this.tab = 'recipe'; this.rpage = 0; this._ek = null; Sound.click(); return; }
    if (ui.hit(this.tabUses, mx, my)) { this.tab = 'uses'; this.rpage = 0; this._ek = null; Sound.click(); return; }
    const n = this.entries().length;
    if (n > 1 && ui.hit(this.rPrev, mx, my)) { this.rpage = (this.rpage + n - 1) % n; Sound.click(); return; }
    if (n > 1 && ui.hit(this.rNext, mx, my)) { this.rpage = (this.rpage + 1) % n; Sound.click(); return; }
  }
  wheel(ui, dy) {
    if (ui.hit(this.listRect)) { this.page += Math.sign(dy); this.layout(); return; }
    const n = this.entries().length;
    if (n > 1 && ui.hit(this.detailRect)) { this.rpage = (this.rpage + (dy > 0 ? 1 : -1) + n) % n; }
  }
  key(ui, ev) {
    if (ev.key === 'Escape') { ui.close(); return true; }
    if (ev.key === 'r' || ev.key === 'R') { this.tab = 'recipe'; this.rpage = 0; this._ek = null; return true; }
    if (ev.key === 'u' || ev.key === 'U') { this.tab = 'uses'; this.rpage = 0; this._ek = null; return true; }
    return false;
  }
}
