'use strict';
// ---------------------------------------------------------------------------
// Menu screens
// ---------------------------------------------------------------------------
const SPLASHES = ['也试试 Java 版！', '100% 纯手工打造！', '方块！', '在浏览器里运行！', '无需安装！', '还有苦力怕！', '挖矿与合成！', 'WebGL2！', '平滑光照！', '流动的水！', '会爆炸的 TNT！', '自带昼夜循环！', '小心岩浆！', '钻石！', '羊毛有很多颜色！'];

// importing a vanilla world (anvil.js): progress, then what came over and what didn't
class ImportScreen extends MenuScreen {
  constructor(game, parent, files) {
    super(game, '导入原版存档'); this.parent = parent; this.titleY = 20; this.p = 0; this.stats = null; this.result = null; this.error = null;
    VanillaImport.run(game, files, (p, s) => { this.p = p; this.stats = s; })
      .then((r) => { this.result = r; this.layout(); }, (e) => { console.error(e); this.error = String(e && e.message || e); this.layout(); });
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    this.widgets = [];
    if (this.result) {
      this.widgets.push({ x: cx - 154, y: u.h - 40, w: 150, h: 20, label: '进入世界', onClick: () => g.loadWorld(this.result.meta.id) });
      this.widgets.push({ x: cx + 4, y: u.h - 40, w: 150, h: 20, label: '返回', onClick: () => g.ui.open(new WorldListScreen(g)) });
    } else if (this.error) this.widgets.push({ x: cx - 100, y: u.h - 40, w: 200, h: 20, label: '返回', onClick: () => g.ui.open(new WorldListScreen(g)) });
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2;
    let y = 44;
    const line = (t, col = '#FFFFFF') => { Font.center(c, t, cx, y, col); y += 11; };
    if (this.error) { line('导入失败', '#FF5555'); y += 4; line(this.error, '#FFFFFF'); return; }
    const s = this.result ? this.result.stats : this.stats;
    if (!this.result) {
      line('正在读取区块…');
      const bw = 182, bx = Math.floor(cx - bw / 2);
      c.fillStyle = '#808080'; c.fillRect(bx, y + 2, bw, 3);
      c.fillStyle = '#80FF80'; c.fillRect(bx, y + 2, Math.floor(bw * this.p), 3);
      y += 12;
      if (s) line(`已导入 ${s.chunks} 个区块，区域文件 ${s.regions} 个`, '#A0A0A0');
      return;
    }
    const m = this.result.meta, dn = { overworld: '主世界', nether: '下界', end: '末地' };
    line(`“${m.name}” 导入完成`, '#55FF55');
    line(`原版 ${m.imported.version}，种子 ${m.seed}`, '#A0A0A0');
    line('区块：' + Object.entries(s.perDim).map(([d, n]) => `${dn[d] || d} ${n}`).join('，') + `；箱子和熔炉 ${s.containers} 个；生物和载具等 ${s.entities || 0} 个`);
    if (s.entitiesMissing && s.entitiesMissing.length) line('本游戏还没有、没导入的实体：' + s.entitiesMissing.slice(0, 4).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    if (s.partial || s.old || s.skipped) line(`未完成生成的区块 ${s.partial} 个（进入后由生成器补全）` + (s.old ? `，1.18 以前格式 ${s.old} 个` : '') + (s.skipped ? `，无法读取 ${s.skipped} 个` : ''), '#A0A0A0');
    if (s.substituted && s.substituted.length) {
      line(`本游戏还没有、以相近方块代替的：${s.substituted.length} 种`, '#FFFF55');
      line(s.substituted.slice(0, 5).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    }
    if (s.missing.length) {
      line(`本游戏还没有、以空气代替的：${s.missing.length} 种`, '#FFFF55');
      line(s.missing.slice(0, 5).map(([n, k]) => `${n} ×${k}`).join('，'), '#A0A0A0');
    }
    y += 4; line('没探索过的地方会按同一个种子生成，和原版地形一致', '#A0A0A0');
  }
  onEsc() { if (this.result || this.error) this.game.ui.open(new WorldListScreen(this.game)); }
}

class LoadingScreen extends MenuScreen {
  // vanilla 26.3 LevelLoadingScreen: the nether-portal texture fills the screen, a small chunk
  // status grid sits in the middle, "正在下载地形" above it and a 200x2 green progress bar under the text
  constructor(game, text) {
    super(game, null); this.text = '正在下载地形'; this.blurBg = false; this.bgDirt = false; this.bgDim = 0; this.pauses = false; this.queue = null;
    this.MAP_R = 7; // Minecraft.doWorldLoad: max(5,3) + ChunkLevel.RADIUS_AROUND_FULL_CHUNK + 1, 15 x 15 chunks
  }
  setQueue(q) {
    const was = !!this.queue;
    this.queue = q ? { ...q, since: (this.queue && this.queue.since) || performance.now() } : null;
    if (was !== !!q) this.layout();
  }
  layout() {
    const u = this.game.ui, g = this.game, cx = u.w / 2;
    this.widgets = !this.queue ? [] : [
      { x: cx - 100, y: u.h / 2 + 60, w: 200, h: 20, label: '去公开房间（加入正在玩的）', onClick: () => { g.leaveServer(); onlineGate(g, () => g.ui.open(new MultiplayerScreen(g, null)), null); } },
      { x: cx - 100, y: u.h / 2 + 84, w: 200, h: 20, label: '取消排队', onClick: () => { g.leaveServer(); } },
    ];
  }
  chunkColor(ch, isSpawn) {
    // 26.3 ChunkStatus colors (ChunkLoadStatusView). The browser generator runs several
    // stages synchronously, so the finest distinctions it can expose are: terrain arrays
    // still being filled, light not initialised yet, mesh/features pending, spawn, full.
    if (!ch) return '#545454';              // EMPTY
    if (ch.blocks) return '#303572';        // TERRAIN
    if (!ch.lit) return '#CCCCCC';          // INITIALIZE_LIGHT
    if (isSpawn) return '#F26060';          // SPAWN
    if (ch.dirty) return '#21C600';         // FEATURES
    return '#FFFFFF';                       // FULL
  }
  // 26.3 singleplayer world load uses Reason.OTHER: the blurred title panorama, darkened, behind the chunk map
  // (the nether-portal background is only for the portal-travel loading reason, which this port does not use)
  loadingBg(ui) {
    if (this.bgTile === undefined) {
      this.bgTile = null;
      try {
        const im = (typeof Panorama !== 'undefined' && Panorama.ready && Panorama.ready()) ? Panorama.img : null;
        if (im) {
          const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360;
          const x = cv.getContext('2d'); x.imageSmoothingEnabled = true;
          x.filter = 'blur(9px) saturate(0.85)';
          x.drawImage(im, 0, 0, im.naturalWidth / 3, im.naturalHeight / 2, 0, 0, cv.width, cv.height);
          x.filter = 'none';
          this.bgTile = cv;
        }
      } catch (e) { }
    }
    if (this.bgTile) {
      const c = ui.ctx, s = Math.max(ui.w / this.bgTile.width, ui.h / this.bgTile.height);
      const dw = this.bgTile.width * s, dh = this.bgTile.height * s;
      c.drawImage(this.bgTile, (ui.w - dw) / 2, (ui.h - dh) / 2, dw, dh);
      // vanilla Reason.OTHER draws panorama + blurred panorama + the 25%-alpha black menu veil over it.
      // use tile() instead of menuBackground(): the latter asks for a whole-canvas CSS blur, which
      // would also blur the chunk map and text drawn later in this screen
      ui.tile('menu_bg', 0, 0, ui.w, ui.h);
    } else { ui.tile('menu_bg', 0, 0, ui.w, ui.h); ui.dim(0.35); }
  }
  drawExtra(ui) {
    const c = ui.ctx, g = this.game, q = this.queue;
    this.loadingBg(ui);
    if (q) {
      Font.center(c, '服务器上的房间已经满了，正在排队', ui.w / 2, ui.h / 2 - 30, '#FFFFFF');
      Font.center(c, `你的房间排在第 ${q.pos} 位（一共 ${q.of} 个在等），有位置时会自动启动`, ui.w / 2, ui.h / 2 - 14, '#A0A0A0');
      const secs = Math.floor((performance.now() - q.since) / 1000);
      Font.center(c, `已经等了 ${Math.floor(secs / 60)} 分 ${secs % 60} 秒`, ui.w / 2, ui.h / 2 + 2, '#A0A0A0');
      if (secs >= 120) Font.center(c, '等太久的话，可以先加入正在玩的公开房间，或者在「联机」里开本地房间', ui.w / 2, ui.h / 2 + 30, '#FFFF55');
      return;
    }
    const R = this.MAP_R, N = R * 2 + 1, cell = 2, total = cell * N;
    const cx = Math.floor(ui.w / 2), cy = Math.floor(ui.h / 2);
    const x0 = cx - Math.floor(total / 2), y0 = cy - Math.floor(total / 2);
    const p = g.player;
    const pcx = Math.floor((p ? p.pos[0] : 0) / 16), pcz = Math.floor((p ? p.pos[2] : 0) / 16);
    for (let dz = 0; dz < N; dz++) for (let dx = 0; dx < N; dx++) {
      const ch = g.world ? g.world.getChunk(pcx + dx - R, pcz + dz - R) : null;
      c.fillStyle = this.chunkColor(ch, dx === R && dz === R);
      c.fillRect(x0 + dx * cell, y0 + dz * cell, cell, cell);
    }
    // vanilla: centered "正在下载地形" above the map, progress bar just below the text
    const textTop = cy - R * 2 - 27; // yCenter - statusView.radius()*2 - 9*3
    Font.center(c, '正在下载地形', cx, textTop, '#FFFFFF');
    const bw = Math.min(200, ui.w - 16), bh = 2, bx = Math.floor(cx - bw / 2), by = textTop + 12;
    const pct = Math.max(0, Math.min(1, g.loadProgress || 0));
    c.fillStyle = '#000000'; c.fillRect(bx, by, bw, bh);
    c.fillStyle = '#00FF00'; c.fillRect(bx, by, Math.round(bw * pct), bh);
  }
}

// vanilla 26.x title screen (LogoRenderer / SplashRenderer positions); the live world replaces the panorama
class TitleScreen extends MenuScreen {
  constructor(game) {
    super(game, null); this.blurBg = false; this.bgDim = 0; this.splash = SPLASHES[(Math.random() * SPLASHES.length) | 0];
    if (typeof StartupMedia !== 'undefined') StartupMedia.titleVideo(); // 设置里开了就铺在标题世界后面
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    const short = u.h < 210;
    const l = short ? 52 : Math.floor(u.h / 4 + 48);
    const a = short ? 20 : 24, b = short ? 40 : 48, c = short ? 60 : 84;
    this.short = short; this.l = l;
    this.widgets = [
      { x: cx - 100, y: l, w: 200, h: 20, label: '单人游戏', onClick: () => singleGate(g, () => g.ui.open(new WorldListScreen(g)), this) },
      { x: cx - 100, y: l + a, w: 200, h: 20, label: '多人游戏', onClick: () => onlineGate(g, () => g.ui.open(new MultiplayerScreen(g, this)), this), tip: ['加入公开房间、用邀请码加入朋友的房间，或者自己开一个（4–10 人）'] },
      { x: cx - 100, y: l + b, w: 64, h: 20, label: '皮肤', tip: ['换皮肤（也可以用正版玩家的皮肤）、穿上原创披风、帽子和宠物'], onClick: () => g.ui.open(new WardrobeScreen(g, this)) },
      { x: cx - 32, y: l + b, w: 64, h: 20, label: '模组', gold: true, tip: ['仅单机生效的高级模组：连锁挖掘、矿透视、苹果皮'], onClick: () => g.ui.open(new ModsScreen(g, this)) },
      { x: cx + 36, y: l + b, w: 64, h: 20, label: '反馈', tip: ['遇到 bug、卡顿，或者有建议，发给我们'], onClick: () => g.ui.open(new FeedbackScreen(g, this, null)) },
      { x: cx - 152, y: l + c, w: 48, h: 20, label: '说明', tip: ['游戏操作与玩法说明'], onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx - 100, y: l + c, w: 98, h: 20, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      { x: cx + 2, y: l + c, w: 98, h: 20, label: '退出游戏', onClick: () => quitGame(g) },
      // (no 全屏 where the page can't go full screen: iPhones - see toggleFullscreen)
      fsSupported() ? { x: cx + 104, y: l + c, w: 20, h: 20, icon: 'icon_accessibility', tip: ['全屏'], onClick: () => toggleFullscreen() } : null,
    ].filter(Boolean);
    // the account (top left) and, until everything is unlocked, the way to unlock it (top right)
    if (Account.loggedIn) this.widgets.push({ x: 4, y: 4, w: Math.min(120, Font.width(Account.name) + 30), h: 18, label: fitText(Account.name, 110), tip: ['账号：游戏名、识别码、退出登录'], onClick: () => g.ui.open(new AccountScreen(g, this)) });
    else this.widgets.push({ x: 4, y: 4, w: 60, h: 18, gold: true, label: '登录', tip: ['登录后可以联机、云存档、换皮肤和披风'], onClick: () => g.ui.open(new LoginScreen(g, () => g.ui.open(new TitleScreen(g)))) });
    if (Account.loggedIn && !Account.allUnlocked() && !short) this.widgets.push({ x: u.w - 112, y: 4, w: 108, h: 18, gold: true, label: '解锁披风和联机', onClick: () => g.ui.open(new UnlockScreen(g, this)) });
  }
  drawExtra(ui) {
    const c = ui.ctx, w = ui.w, lg = ui.img.logo, ed = ui.img.edition;
    // 设置里开了「主菜单背景视频」：把视频帧铺在标题界面后面（UI 画布不透明，不能用 DOM 层级盖）
    if (typeof StartupMedia !== 'undefined') {
      const v = StartupMedia.videoEl();
      if (v) {
        const s = Math.max(w / v.videoWidth, ui.h / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
        c.drawImage(v, (w - dw) / 2, (ui.h - dh) / 2, dw, dh);
        c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, w, ui.h);
      }
    }
    // LogoRenderer: blit(logo, w/2-128, 30, 0, 0, 256, 44, 256, 64); blit(edition, w/2-64, 67, 0, 0, 128, 14, 128, 16)
    const short = !!this.short, lw = short ? 200 : 256, lh = short ? 34 : 44, ly = short ? 10 : 30;
    const lx = short ? Math.floor(w / 2 - lw / 2) : Math.floor(w / 2 - 128);
    c.imageSmoothingEnabled = true;
    c.drawImage(lg, 0, 0, lg.width, lg.height * 44 / 64, lx, ly, lw, lh);
    if (!short) c.drawImage(ed, 0, 0, ed.width, ed.height * 14 / 16, lx + 64, ly + 37, 128, 14);
    c.imageSmoothingEnabled = false;
    // SplashRenderer (the small screens have no room between the logo and the buttons)
    if (!short) {
      c.save();
      c.translate(w / 2 + 123, 69);
      c.rotate(-20 * Math.PI / 180);
      let s = 1.8 - Math.abs(Math.sin((performance.now() % 1000) / 1000 * Math.PI * 2) * 0.1);
      s = s * 100 / (Font.width(this.splash) + 32);
      c.scale(s, s);
      Font.center(c, this.splash, 0, -8, '#FFFF00');
      c.restore();
    }
    // 「退出游戏」could not close the page (quitGame)
    if (this.quitTip && performance.now() - this.quitTip < 6000) {
      const q = '这里不能直接关闭网页，请用返回键或关闭标签页退出', l = this.l + 108;
      c.globalAlpha = 0.6; c.fillStyle = '#000'; c.fillRect(Math.floor(w / 2 - Font.width(q) / 2 - 4), l - 2, Font.width(q) + 8, 12); c.globalAlpha = 1;
      Font.center(c, q, w / 2, l, '#FFFF55');
    }
    Font.draw(c, '原作者：OpusMC（B站 Toy 平台）', 2, ui.h - 10, '#FFFFFF');
    const t = '本页二创部署：xiaopingzai · 非官方作品，仅供学习交流';
    Font.draw(c, t, ui.w - Font.width(t) - 2, ui.h - 10, '#FFFFFF');
  }
}

// vanilla SelectWorldScreen + WorldSelectionList
class WorldListScreen extends MenuScreen {
  constructor(game) {
    super(game, '选择世界'); this.titleY = 8; this.worlds = null; this.sel = -1; this.scroll = 0; this.filter = ''; this.icons = {};
    // (storage that fails - blocked, full, a broken database: said, instead of 加载世界列表中 for ever)
    DB.listWorlds().then(w => { this.worlds = w; this.layout(); })
      .catch((e) => { console.error(e); this.worlds = []; this.loadErr = '读取存档失败: ' + String(e && e.message || e); this.layout(); });
  }
  shown() { return (this.worlds || []).filter(w => !this.filter || w.name.toLowerCase().includes(this.filter.toLowerCase())); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    const list = this.shown(), has = this.sel >= 0 && !!list[this.sel];
    this.widgets = [
      { x: cx - 154, y: u.h - 76, w: 150, h: 20, label: '导入原版存档（文件夹）', onClick: () => this.pick(true), tip: ['选择原版 Java 版存档的世界文件夹', '（里面有 level.dat），支持 1.18 及以上'] },
      { x: cx + 4, y: u.h - 76, w: 150, h: 20, label: '导入原版存档（.zip）', onClick: () => this.pick(false), tip: ['选择打包成 .zip 的原版世界存档', '手机上请用这个'] },
      { x: cx - 154, y: u.h - 52, w: 150, h: 20, label: '进入选中的世界', enabled: has, onClick: () => this.play() },
      { x: cx + 4, y: u.h - 52, w: 150, h: 20, label: '创建新的世界', onClick: () => g.ui.open(new CreateWorldScreen(g, this)) },
      { x: cx - 154, y: u.h - 28, w: 72, h: 20, label: '编辑', enabled: has, onClick: () => g.ui.open(new EditWorldScreen(g, this, list[this.sel])) },
      { x: cx - 76, y: u.h - 28, w: 72, h: 20, label: '删除', enabled: has, onClick: () => this.del() },
      { x: cx + 4, y: u.h - 28, w: 72, h: 20, label: '重建', enabled: has, onClick: () => g.ui.open(new CreateWorldScreen(g, this, list[this.sel])) },
      { x: cx + 82, y: u.h - 28, w: 72, h: 20, label: '取消', onClick: () => this.onEsc() },
    ];
    this.listTop = 48; this.listBottom = u.h - 88; this.rowW = 270;
    this.search = { x: cx - 100, y: 22, w: 200, h: 20 };
    // an async world list load can finish while another screen (create world) is on top: its layout
    // must not replace that screen's text field with this search box
    if (u.screen === this) u.showInput(this.search.x + 4, this.search.y + 6, this.search.w - 8, 10, this.filter, () => { if (this.sel >= 0) this.play(); },
      { onInput: (v) => { this.filter = v; this.sel = -1; this.scroll = 0; this.layout(); }, onEsc: () => this.onEsc(), max: 32 });
  }
  play() { const w = this.shown()[this.sel]; if (w) { this.game.ui.hideInput(); this.game.loadWorld(w.id); } }
  // the browser's file picker: a world folder, or a .zip of one
  pick(folder) {
    const inp = document.createElement('input');
    inp.type = 'file';
    if (folder) { inp.webkitdirectory = true; inp.multiple = true; } else inp.accept = '.zip,application/zip';
    inp.onchange = () => { if (inp.files && inp.files.length) { this.game.ui.hideInput(); this.game.ui.open(new ImportScreen(this.game, this, inp.files)); } };
    inp.click();
  }
  del() {
    const w = this.shown()[this.sel]; if (!w) return;
    const g = this.game;
    g.ui.open(new ConfirmScreen(g, '你确定要删除这个世界吗？', `“${w.name}”将会永久消失！（真的很久！）`, '删除', async (yes) => {
      if (yes) { await DB.deleteWorld(w.id); this.worlds = await DB.listWorlds(); this.sel = -1; }
      g.ui.open(this);
    }));
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, top = this.listTop, bottom = this.listBottom;
    ui.listBackground(top, bottom);
    ui.nine('text_field_hl', this.search.x, this.search.y, this.search.w, this.search.h, 1);
    if (!ui.input.value && document.activeElement !== ui.input) Font.draw(c, '搜索世界', this.search.x + 4, this.search.y + 6, '#707070');
    if (DB.backend === 'memory') Font.center(c, '注意：当前浏览器禁止本地存储，存档在关闭页面后会丢失', cx, bottom + 2, '#FF5555');
    if (!this.worlds) { Font.center(c, '加载世界列表中', cx, top + 20, '#FFFFFF'); return; }
    if (this.loadErr) Font.center(c, fitText(this.loadErr, ui.w - 8), cx, top + 20, '#FF5555');
    const list = this.shown(), rowH = 36, x0 = Math.floor(cx - this.rowW / 2) + 2;
    const vis = Math.floor((bottom - top - 4) / rowH);
    this.scroll = clamp(this.scroll, 0, Math.max(0, list.length - vis));
    c.save(); c.beginPath(); c.rect(0, top, ui.w, bottom - top); c.clip();
    list.slice(this.scroll, this.scroll + vis + 1).forEach((w, i) => {
      const y = top + 4 + i * rowH, idx = i + this.scroll;
      if (idx === this.sel) {
        c.fillStyle = '#FFFFFF'; c.fillRect(x0 - 2, y - 2, this.rowW, 36);
        c.fillStyle = '#000000'; c.fillRect(x0 - 1, y - 1, this.rowW - 2, 34);
      }
      // world icon: snapshot taken when the world was first played, or vanilla's "unknown" icon
      let icon = this.icons[w.id];
      if (w.icon && !icon) { icon = this.icons[w.id] = new Image(); icon.src = w.icon; }
      c.imageSmoothingEnabled = true;
      c.drawImage(icon && icon.complete && icon.naturalWidth ? icon : ui.img.unknown_server, x0, y, 32, 32);
      c.imageSmoothingEnabled = false;
      const hov = ui.mouse.y >= Math.max(top, y - 2) && ui.mouse.y < Math.min(bottom, y + 34) && ui.mouse.x >= x0 - 2 && ui.mouse.x < x0 - 2 + this.rowW;
      if (hov) {
        c.fillStyle = 'rgba(144,144,144,0.627)'; c.fillRect(x0, y, 32, 32);
        ui.sprite(ui.mouse.x - x0 < 32 ? 'wl_join_hl' : 'wl_join', x0, y);
      }
      Font.draw(c, w.name, x0 + 35, y + 1, '#FFFFFF');
      const d = new Date(w.lastPlayed), pad = (n) => String(n).padStart(2, '0');
      Font.draw(c, `${w.id} (${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())})`, x0 + 35, y + 12, '#808080');
      let tx = x0 + 35;
      const part = (t, col) => { Font.draw(c, t, tx, y + 21, col); tx += Font.width(t); };
      if (w.hardcore) part('极限模式', '#FF0000'); else part(w.mode === 'creative' ? '创造模式' : w.mode === 'spectator' ? '旁观模式' : '生存模式', '#808080');
      if (w.cheats ?? true) part(', 命令', '#808080');
      part(', 26.2', '#808080');
    });
    c.restore();
    if (!list.length && this.filter) Font.center(c, '找不到匹配的世界', cx, top + 20, '#AAAAAA');
    if (list.length > vis) {
      const sx = Math.floor(cx + this.rowW / 2 + 4), h = bottom - top, bh = clamp(Math.floor(h * h / (list.length * rowH + 4)), 32, h - 8);
      const by = top + Math.floor((h - bh) * this.scroll / Math.max(1, list.length - vis));
      ui.nine('wscroller_bg', sx, top, 6, h, 1); ui.nine('wscroller', sx, by, 6, bh, 1);
    }
  }
  mouseDown(ui, mx, my, b) {
    const list = this.shown(), x0 = Math.floor(ui.w / 2 - this.rowW / 2) + 2;
    if (this.worlds && my >= this.listTop && my < this.listBottom && mx >= x0 - 2 && mx < x0 - 2 + this.rowW) {
      const i = Math.floor((my - this.listTop - 4 + 2) / 36) + this.scroll;
      if (i < list.length && i >= 0) {
        const now = performance.now();
        Sound.init(); Sound.click();
        if (mx - x0 < 32 || (this.sel === i && now - (this.lastT || 0) < 250)) { this.sel = i; this.play(); return; }
        this.sel = i; this.lastT = now; this.layout();
      }
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  wheel(ui, dy) { if (this.worlds) this.scroll += Math.sign(dy); }
  onEsc() { this.game.ui.hideInput(); this.game.ui.open(new TitleScreen(this.game)); }
}

// vanilla ConfirmScreen
class ConfirmScreen extends MenuScreen {
  constructor(game, title, message, yesLabel, cb) { super(game, title); this.titleY = 70; this.message = message; this.yesLabel = yesLabel; this.cb = cb; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 6 + 96);
    this.widgets = [
      { x: cx - 155, y, w: 150, h: 20, label: this.yesLabel, onClick: () => this.cb(true) },
      { x: cx + 5, y, w: 150, h: 20, label: '取消', onClick: () => this.cb(false) },
    ];
  }
  drawExtra(ui) { Font.center(ui.ctx, this.message, ui.w / 2, 90, '#FFFFFF'); }
  onEsc() { this.cb(false); }
}

// vanilla CreateWorldScreen: TabNavigationBar (游戏 / 世界 / 更多) + footer
// 原版 WorldPresets：normal / flat / flat_all_dimensions / large_biomes / amplified / single_biome_surface / debug_all_block_states
const WORLD_TYPE_LIST = [
  { key: 'normal', label: '默认', desc: ['标准的世界生成：生物群系、结构与地形'] },
  { key: 'flat', label: '超平坦', desc: ['只有几层方块，可以自定义层、生物群系、湖、岩浆湖、植被、地牢与奖励箱'] },
  { key: 'flat_all', label: '超平坦（全维度）', desc: ['主世界、下界、末地全部是超平坦（下界用下界岩、末地用末地石铺底）'] },
  { key: 'void', label: '虚空', desc: ['没有地形，整个世界只有空气；出生点保留 3×3 基岩平台，其余位置掉下去会进入虚空'] },
  { key: 'large_biomes', label: '大型生物群系', desc: ['生物群系的范围是默认的四倍'] },
  { key: 'amplified', label: '放大化', desc: ['地形起伏放大，山峰更高、峡谷更深'] },
  { key: 'single_biome', label: '单一生物群系', desc: ['整个世界只有一种生物群系'] },
  { key: 'debug', label: '调试模式', desc: ['全部方块状态排成 y=70 的一张网格（方块之间空一格，世界其余部分是空的）', 'y=60 有一层屏障；游戏模式锁定旁观，可以飞但不能互动'] },
];
const FLAT_BLOCK_LIST = ['bedrock', 'stone', 'dirt', 'grass_block', 'sand', 'sandstone', 'gravel', 'end_stone', 'obsidian', 'netherrack', 'basalt', 'water', 'lava', 'air'];
const FLAT_BIOME_LIST = [['plains', '平原'], ['forest', '森林'], ['birch', '桦木森林'], ['taiga', '针叶林'], ['snowy', '雪原'], ['desert', '沙漠'], ['mountain', '山地'], ['ocean', '海洋']];
// 原版 1.21.2 起的三个实验性内容（顺序与游戏内一致）
const EXPERIMENT_LIST = [
  { key: 'minecart_improvements', label: '矿车改进', desc: '最高速度由 minecartMaxSpeed 控制（默认 8 格/秒，最大 1000）' },
  { key: 'redstone_experiments', label: '红石实验', desc: '红石线分叉时左侧优先更新，时钟和脉冲的先后与原版实验一致' },
  { key: 'trade_rebalance', label: '村民交易重平衡', desc: '图书管理员按生物群系出售不同的附魔书：沼泽卖经验修补，沙漠卖效率' },
  // 26.3 preview content, kept behind an experiment like vanilla's "Chaos" drop items
  { key: 'c263_test', label: '26.3 测试内容', desc: '杨木全套、三色杨树叶、彩色羊毛与混凝土台阶楼梯、草编床、红色灌木、架生蘑菇' },
];
const LOADING_TIPS = [
  '末地的十根黑曜石柱，位置和高度都由世界种子的一个随机数决定。',
  '紫颂花只在末地外岛生长，四个方向都能长出新枝。',
  '末影水晶被破坏时会爆炸，威力 6，黑曜石以外的东西都能炸掉。',
  '击杀末影龙后，主岛边缘会出现折跃门，直接通往 1024 格外的外岛。',
  '潜影贝的子弹打中你会让你飘起来，落下来还会受伤。',
  '末影龙只有头部吃满伤害，身体只有四分之一。',
];

class CreateWorldScreen extends MenuScreen {
  constructor(game, parent, from, afterCreate) {
    super(game, null); this.parent = parent; this.tab = 0; this.afterCreate = afterCreate || null; this.editMode = false;
    // 26.3 CreateWorldScreen.extractBackground: blurred title panorama + 25% black menu veil;
    // the 24 px tab header stays transparent so only the blurred panorama shows there (no dirt)
    this.blurBg = false; this.bgDirt = false; this.bgDim = 0;
    this.name = from ? from.name : '新的世界'; this.seed = from ? String(from.seed) : '';
    this.mode = from ? (from.hardcore ? 'hardcore' : from.mode === 'creative' ? 'creative' : from.mode === 'spectator' ? 'spectator' : 'survival') : 'survival';
    this.difficulty = from ? (from.difficulty ?? 2) : 2; this.cheats = from ? (from.cheats ?? true) : true;
    this.structures = from ? from.structures !== false : true; this.bonus = from ? !!from.bonus : false;
    this.worldType = from ? (from.worldType || (from.flat ? 'flat' : 'normal')) : 'normal';
    this.flat = this.worldType === 'flat' || this.worldType === 'flat_all';
    this.flatLayers = from && from.flatLayers ? from.flatLayers.map(l => ({ ...l })) : null;
    this.flatBiome = from && from.flatBiome ? from.flatBiome : 'plains';
    this.biome = from && from.biome ? from.biome : 'plains';
    this.experiments = from && from.experiments ? { ...from.experiments } : {};
    this.flatOpts = from && from.flatOpts ? { ...from.flatOpts } : { lakes: false, lavaLakes: false, vegetation: false, dungeons: false, bonus: false };
    this.gameRules = from && from.gameRules ? { ...from.gameRules } : {};
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    const tabsW = Math.min(400, u.w) - 28, tw = Math.floor(tabsW / 3), tx0 = Math.floor(cx - tw * 3 / 2);
    this.tabs = ['游戏', '世界', '更多'].map((t, i) => ({ x: tx0 + i * tw, y: 0, w: tw, h: 24, label: t }));
    // 手机横屏 / GUI 缩放压到 160~200 逻辑像素时，原版固定 20 像素的行会压到页脚：这里整套收紧
    const compact = u.h < 210;
    const sepY = compact ? u.h - 30 : u.h - 35;
    const contentTop = 24, contentBottom = sepY - 4;
    const footY = u.h - (compact ? 24 : 27), footH = compact ? 18 : 20;
    const rowGap = compact ? 2 : 8;
    // vanilla HeaderAndFooterLayout puts the contents at headerHeight + 30 (top aligned), not centred;
    // only a screen too short for that falls back to centring
    const top = (h) => {
      const preferred = contentTop + 30, most = contentBottom - h;
      return most >= preferred ? preferred : contentTop + Math.max(2, Math.floor((contentBottom - contentTop - h) / 2));
    };
    const W = [];
    const MODES = { survival: ['生存', '探索未知的世界，尽情建造、收集、合成并与怪物战斗。'], hardcore: ['极限', '难度锁定为“困难”的生存模式，且死亡后无法重生。'], creative: ['创造', '无拘无束地探索创造。可以飞行，材料取之不尽，且不受怪物伤害。'], spectator: ['旁观', '可以自由飞行、穿过方块，不能与方块互动。'] };
    const DIFF = [['和平', '不会生成绝大多数敌对生物。饥饿值不会消耗，且生命值会自然恢复。'], ['简单', '敌对生物会生成，但伤害较低。生命值在饥饿值耗尽后最终会降至5颗心。'], ['普通', '敌对生物会生成，且伤害适中。生命值在饥饿值耗尽后最终会降至半颗心。'], ['困难', '敌对生物会生成，且伤害较高。饥饿值耗尽后最终会饿死。']];
    const hc = this.mode === 'hardcore', dbg = this.worldType === 'debug';
    this.field = null; this.fieldLabel = null;
    if (this.tab === 0) {
      const fieldH = compact ? 16 : 20, nameBlock = 10 + fieldH;
      const rH = compact ? clamp(Math.floor((contentBottom - contentTop - nameBlock - 4 - 3 * rowGap) / 4), 10, 20) : 20;
      const total = nameBlock + 4 + 4 * rH + 3 * rowGap;
      const y = top(total);
      const btnY = y + nameBlock + 4, cw = cx - 105;
      this.field = { x: cx - 104, y: y + 10, w: 208, h: fieldH }; this.fieldLabel = ['世界名称', y];
      W.push({ x: cw, y: btnY, w: 210, h: rH, label: () => '游戏模式：' + (dbg ? '旁观' : MODES[this.mode][0]),
        enabled: !dbg, tip: [dbg ? '调试模式锁定为旁观，你可以旁观，但不能互动' : MODES[this.mode][1]],
        onClick: () => { this.mode = (this.editMode ? { survival: 'creative', creative: 'spectator', spectator: 'survival', hardcore: 'survival' } : { survival: 'hardcore', hardcore: 'creative', creative: 'survival' })[this.mode] || 'survival'; this.cheats = this.mode === 'creative'; this.layout(); } });
      W.push({ x: cw, y: btnY + rH + rowGap, w: 210, h: rH, label: () => '难度：' + (dbg ? '和平' : hc ? '极限' : DIFF[this.difficulty][0]), enabled: !hc && !dbg,
        tip: dbg ? ['调试模式锁定为和平'] : hc ? null : [DIFF[this.difficulty][1]], onClick: () => { this.difficulty = (this.difficulty + 1) % 4; this.layout(); } });
      W.push({ x: cw, y: btnY + 2 * (rH + rowGap), w: 210, h: rH, label: () => '允许命令：' + (dbg ? '开' : this.cheats && !hc ? '开' : '关'), enabled: !hc && !dbg,
        tip: [dbg ? '调试模式强制开用作弊' : '例如/gamemode、/experience等命令'], onClick: () => { this.cheats = !this.cheats; } });
      // 26.3 preview builds carry the Experiments button on the Game tab as well as under More
      const nExp0 = EXPERIMENT_LIST.filter(e => this.experiments[e.key]).length;
      W.push({ x: cw, y: btnY + 3 * (rH + rowGap), w: 210, h: rH, label: () => '实验性内容' + (nExp0 ? '（已开 ' + nExp0 + ' 项）' : ''),
        tip: ['红石实验、交易重平衡、矿车改进，以及 26.3 测试内容'], onClick: () => this.game.ui.open(new ExperimentsScreen(this.game, this)) });
      u.showInput(this.field.x + 4, this.field.y + 6, this.field.w - 8, 10, this.name, () => this.create(), { onInput: (v) => { this.name = v; }, onEsc: () => this.back(), max: 32 });
    } else if (this.tab === 1) {
      const fieldH = compact ? 16 : 20;
      const rH = compact ? clamp(Math.floor((contentBottom - contentTop - 18 - fieldH - rowGap) / 3), 10, 20) : 20;
      const total = 3 * rH + 18 + fieldH + rowGap;
      const y = top(total);
      const fieldY = y + rH + 4 + 10, structY = fieldY + fieldH + 4, cw = cx - 155;
      const ti = WORLD_TYPE_LIST.findIndex(t => t.key === this.worldType), cur = WORLD_TYPE_LIST[ti < 0 ? 0 : ti];
      W.push({ x: cw, y, w: 150, h: rH, label: () => '世界类型：' + cur.label, enabled: !this.editMode,
        tip: this.editMode ? ['已有存档不能更换世界类型'] : [...cur.desc, '点开可以选择全部类型'],
        onClick: () => this.game.ui.open(new WorldTypeScreen(this.game, this)) });
      const canCustom = this.worldType === 'flat' || this.worldType === 'flat_all' || this.worldType === 'single_biome';
      W.push({ x: cw + 160, y, w: 150, h: rH, label: '自定义', enabled: canCustom && !this.editMode,
        tip: this.editMode ? ['已有存档不能更换世界生成方式'] : canCustom ? ['编辑超平坦的层、生物群系与结构'] : ['只有超平坦与单一生物群系世界可以自定义'],
        onClick: () => { if (this.worldType === 'single_biome') this.game.ui.open(new SingleBiomeScreen(this.game, this)); else this.game.ui.open(new FlatCustomizeScreen(this.game, this)); } });
      this.field = { x: cx - 154, y: fieldY, w: 308, h: fieldH }; this.fieldLabel = ['世界生成器的种子', fieldY - 10];
      W.push({ x: cw, y: structY, w: 310, h: rH, label: () => '生成结构：' + (dbg || !this.structures ? '关' : '开'), enabled: !dbg && !this.editMode,
        tip: [this.editMode ? '已有存档不能更换结构生成设置' : dbg ? '调试模式强制关闭结构生成' : '村庄、沉船等'], onClick: () => { this.structures = !this.structures; } });
      W.push({ x: cw, y: structY + rH + rowGap, w: 310, h: rH, label: () => '奖励箱：' + (dbg || !this.bonus ? '关' : '开'), enabled: !dbg && !this.editMode,
        tip: [this.editMode ? '已有存档不能更换奖励箱设置' : dbg ? '调试模式强制关闭奖励箱' : ''], onClick: () => { this.bonus = !this.bonus; } });
      if (this.editMode) u.hideInput();
      else u.showInput(this.field.x + 4, this.field.y + (compact ? 3 : 6), this.field.w - 8, 10, this.seed, () => this.create(), { onInput: (v) => { this.seed = v; }, onEsc: () => this.back(), max: 32 });
    } else {
      const rH = compact ? clamp(Math.floor((contentBottom - contentTop - 2 * rowGap) / 3), 10, 20) : 20;
      const total = 3 * rH + 2 * rowGap;
      const y = top(total), cw = cx - 105;
      u.hideInput();
      const nExp = EXPERIMENT_LIST.filter(e => this.experiments[e.key]).length;
      W.push({ x: cw, y, w: 210, h: rH, label: () => '实验性内容' + (nExp ? '（已开 ' + nExp + ' 项）' : ''),
        tip: ['红石实验、交易重平衡、矿车改进，以及新增的末影龙增强'], onClick: () => this.game.ui.open(new ExperimentsScreen(this.game, this)) });
      W.push({ x: cw, y: y + rH + rowGap, w: 210, h: rH, label: () => '游戏规则' + (Object.keys(this.gameRules).length ? '（已改 ' + Object.keys(this.gameRules).length + ' 项）' : ''),
        tip: ['控制死亡不掉落、生物生成、随机刻、伤害与命令反馈等'], onClick: () => this.game.ui.open(new GameRulesScreen(this.game, this)) });
      W.push({ x: cw, y: y + 2 * (rH + rowGap), w: 210, h: rH, label: '数据包', enabled: false, tip: ['数据包需要服务器资源包，本网页版暂不支持'] });
    }
    W.push({ x: cx - 154, y: footY, w: 150, h: footH, label: this.editMode ? '保存修改' : '创建新的世界', onClick: () => this.create() });
    W.push({ x: cx + 4, y: footY, w: 150, h: footH, label: '取消', onClick: () => this.back() });
    this.compact = compact; this.sepY = sepY;
    this.widgets = W;
  }
  back() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  create() {
    // 生成很慢时玩家会连点：这个按钮只认一次，重复点击直接忽略（game.createWorld 里还有一层同样的锁）
    if (this.busy) return;
    this.busy = true;
    const g = this.game;
    g.ui.hideInput();
    const hc = this.mode === 'hardcore', dbg = this.worldType === 'debug';
    this.error = null;
    // (a world that could not be made - storage refused, the generator threw: this screen again with why, instead of
    // nothing happening or the loading screen for ever)
    g.createWorld(this.name.trim() || '新的世界', this.seed.trim(), dbg ? 'spectator' : hc ? 'survival' : this.mode, this.flat,
      { hardcore: hc, difficulty: dbg ? 0 : hc ? 3 : this.difficulty, cheats: dbg ? true : !hc && this.cheats, structures: dbg ? false : this.structures, bonus: dbg ? false : this.bonus,
        worldType: this.worldType, flatLayers: this.flatLayers, flatBiome: this.flatBiome, flatOpts: this.flatOpts, biome: this.biome, experiments: this.experiments, gameRules: this.gameRules })
      .then(() => {
        this.busy = false;
        // 从多人游戏“新建世界”进来：世界真正进入 play 后再开房，避免在加载界面里开房间。
        if (this.afterCreate) this.afterPlay((meta) => this.afterCreate(meta));
      }, (e) => {
        this.busy = false;
        console.error(e);
        this.error = '创建世界失败: ' + String(e && e.message || e);
        if (g.state !== 'play' && g.state !== 'loading') g.ui.open(this);
      });
  }
  afterPlay(cb) {
    const g = this.game;
    let n = 0;
    const check = () => {
      if (g.state === 'play' && g.worldMeta) { cb(g.worldMeta); return; }
      if (++n > 180) { g.ui.open(new ConfirmScreen(g, '世界没有加载完成', '请稍后再试', '返回', () => g.ui.open(this.parent))); return; }
      setTimeout(check, 300);
    };
    check();
  }
  drawExtra(ui) {
    const c = ui.ctx, t0 = this.tabs[0], t2 = this.tabs[2];
    const sepY = this.sepY ?? (ui.h - 35), compact = !!this.compact;
    // vanilla CreateWorldScreen.extractMenuBackground: the 24 px tab header is TAB_HEADER_BACKGROUND
    // (fully transparent, so the blurred panorama shows through); below it the menu background is a
    // 25%-alpha black veil over that same panorama - not a dirt texture
    ui.wantBlur = true;
    ui.tile('menu_bg', 0, 24, ui.w, ui.h - 24);
    // 26.3's TAB_HEADER_BACKGROUND is fully transparent and its tab widget has no body: the dirt shows
    // through, the selected tab is marked only by a white underline
    this.tabs.forEach((t, i) => {
      const hov = ui.hit(t), sel = i === this.tab;
      Font.center(c, t.label, t.x + t.w / 2, t.y + (sel ? 8 : 10), sel ? '#FFFFFF' : (hov ? '#D0D0D0' : '#A0A0A0'));
      if (sel) { const lw = Math.min(Font.width(t.label), t.w - 4); c.fillStyle = '#FFFFFF'; c.fillRect(Math.floor(t.x + (t.w - lw) / 2), t.y + t.h - 2, lw, 1); }
    });
    ui.tile(ui.sepName('footer'), 0, sepY, ui.w, 2);
    if (this.error && !compact) Font.center(c, fitText(this.error, ui.w - 8), ui.w / 2, sepY - 11, '#FF5555');
    if (this.tab === 0 && this.worldType === 'debug' && !compact) Font.center(c, '调试模式：旁观锁定、难度和平、作弊开启；方块不能改变', ui.w / 2, sepY - 11, '#AAAAFF');
    if (this.field) {
      Font.draw(c, this.fieldLabel[0], this.field.x, this.fieldLabel[1], '#FFFFFF');
      ui.nine('text_field_hl', this.field.x, this.field.y, this.field.w, this.field.h, 1);
      if (this.tab === 1 && this.editMode) Font.draw(c, fitText(this.seed ? '种子：' + this.seed : '种子：随机', this.field.w - 8), this.field.x + 4, this.field.y + 6, '#B0B0B0');
      else if (this.tab === 1 && !ui.input.value && document.activeElement !== ui.input) Font.draw(c, '留空以生成随机种子', this.field.x + 4, this.field.y + 6, '#707070');
    }
    if (this.tab === 1 && (this.worldType === 'flat' || this.worldType === 'flat_all')) {
      const lbs = [];
      const L = this.flatLayers && this.flatLayers.length ? this.flatLayers : [{ id: BID.bedrock ?? 6, n: 1 }, { id: BID.dirt ?? 3, n: 2 }, { id: BID.grass_block ?? 2, n: 1 }];
      let tot = 0; for (const l of L) tot += (l.n | 0);
      Font.center(c, `层：${L.map(l => (BLOCKS[l.id] ? BLOCKS[l.id].cn : l.id) + '×' + (l.n | 0)).join('，')}（共 ${tot} 层）`, ui.w / 2, Math.min(ui.h - 42, this.field.y + 78), '#A0A0A0');
    }
  }
  mouseDown(ui, mx, my, b) {
    for (let i = 0; i < this.tabs.length; i++) if (ui.hit(this.tabs[i], mx, my)) { if (this.tab !== i) { this.tab = i; this.layout(); Sound.init(); Sound.click(); } return; }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.back(); }
}

// 已有存档的编辑界面：复用创建世界界面完全相同的三页签（游戏 / 世界 / 更多）。
// 世界类型、种子、结构与奖励箱在存档创建后不能改变（原版也不允许），其余可安全修改的
// 名称、模式、难度、命令、实验项查看和游戏规则都在这里补上。
class EditWorldScreen extends CreateWorldScreen {
  constructor(game, parent, world) {
    super(game, parent, world);
    this.editMode = true; this.world = world; this.lockExp = true;
    this.experiments = world.experiments ? { ...world.experiments } : {};
    this.gameRules = world.gameRules ? { ...world.gameRules } : {};
  }
  create() {
    if (this.busy) return;
    this.busy = true;
    const w = this.world, hc = this.mode === 'hardcore', dbg = this.worldType === 'debug';
    w.name = this.name.trim() || w.name;
    w.mode = dbg ? 'spectator' : hc ? 'survival' : this.mode;
    w.hardcore = hc;
    w.difficulty = dbg ? 0 : hc ? 3 : this.difficulty;
    w.cheats = dbg ? true : !hc && this.cheats;
    w.gameRules = { ...this.gameRules };
    w.experiments = { ...this.experiments };
    DB.putWorld(w).then(async () => {
      this.busy = false;
      try { if (this.parent && this.parent.worlds) this.parent.worlds = await DB.listWorlds(); } catch (e) { }
      this.game.ui.message('已保存世界设置', '#55FF55');
      this.back();
    }, (e) => {
      this.busy = false;
      this.error = '保存失败：' + String(e && e.message || e);
      this.game.ui.open(this);
    });
  }
}

// 原版“世界类型”的选择界面：一列可选，选中项标出来，下方显示说明
class WorldTypeScreen extends MenuScreen {
  constructor(game, parent) { super(game, '世界类型'); this.parent = parent; this.pauses = false; this.titleY = 12; this.blurBg = true; this.bgDirt = false; this.bgDim = 0; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, W = [], n = WORLD_TYPE_LIST.length;
    // 160 逻辑像素的手机横屏：8 个类型 + 完成必须都放得下，否则最后一行会压到“完成”上
    const short = u.h < 210, footH = short ? 18 : 20, foot = u.h - (short ? 24 : 27);
    const y0 = short ? 26 : 34, gap = short ? 1 : u.h >= 300 ? 4 : 2;
    const h = clamp(Math.floor((foot - y0 - 4 - (n - 1) * gap) / n), 8, 20);
    this.rowTop = y0; this.rowH = h + gap; this.listBottom = y0 + n * this.rowH; this.short = short; this.footY = foot;
    WORLD_TYPE_LIST.forEach((t, i) => {
      W.push({ x: cx - 150, y: y0 + i * this.rowH, w: 300, h, label: (this.parent.worldType === t.key ? '【已选】' : '') + t.label, tip: t.desc,
        onClick: () => {
          const p = this.parent, wasDebug = p.worldType === 'debug';
          p.worldType = t.key; p.flat = t.key === 'flat' || t.key === 'flat_all';
          if (t.key === 'debug') {
            // 原版：选调试模式后游戏模式锁定旁观、难度锁定和平、作弊强制开、结构与奖励箱不可用
            if (p.mode !== 'spectator') p.prevMode = p.mode;
            p.mode = 'spectator'; p.difficulty = 0; p.cheats = true; p.structures = false; p.bonus = false;
          } else if (wasDebug && p.mode === 'spectator') p.mode = p.prevMode || 'survival';
          this.game.ui.open(this.parent);
        } });
    });
    W.push({ x: cx - 100, y: foot, w: 200, h: footH, label: '完成', onClick: () => this.game.ui.open(this.parent) });
    this.widgets = W;
  }
  drawExtra(ui) {
    const t = WORLD_TYPE_LIST.find(x => x.key === this.parent.worldType) || WORLD_TYPE_LIST[0];
    let y = (this.listBottom || (34 + WORLD_TYPE_LIST.length * 24)) + 3;
    // 只剩一两行的高度时只画放得下的说明，别压到“完成”上
    for (const line of t.desc) {
      if (y + 9 > ui.h - 30) break;
      Font.center(ui.ctx, fitText(line, ui.w - 16), ui.w / 2, y, '#A0A0A0'); y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 超平坦能选的方块：常用建筑分类在前，其余全部方块按方块 id 排在最后（不再只有十几种）
const FLAT_GROUPS = [
  ['建筑', ['stone', 'cobblestone', 'mossy_cobblestone', 'stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks', 'smooth_stone',
    'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'oak_log', 'spruce_log', 'birch_log',
    'glass', 'tinted_glass', 'sandstone', 'cut_sandstone', 'chiseled_sandstone', 'bricks', 'deepslate', 'deepslate_bricks', 'deepslate_tiles',
    'polished_deepslate', 'quartz_block', 'smooth_quartz', 'calcite', 'dripstone_block', 'tuff', 'mud_bricks', 'prismarine', 'prismarine_bricks',
    'dark_prismarine', 'nether_bricks', 'red_nether_bricks', 'smooth_basalt']],
  ['自然', ['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium', 'moss_block', 'sand', 'red_sand', 'gravel', 'clay',
    'snow_block', 'powder_snow', 'ice', 'packed_ice', 'blue_ice', 'netherrack', 'soul_sand', 'soul_soil', 'basalt', 'blackstone',
    'gilded_blackstone', 'end_stone', 'purpur_block', 'magma_block', 'bedrock', 'obsidian', 'crying_obsidian']],
  ['矿物', ['coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore',
    'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore', 'copper_block', 'iron_block', 'gold_block',
    'redstone_block', 'lapis_block', 'diamond_block', 'emerald_block', 'netherite_block', 'raw_iron_block', 'raw_copper_block', 'raw_gold_block']],
  ['植物', ['oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'short_grass', 'tall_grass',
    'fern', 'dandelion', 'poppy', 'blue_orchid', 'allium', 'cornflower', 'oak_sapling', 'spruce_sapling', 'birch_sapling', 'cactus',
    'bamboo', 'vine', 'lily_pad', 'sugar_cane', 'brown_mushroom', 'red_mushroom']],
  ['其他', ['water', 'lava', 'glowstone', 'sea_lantern', 'shroomlight', 'torch', 'soul_torch', 'lantern', 'crafting_table', 'furnace',
    'chest', 'bookshelf', 'scaffolding', 'slime_block', 'honey_block', 'target', 'note_block', 'jukebox', 'sponge', 'hay_block']],
];
let FLAT_ALL_BLOCKS = null;
function flatBlocks() {
  if (FLAT_ALL_BLOCKS) return FLAT_ALL_BLOCKS;
  const map = new Map();
  for (const [g, keys] of FLAT_GROUPS) for (const k of keys) if (BID[k] !== undefined) map.set(k, g);
  const TECH = new Set(['air', 'cave_air', 'void_air', 'moving_piston', 'piston_head', 'end_gateway', 'end_portal', 'nether_portal',
    'fire', 'soul_fire', 'bubble_column', 'light', 'barrier', 'structure_void', 'structure_block', 'jigsaw']);
  for (const k in BID) {
    if (map.has(k) || TECH.has(k)) continue;
    // 墙上的旗帜 / 墙上的头 / 花盆这类只能贴墙放的，放进层里没有意义
    if (k.includes('wall_') || k.endsWith('_wall') || k.startsWith('potted_') || k.endsWith('_head') || k.includes('banner')) continue;
    const b = BLOCKS[BID[k]];
    if (!b) continue;
    map.set(k, '其它方块');
  }
  FLAT_ALL_BLOCKS = [...map.entries()].map(([key, g]) => ({ key, g, id: BID[key], cn: (BLOCKS[BID[key]] ? BLOCKS[BID[key]].cn : key) }));
  return FLAT_ALL_BLOCKS;
}

// 方块分类表：照原版创造物品栏的分类（建筑、染色、自然、功能、红石…），每一项都带图标和中文名
let FLAT_BLOCK_TABS = null;
function flatBlockTabs() {
  if (FLAT_BLOCK_TABS) return FLAT_BLOCK_TABS;
  const byTab = new Map(), all = [];
  // 墙上挂的、花盆、墙、头颅、旗帜这类放进层里只会悬空或贴不住，和原版自定义超平坦一样不给选
  const skip = (k) => k === 'air' || k.includes('wall_') || k.endsWith('_wall') || k.startsWith('potted_') || k.endsWith('_head') || k.includes('banner');
  for (const d of (self.ITEM_DATA || [])) {
    if (!d || !d.key || ITEM_KEY[d.key] === undefined) continue;
    if (skip(d.key)) continue;
    const bid = BID[d.key]; if (bid === undefined) continue;
    const b = BLOCKS[bid]; if (!b) continue;
    const it = { key: d.key, bid, iid: ITEM_KEY[d.key], cn: b.cn || d.key, tab: d.tab || '' };
    all.push(it);
    if (!byTab.has(it.tab)) byTab.set(it.tab, []);
    byTab.get(it.tab).push(it);
  }
  const tabs = [];
  for (const t of CREATIVE_TABS) { const list = byTab.get(t.id); if (list && list.length) tabs.push({ id: t.id, name: t.name, icon: ITEM_KEY[t.icon] !== undefined ? ITEM_KEY[t.icon] : null, items: list }); }
  FLAT_BLOCK_TABS = { all, tabs };
  return FLAT_BLOCK_TABS;
}
let FLAT_BID2IID = null;
function blockItemId(bid) {
  if (!FLAT_BID2IID) {
    FLAT_BID2IID = new Map();
    for (const d of (self.ITEM_DATA || [])) {
      if (!d || !d.key || ITEM_KEY[d.key] === undefined) continue;
      const b = BID[d.key]; if (b === undefined || FLAT_BID2IID.has(b)) continue;
      FLAT_BID2IID.set(b, ITEM_KEY[d.key]);
    }
  }
  return FLAT_BID2IID.get(bid) || 0;
}

// 选方块界面：照原版创造物品栏的方块选择——顶部分类标签、搜索框、图标网格、翻页
class BlockPickerScreen extends MenuScreen {
  constructor(game, parent, idx) {
    super(game, '选择方块');
    this.parent = parent; this.idx = idx; this.page = 0; this.search = '';
    const T = flatBlockTabs(); this.all = T.all; this.tabs = T.tabs; this.tab = 0;
    this.cur = parent.layers[idx] ? parent.layers[idx].id : 0;
    this.cols = 9; this.rows = 6; this.cell = 24; this.gap = 2;
  }
  list() {
    let l = this.tab === 0 ? this.all : this.tabs[this.tab - 1].items;
    const q = this.search.trim().toLowerCase();
    return q ? l.filter((it) => it.cn.toLowerCase().includes(q) || it.key.includes(q)) : l;
  }
  gridBox() {
    const u = this.game.ui, gap = this.cell >= 20 ? 2 : 1;
    // 手机横屏/短屏时格子按高度缩小：6 行 24 的网格会把翻页按钮顶出屏幕
    const fitH = Math.floor((u.h - 72 - 54 - (this.rows - 1) * gap) / this.rows);
    const fitW = Math.floor((u.w - 16 - (this.cols - 1) * gap) / this.cols);
    this.cell = clamp(Math.min(24, fitH, fitW), 14, 24);
    const w = this.cols * this.cell + (this.cols - 1) * gap, h = this.rows * this.cell + (this.rows - 1) * gap;
    const y = Math.max(72, Math.min(Math.floor((u.h - h) / 2) - 2, u.h - 54 - h));
    return { x: Math.round(u.w / 2 - w / 2), y, w, h, cw: this.cell + gap };
  }
  tabRect(i) {
    const u = this.game.ui, w = 24, g = 3, n = this.tabs.length + 1, tw = n * w + (n - 1) * g;
    return { x: Math.round(u.w / 2 - tw / 2) + i * (w + g), y: 42, w, h: 24 };
  }
  searchRect() { const u = this.game.ui; return { x: Math.round(u.w / 2 + 84), y: 42, w: 68, h: 24 }; }
  layout() {
    const u = this.game.ui, gb = this.gridBox(), W = [];
    const per = this.cols * this.rows;
    this.pages = Math.max(1, Math.ceil(this.list().length / per));
    this.page = Math.max(0, Math.min(this.page, this.pages - 1));
    W.push({ x: 6, y: 4, w: 56, h: 18, label: '< 返回', onClick: () => this.close() });
    W.push({ x: gb.x, y: gb.y + gb.h + 8, w: 64, h: 18, label: '< 上一页', enabled: this.page > 0, onClick: () => { this.page--; this.layout(); } });
    W.push({ x: gb.x + gb.w - 64, y: gb.y + gb.h + 8, w: 64, h: 18, label: '下一页 >', enabled: this.page < this.pages - 1, onClick: () => { this.page++; this.layout(); } });
    W.push({ text: () => `第 ${this.page + 1} / ${this.pages} 页`, x: u.w / 2, y: gb.y + gb.h + 14 });
    const sr = this.searchRect();
    W.push({ x: sr.x, y: sr.y, w: sr.w, h: sr.h, label: () => this.search ? fitText(this.search, sr.w - 10) : '搜索方块',
      onClick: () => {
        u.showInput(sr.x + 3, sr.y + 9, sr.w - 6, 10, this.search, () => { u.hideInput(); this.layout(); },
          { onInput: (v) => { this.search = v; this.page = 0; this.layout(); }, max: 26 });
      } });
    this.widgets = W;
  }
  drawExtra(ui) {
    const c = ui.ctx, gb = this.gridBox(), mx = ui.mouse.x, my = ui.mouse.y;
    for (let i = 0; i <= this.tabs.length; i++) {
      const r = this.tabRect(i), on = this.tab === i;
      ui.button({ x: r.x, y: r.y, w: r.w, h: r.h, label: '', gold: on });
      const icon = i === 0 ? ITEM_KEY.crafting_table : this.tabs[i - 1].icon;
      if (icon !== undefined && icon !== null) ui.drawItem({ id: icon, count: 1 }, r.x + 5, r.y + 4);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) ui.tooltip([{ text: i === 0 ? '全部方块' : this.tabs[i - 1].name }, { text: `共 ${(i === 0 ? this.all : this.tabs[i - 1].items).length} 种` }], mx, my);
    }
    const per = this.cols * this.rows, l = this.list();
    for (let k = 0; k < per; k++) {
      const it = l[this.page * per + k]; if (!it) break;
      const col = k % this.cols, rw = Math.floor(k / this.cols);
      const x = gb.x + col * gb.cw, y = gb.y + rw * gb.cw, s = this.cell;
      c.fillStyle = '#373737'; c.fillRect(x, y, s, s);
      c.fillStyle = '#8b8b8b';
      c.fillRect(x, y, s, 1); c.fillRect(x, y + s - 1, s, 1); c.fillRect(x, y, 1, s); c.fillRect(x + s - 1, y, 1, s);
      ui.drawItem({ id: it.iid, count: 1 }, x + 4, y + 4);
      if (it.bid === this.cur) { c.strokeStyle = '#FFD24A'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, s - 2, s - 2); c.lineWidth = 1; }
      if (mx >= x && mx < x + s && my >= y && my < y + s) ui.tooltip([{ text: it.cn }, { text: '点击：这一层换成它' }], mx, my);
    }
    if (!l.length) Font.center(c, '没有匹配的方块', ui.w / 2, gb.y + gb.h / 2, '#A0A0A0');
  }
  mouseDown(ui, mx, my, button) {
    if (button !== 0) return;
    for (let i = 0; i <= this.tabs.length; i++) {
      const r = this.tabRect(i);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
        if (this.tab !== i) { this.tab = i; this.page = 0; this.layout(); }
        Sound.click(); return;
      }
    }
    const gb = this.gridBox(), per = this.cols * this.rows, l = this.list();
    for (let k = 0; k < per; k++) {
      const it = l[this.page * per + k]; if (!it) break;
      const col = k % this.cols, rw = Math.floor(k / this.cols);
      const x = gb.x + col * gb.cw, y = gb.y + rw * gb.cw;
      if (mx >= x && mx < x + this.cell && my >= y && my < y + this.cell) {
        Sound.click();
        this.parent.layers[this.idx].id = it.bid;
        this.close();
        return;
      }
    }
    super.mouseDown(ui, mx, my, button);
  }
  close() { this.game.ui.hideInput(); this.game.ui.open(this.parent); }
  onEsc() { this.close(); }
}

// 原版 superflat 的 CustomizeFlatLevelScreen：层列表（图标 + 方块 + 层数，点行换方块）、生物群系、其余生成项
class FlatCustomizeScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '自定义超平坦世界'); this.parent = parent;
    this.layers = parent.flatLayers && parent.flatLayers.length ? parent.flatLayers.map(l => ({ id: l.id, n: l.n })) : [{ id: BID.bedrock ?? 6, n: 1 }, { id: BID.dirt ?? 3, n: 2 }, { id: BID.grass_block ?? 2, n: 1 }];
    this.biome = parent.flatBiome || 'plains';
    this.hits = [];
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, W = [], short = u.h < 300;
    const n = Math.min(8, this.layers.length), y0 = 40, ctrlH = short ? 16 : 20, step = ctrlH + (short ? 2 : 4);
    const foot = u.h - 27, optY = foot - step * 3, addY = optY - step;
    // 短屏：层行、开关行、按钮全部按剩余高度收紧，末行不再压到“完成/取消”
    const rowH = clamp(Math.floor((addY - 4 - y0) / n), 12, 24);
    this.rowH = rowH; this.boxH = Math.max(10, rowH - 2); this.ctrlH = ctrlH;
    this.hits = [];
    for (let r = 0; r < n; r++) {
      const i = n - 1 - r, y = y0 + r * rowH, bh = Math.min(18, this.boxH);
      this.hits.push({ i, kind: 'dec', x: cx - 150, y: y + Math.max(0, Math.floor((this.boxH - bh) / 2)), w: 18, h: bh });
      this.hits.push({ i, kind: 'inc', x: cx + 132, y: y + Math.max(0, Math.floor((this.boxH - bh) / 2)), w: 18, h: bh });
      this.hits.push({ i, kind: 'pick', x: cx - 126, y, w: 256, h: this.boxH });
    }
    const by = addY;
    W.push({ x: cx - 148, y: by, w: 92, h: ctrlH, label: '添加新层', enabled: this.layers.length < 8, tip: ['在顶层再加一层（默认石头）'],
      onClick: () => { this.layers.push({ id: BID.stone ?? 1, n: 1 }); this.layout(); } });
    W.push({ x: cx - 48, y: by, w: 96, h: ctrlH, label: '重置为默认', onClick: () => { this.layers = [{ id: BID.bedrock ?? 6, n: 1 }, { id: BID.dirt ?? 3, n: 2 }, { id: BID.grass_block ?? 2, n: 1 }]; this.layout(); } });
    const bi = FLAT_BIOME_LIST.findIndex(b => b[0] === this.biome), bc = FLAT_BIOME_LIST[bi < 0 ? 0 : bi];
    W.push({ x: cx + 56, y: by, w: 92, h: ctrlH, label: '生物群系：' + bc[1], onClick: () => { this.biome = FLAT_BIOME_LIST[(bi + 1) % FLAT_BIOME_LIST.length][0]; this.layout(); } });
    const oy = optY, o = this.parent.flatOpts || (this.parent.flatOpts = {});
    W.push({ x: cx - 154, y: oy, w: 150, h: ctrlH, label: () => '湖泊：' + (o.lakes ? '开' : '关'), tip: ['在平地上挖出小水塘'], onClick: () => { o.lakes = !o.lakes; this.layout(); } });
    W.push({ x: cx + 4, y: oy, w: 150, h: ctrlH, label: () => '岩浆湖：' + (o.lavaLakes ? '开' : '关'), tip: ['在平地上挖出小岩浆塘'], onClick: () => { o.lavaLakes = !o.lavaLakes; this.layout(); } });
    W.push({ x: cx - 154, y: oy + step, w: 150, h: ctrlH, label: () => '植被：' + (o.vegetation !== false ? '开' : '关'), tip: ['草地上的草、花与小树'], onClick: () => { o.vegetation = o.vegetation === false; this.layout(); } });
    W.push({ x: cx + 4, y: oy + step, w: 150, h: ctrlH, label: () => '地牢：' + (o.dungeons ? '开' : '关'), tip: ['层厚 6 格以上时在土层里挖出带刷怪箱的房间'], onClick: () => { o.dungeons = !o.dungeons; this.layout(); } });
    W.push({ x: cx - 154, y: oy + step * 2, w: 150, h: ctrlH, label: () => '奖励箱：' + (o.bonus ? '开' : '关'), tip: ['出生点旁边放一个装满物资的箱子'], onClick: () => { o.bonus = !o.bonus; this.layout(); } });
    W.push({ x: cx - 154, y: foot, w: 150, h: 20, label: '完成', onClick: () => { const p = this.parent; p.flatLayers = this.layers.map(l => ({ ...l })); p.flatBiome = this.biome; p.flatOpts = { ...(p.flatOpts || {}) }; this.game.ui.open(p); } });
    W.push({ x: cx + 4, y: foot, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(this.parent) });
    this.widgets = W;
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, mx = ui.mouse.x, my = ui.mouse.y;
    const n = Math.min(8, this.layers.length), rh = this.rowH || 24, bh = this.boxH || 22;
    for (let r = 0; r < n; r++) {
      const i = n - 1 - r, l = this.layers[i], y = 40 + r * rh, by = y + Math.max(0, Math.floor((bh - 18) / 2));
      c.fillStyle = 'rgba(0,0,0,0.42)'; c.fillRect(cx - 150, y, 300, bh);
      const iid = blockItemId(l.id);
      if (iid && bh >= 16) ui.drawItem({ id: iid, count: 1 }, cx - 146, y + 3);
      Font.draw(c, fitText(`第 ${i + 1} 层　${BLOCKS[l.id] ? BLOCKS[l.id].cn : '方块 ' + l.id}　× ${l.n}`, 248), cx - 122, y + Math.max(1, Math.floor((bh - 9) / 2)), '#FFFFFF');
      ui.button({ x: cx - 150, y: by, w: 18, h: Math.min(18, bh), label: '−' });
      ui.button({ x: cx + 132, y: by, w: 18, h: Math.min(18, bh), label: '+' });
      if (mx >= cx - 126 && mx < cx + 132 && my >= y && my < y + bh) ui.tooltip([{ text: '点击换这一层的方块' }, { text: '左边 − 减一层，右边 + 加一层' }], mx, my);
    }
  }
  mouseDown(ui, mx, my, button) {
    if (button !== 0) return;
    for (const h of this.hits) {
      if (mx >= h.x && mx < h.x + h.w && my >= h.y && my < h.y + h.h) {
        const l = this.layers[h.i];
        Sound.click();
        if (h.kind === 'dec') { l.n--; if (l.n <= 0 && this.layers.length > 1) this.layers.splice(h.i, 1); }
        else if (h.kind === 'inc') l.n = Math.min(64, l.n + 1);
        else { this.game.ui.open(new BlockPickerScreen(this.game, this, h.i)); return; }
        this.layout(); return;
      }
    }
    super.mouseDown(ui, mx, my, button);
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 原版 single_biome_surface：选择唯一生物群系
class SingleBiomeScreen extends MenuScreen {
  constructor(game, parent) { super(game, '单一生物群系'); this.parent = parent; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, p = this.parent, W = [], n = FLAT_BIOME_LIST.length, foot = u.h - 27, y0 = 44;
    const gap = u.h >= 300 ? 4 : 2, h = clamp(Math.floor((foot - y0 - 6 - (n - 1) * gap) / n), 12, 20);
    FLAT_BIOME_LIST.forEach((b, i) => {
      W.push({ x: cx - 154, y: y0 + i * (h + gap), w: 308, h, label: (p.biome === b[0] ? '● ' : '○ ') + b[1], tip: ['整个世界只会生成这种生物群系'],
        onClick: () => { p.biome = b[0]; this.layout(); } });
    });
    W.push({ x: cx - 154, y: foot, w: 150, h: 20, label: '完成', onClick: () => this.game.ui.open(p) });
    W.push({ x: cx + 4, y: foot, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(p) });
    this.widgets = W;
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 原版 ExperimentsScreen（1.21.2+）：勾选框列表 + 「实验性内容可能会破坏世界」警告
class ExperimentsScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '实验性内容'); this.parent = parent; this.rowH = 38;
    if (!parent.experiments) parent.experiments = {};
  }
  rowTop(i) { return 54 + i * this.rowH; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, p = this.parent, n = EXPERIMENT_LIST.length;
    // 短屏下方还有三行警告和按钮：实验项行距跟着剩余高度收紧，不能画到警告上
    const avail = (u.h - 70) - 54, gap = u.h >= 300 ? 6 : 2;
    this.rowH = clamp(Math.floor((avail - (n - 1) * gap) / n), 20, 38);
    this.boxH = Math.max(16, this.rowH - 6);
    this.rows = [];
    EXPERIMENT_LIST.forEach((e, i) => this.rows.push({ x: cx - 160, y: this.rowTop(i), w: 320, h: this.boxH, e }));
    this.widgets = [
      { x: cx - 154, y: u.h - 27, w: 150, h: 20, label: '完成', onClick: () => this.game.ui.open(p) },
      { x: cx + 4, y: u.h - 27, w: 150, h: 20, label: '取消', onClick: () => this.game.ui.open(p) },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, p = this.parent, bh = this.boxH || 32;
    ui.dim(0.35);
    EXPERIMENT_LIST.forEach((e, i) => {
      const y = this.rowTop(i), on = !!p.experiments[e.key], locked = !!(p.lockExp && on);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(cx - 160, y, 320, bh);
      // 勾选框
      const cs = Math.min(14, bh - 6), cy = y + Math.max(2, Math.floor((bh - cs) / 2));
      c.fillStyle = '#000'; c.fillRect(cx - 152, cy, cs, cs);
      c.strokeStyle = locked ? '#777' : '#FFF'; c.lineWidth = 1; c.strokeRect(cx - 151.5, cy + 0.5, cs - 1, cs - 1);
      if (on) { c.fillStyle = locked ? '#6E6E6E' : '#FFFFFF'; c.fillRect(cx - 152 + 3, cy + 3, cs - 6, cs - 6); }
      Font.draw(c, e.label, cx - 130, y + (bh >= 26 ? 5 : 3), on ? '#FFFFFF' : '#E0E0E0');
      if (bh >= 19) Font.draw(c, fitText(e.desc, 290), cx - 130, y + bh - 9, locked ? '#9A9A9A' : '#B8B8B8');
      if (locked) { c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(cx - 160, y, 320, bh); }
    });
    // 原版警告（短屏合成一行，给上面的实验项和说明留高度）
    Font.center(c, '实验性内容可能会破坏你的世界，或者让游戏崩溃；开启后不能关闭。', cx, ui.h - 58, '#FF5555');
    if (p.lockExp) Font.center(c, '这个存档已经开过实验项：只能查看，不能再改动。', cx, ui.h - 43, '#A0A0A0');
    else Font.center(c, '编辑已有存档时不能把实验性内容加进去；要开启请新建世界。', cx, ui.h - 43, '#A0A0A0');
  }
  mouseDown(ui, mx, my, button) {
    if (button === 0) {
      for (const r of this.rows) {
        if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) {
          const p = this.parent, on = !!p.experiments[r.e.key];
          if (p.lockExp && on) return;
          if (p.lockExp && !on) return; // 编辑存档不许新开实验
          Sound.click(); p.experiments[r.e.key] = !on; return;
        }
      }
    }
    super.mouseDown(ui, mx, my, button);
  }
  onEsc() { this.game.ui.open(this.parent); }
}

// 26.3 游戏规则界面：原版 CreateWorldScreen → More → Game Rules 的列表。
// 布尔规则点一下切换；整数规则在一组常用值之间循环（也可以用 /gamerule 精确设置）。
// 规则写进 worldMeta.gameRules，创建世界与编辑存档共用同一个界面。
const RULE_LABEL = {
  advance_time: '时间流动', advance_weather: '天气变化', keep_inventory: '死亡不掉落', spawn_mobs: '生成生物', spawn_monsters: '生成怪物',
  spawn_patrols: '生成灾厄巡逻队', spawn_phantoms: '生成幻翼', spawn_wandering_traders: '生成流浪商人', spawn_wardens: '生成监守者',
  natural_health_regeneration: '自然生命恢复', fall_damage: '摔落伤害', fire_damage: '火焰伤害', drowning_damage: '溺水伤害', freeze_damage: '冰冻伤害',
  immediate_respawn: '立即重生', show_death_messages: '死亡消息', mob_griefing: '生物破坏方块', raids: '袭击', random_tick_speed: '随机刻速度',
  mob_drops: '生物掉落物', block_drops: '方块掉落物', entity_drops: '实体掉落物', tnt_explodes: 'TNT 爆炸', send_command_feedback: '命令反馈',
  pvp: '玩家对战', universal_anger: '普遍愤怒', forgive_dead_players: '宽恕死亡玩家', max_entity_cramming: '实体挤压上限',
  players_sleeping_percentage: '睡觉玩家百分比', spread_vines: '藤蔓蔓延', water_source_conversion: '水源头转换', lava_source_conversion: '岩浆源转换',
  ender_pearls_vanish_on_death: '末影珍珠死亡消失', projectiles_can_break_blocks: '投掷物破坏方块', show_advancement_messages: '进度消息',
  limited_crafting: '限制合成', respawn_radius: '重生半径', max_block_modifications: '方块修改上限', fire_spread_radius_around_player: '火焰蔓延半径',
  locator_bar: '定位条', reduced_debug_info: '简化调试信息', max_snow_accumulation_height: '最大积雪高度', command_blocks_work: '命令方块启用',
  command_block_output: '命令方块输出', max_command_sequence_length: '命令链长度', minecart_max_speed: '矿车最高速度',
};
const RULE_STEPS = {
  random_tick_speed: [0, 1, 3, 5, 10], max_entity_cramming: [0, 8, 16, 24, 32, 64], players_sleeping_percentage: [0, 25, 50, 75, 100],
  respawn_radius: [0, 5, 10, 15, 20, 50], max_block_modifications: [0, 1024, 32768, 65536], fire_spread_radius_around_player: [0, 64, 128, 256],
  max_snow_accumulation_height: [0, 1, 2, 4], max_command_sequence_length: [1024, 65536, 131072], minecart_max_speed: [8, 16, 32, 100, 1000],
};
const RULE_ORDER = Object.keys(RULE_LABEL);
class GameRulesScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '游戏规则'); this.parent = parent; this.titleY = 15;
    if (!parent.gameRules) parent.gameRules = {};
    this.orig = { ...parent.gameRules }; this.page = 0;
  }
  get rules() { return this.parent.gameRules; }
  value(k) { return this.rules[k] !== undefined ? this.rules[k] : GAME_RULES[k]; }
  setValue(k, v) { this.rules[k] = v; }
  toggle(k) {
    const v = this.value(k);
    if (typeof v === 'boolean') this.setValue(k, !v);
    else {
      const steps = RULE_STEPS[k] || [0, 1, 2, 3, 5, 10, 100];
      let i = steps.indexOf(v); this.setValue(k, steps[(i < 0 ? 0 : i + 1) % steps.length]);
    }
    Sound.click();
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2, short = u.h < 210;
    this.titleY = short ? 22 : 15; this.title = short ? '' : '游戏规则';
    const per = short ? 3 : u.h < 300 ? 8 : 10;
    this.per = per; this.pages = Math.max(1, Math.ceil(RULE_ORDER.length / per));
    this.page = clamp(this.page, 0, this.pages - 1);
    const footY = u.h - (short ? 23 : 27), footH = short ? 16 : 20, top = short ? 48 : 38;
    const rowH = Math.max(12, Math.floor((footY - 6 - top - (short ? 0 : 14)) / per));
    this.rowTop = top; this.rowH = Math.min(rowH, 24); this.rowW = Math.min(340, u.w - 8);
    const bw = 72, gap = 4, x0 = Math.floor(cx - (bw * 4 + gap * 3) / 2);
    const btn = (i, label, fn, enabled = true) => ({ x: x0 + i * (bw + gap), y: footY, w: bw, h: footH, label, enabled, onClick: fn });
    this.widgets = [
      btn(0, '上一页', () => { this.page = Math.max(0, this.page - 1); this.layout(); }, this.page > 0),
      btn(1, '下一页', () => { this.page = Math.min(this.pages - 1, this.page + 1); this.layout(); }, this.page < this.pages - 1),
      btn(2, '完成', () => { this.game.ui.open(this.parent); }),
      btn(3, '取消', () => this.cancel()),
    ];
  }
  cancel() { for (const k in this.parent.gameRules) delete this.parent.gameRules[k]; Object.assign(this.parent.gameRules, this.orig); this.game.ui.open(this.parent); }
  drawExtra(ui) {
    const c = ui.ctx, cx = ui.w / 2, list = RULE_ORDER.slice(this.page * this.per, this.page * this.per + this.per);
    if (ui.h < 210) Font.center(c, `游戏规则　${this.page + 1} / ${this.pages}　·　共 ${RULE_ORDER.length} 条`, cx, 40, '#FFFFFF');
    else Font.center(c, `第 ${this.page + 1} / ${this.pages} 页　·　共 ${RULE_ORDER.length} 条规则`, cx, 27, '#A0A0A0');
    list.forEach((k, i) => {
      const y = this.rowTop + i * this.rowH, v = this.value(k);
      c.fillStyle = i % 2 ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.45)';
      c.fillRect(cx - this.rowW / 2, y, this.rowW, this.rowH - 1);
      Font.draw(c, fitText(RULE_LABEL[k] || k, this.rowW - 96), cx - this.rowW / 2 + 6, y + Math.max(2, Math.floor((this.rowH - 9) / 2)), '#FFFFFF');
      const text = typeof v === 'boolean' ? (v ? '开' : '关') : String(v);
      Font.draw(c, text, cx + this.rowW / 2 - 8 - Font.width(text), y + Math.max(2, Math.floor((this.rowH - 9) / 2)), typeof v === 'boolean' ? (v ? '#55FF55' : '#FF8080') : '#FFFF55');
      if (i < list.length - 1) { c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(cx - this.rowW / 2, y + this.rowH - 1, this.rowW, 1); }
    });
    if (ui.h >= 210) Font.center(c, '点击规则切换；整数规则会在一组常用值之间循环，也可用 /gamerule 精确设置', cx, ui.h - 39, '#909090');
  }
  mouseDown(ui, mx, my, b) {
    if (b === 0 && mx >= ui.w / 2 - this.rowW / 2 && mx < ui.w / 2 + this.rowW / 2) {
      const i = Math.floor((my - this.rowTop) / this.rowH), list = RULE_ORDER.slice(this.page * this.per, this.page * this.per + this.per);
      if (i >= 0 && i < list.length) { this.toggle(list[i]); return; }
    }
    super.mouseDown(ui, mx, my, b);
  }
  onEsc() { this.cancel(); }
}

// vanilla OptionsScreen: header (title + FOV / difficulty), 2-column grid of sub-menus, 完成
class OptionsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '选项'); this.parent = parent; this.pauses = game.state === 'play'; this.titleY = 12; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, s = this.game.settings, g = this.game;
    const DIFF = ['和平', '简单', '普通', '困难'];
    // 160~200 px phone viewports: seven rows have to fit above the footer, so shrink and lift them
    const short = u.h < 210, rowH = short ? 12 : 20, rowStep = short ? 16 : 22;
    const top = short ? 40 : 61 + Math.floor((u.h - 33 - 61 - 116) / 2);
    const sliderY = short ? 24 : 29;
    const sub = (i, label, make) => ({ x: i % 2 ? cx + 5 : cx - 155, y: top + Math.floor(i / 2) * rowStep, w: 150, h: rowH, label, enabled: !!make, tip: make ? null : ['本复刻版暂不支持'], onClick: () => make && g.ui.open(make()) });
    this.widgets = [
      { slider: true, x: cx - 155, y: sliderY, w: 150, h: rowH, value: (s.fov - 30) / 80, label: () => '视场角：' + (Math.round(s.fov) === 70 ? '中' : Math.round(s.fov) === 110 ? '超广角' : Math.round(s.fov)), onChange: (v) => { s.fov = Math.round(30 + v * 80); g.applySettings(); g.saveSettings(); } },
      g.state === 'play'
        ? { x: cx + 5, y: sliderY, w: 150, h: rowH, label: () => '难度：' + (g.hardcore ? '极限' : DIFF[g.difficulty]), enabled: !g.hardcore, onClick: () => { g.difficulty = (g.difficulty + 1) % 4; } }
        : { x: cx + 5, y: sliderY, w: 150, h: rowH, label: '联机…', enabled: false },
      sub(0, '皮肤自定义…', null),
      sub(1, '声音…', () => new OptionsListScreen(g, this, '声音选项', 'sound')),
      sub(2, '视频设置…', () => new OptionsListScreen(g, this, '视频设置', 'video')),
      sub(3, '控制…', () => new OptionsListScreen(g, this, '按键控制', 'controls')),
      sub(4, '语言…', null),
      sub(5, '聊天设置…', null),
      sub(6, '模组（高级）…', () => new ModsScreen(g, this)),
      sub(7, '辅助功能设置…', () => new OptionsListScreen(g, this, '辅助功能设置', 'access')),
      sub(8, '遥测数据…', () => new TelemetryScreen(g, this)),
      sub(9, '制作人员名单与致谢…', () => creditsRoll(g, this)),
      sub(10, '启动动画…', () => new OptionsListScreen(g, this, '启动动画', 'startup')),
      { x: cx - 100, y: u.h - (short ? 24 : 27), w: 200, h: short ? 16 : 20, label: '完成', onClick: () => this.done() },
    ];
  }
  done() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  onEsc() { this.done(); }
}
// 选项 → 制作人员名单与致谢: the credits roll (dims.js CreditsScreen) - the button opened 游戏说明 (players' feedback
// 11-01 to 11-03, 4+). As vanilla's from the options: without the End poem; and a click or a tap goes back (a phone has
// no Esc, and the whole roll takes minutes)
function creditsRoll(g, parent) {
  const sc = new CreditsScreen(g, () => g.ui.open(parent)), L = sc.lines, i = L.findIndex((l) => l.t === '============');
  if (i > 9) sc.lines = [...L.slice(0, 9), ...L.slice(i - 1)]; // (the blank lines and the logo, then the credits)
  sc.pauses = g.state === 'play'; sc.onEsc = () => sc.finish(); sc.mouseDown = () => sc.finish();
  return sc;
}

// vanilla OptionsSubScreen: header title, OptionsList (rows of two 150-wide buttons, 25 tall) on the list background, 完成
class OptionsListScreen extends MenuScreen {
  constructor(game, parent, title, page) { super(game, title); this.parent = parent; this.page = page; this.pauses = game.state === 'play'; this.titleY = 12; this.scroll = 0; }
  options() {
    const s = this.game.settings, g = this.game;
    const sl = (label, val, set, wide) => ({ slider: true, wide, value: val, label, onChange: (v) => { set(v); g.applySettings(); g.saveSettings(); } });
    const bt = (label, fn, extra) => ({ label, onClick: () => { fn(); g.applySettings(); g.saveSettings(); }, ...extra });
    const onoff = (v) => v ? '开' : '关';
    // 设置 → 启动动画：开机影片、主菜单背景视频
    if (this.page === 'startup') {
      const M = window.StartupMedia;
      const pick = () => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'video/mp4,video/webm,video/ogg';
        inp.onchange = () => {
          const f = inp.files && inp.files[0]; if (!f) return;
          M.useFile(f).then(() => { g.ui.message('已保存启动视频：' + (f.name || '本地视频'), '#55FF55'); if (g.ui.screen && g.ui.screen.layout) g.ui.screen.layout(); })
            .catch((e) => g.ui.message(String((e && e.message) || e), '#FF5555'));
        };
        inp.click();
      };
      return [
        bt(() => '启动动画：' + onoff(M.get().on), () => M.setOn(!M.get().on), { wide: true, tip: ['默认关闭；开启后，打开游戏先播这段影片，加载完成出现「点击开始」，可以看完再进主菜单'] }),
        bt(() => '主菜单背景视频：' + onoff(M.get().title), () => M.setTitle(!M.get().title), { wide: true, tip: ['把同一段影片铺在主菜单和标题界面后面（会盖住原来的标题世界背景）'] }),
        bt(() => '视频来源：' + (M.get().src === 'custom' ? ('本地视频' + (M.get().name ? '（' + M.get().name + '）' : '')) : '内置动画'), () => M.setSource(M.get().src === 'custom' ? 'builtin' : 'custom'), { wide: true, tip: ['内置动画随游戏一起提供（media/startup.mp4）', '本地视频只在当前浏览器里保存，不会上传'] }),
        bt('选择本地视频…', pick, { wide: true, tip: ['支持 mp4 / webm；选好后自动设为启动动画', '太大的视频会占用浏览器存储空间'] }),
        bt('预览启动动画', () => M.preview(), { wide: true, tip: ['全屏播一次，点画面结束'] }),
        bt('恢复内置动画', () => M.useBuiltin().then(() => { g.ui.message('已恢复内置动画', '#55FF55'); if (g.ui.screen && g.ui.screen.layout) g.ui.screen.layout(); }), { wide: true }),
      ];
    }
    // vanilla accessibility: how much flying, sprinting and drawing a bow change the field of view
    if (this.page === 'access') return [
      sl(() => '视场角效果：' + ((s.fovEffects ?? 1) > 0 ? Math.round((s.fovEffects ?? 1) * 100) + '%' : '关'), s.fovEffects ?? 1, v => s.fovEffects = Math.round(v * 20) / 20, true),
      bt(() => '苹果皮（食物信息）：' + onoff(s.modAppleSkin !== false), () => s.modAppleSkin = s.modAppleSkin === false, { wide: true, tip: ['食物提示里显示饥饿值和饱和度，饥饿条上叠加金色饱和度', '还会提示食物附带的正面/负面效果和触发概率'] }),
    ];
    if (this.page === 'sound') return [
      sl(() => '主音量：' + (s.volume > 0 ? Math.round(s.volume * 100) + '%' : '关'), s.volume, v => s.volume = v, true),
      sl(() => '音乐音量：' + ((s.musicVolume ?? 0.5) > 0 ? Math.round((s.musicVolume ?? 0.5) * 100) + '%' : '关'), s.musicVolume ?? 0.5, v => s.musicVolume = v, true),
      bt(() => '显示字幕：' + onoff(!!s.subtitles), () => s.subtitles = !s.subtitles, { tip: ['在屏幕右下角用文字列出听到的声音和方向'] }),
    ];
    // changing one of the options a preset sets makes the preset "custom"
    const own = (fn) => (v) => { s.preset = 'custom'; fn(v); };
    // (maxFps 0 is 60 on a 90/120 Hz phone or tablet, -1 the display's own rate there - perf.js FramePacer.playLimit)
    const fpsLabel = () => '最大帧率：' + (s.maxFps > 0 ? s.maxFps + ' fps' : s.maxFps !== -1 && this.game.pacer && this.game.pacer.auto60 ? '自动（60 fps）' : '无限制');
    return [
      bt(() => '画质预设：' + (PRESET_NAMES[s.preset] || '自定义') + (s.preset === 'auto' && s.autoPreset ? '（' + PRESET_NAMES[s.autoPreset] + '）' : ''), () => {
        const order = ['auto', 'low', 'medium', 'high', 'ultra'];
        applyPreset(g, order[(order.indexOf(s.preset) + 1) % order.length]);
      }, { tip: ['自动：按设备性能选择（' + TouchDevice.name + '）', '低 / 中 / 高 / 极高：渲染距离、分辨率、云、图形品质'] }),
      bt(() => '图形品质：' + (s.graphics === 'fast' ? '流畅' : '高品质'), own(() => { s.graphics = s.graphics === 'fast' ? 'fancy' : 'fast'; g.graphicsChanged(); }),
        { tip: ['流畅：树叶不透明，相邻树叶之间的面不绘制', '省显存和显卡，森林里更流畅'] }),
      bt(() => '光影：' + FX_NAMES[s.shaders || 0] + (g.renderer.fx && !g.renderer.fx.ok ? '（不支持）' : ''), () => { if (g.renderer.fx && g.renderer.fx.ok) s.shaders = ((s.shaders || 0) + 1) % FX_NAMES.length; }, { tip: ['关 / 低 / 中 / 高 / 极限：实时阴影、水面反射、体积光等'] }),
      bt(() => '渲染分辨率：' + Math.round(s.resScale * 100) + '%', own(() => { s.resScale = s.resScale >= 1 ? 0.5 : s.resScale + 0.25; })),
      sl(() => '渲染距离：' + s.renderDist + '个区块', (s.renderDist - 2) / 14, own(v => s.renderDist = Math.round(2 + v * 14)), true),
      // vanilla: 10 - 260 in steps of 10, the top end is "unlimited"
      sl(fpsLabel, s.maxFps > 0 ? (s.maxFps - 10) / 250 : 1, v => { const f = Math.round(v * 25) * 10 + 10; s.maxFps = f >= 260 ? (s.maxFps === -1 ? -1 : 0) : f; }),
      bt(() => '垂直同步：' + onoff(s.vsync !== false), () => s.vsync = s.vsync === false, { tip: ['开：帧与显示器刷新同步，不撕裂', '关：帧率可超过刷新率（浏览器需带 --disable-gpu-vsync 启动才能显示出来）'] }),
      bt(() => '动态分辨率：' + onoff(s.dynRes), own(() => s.dynRes = !s.dynRes), { tip: ['显卡跟不上时自动降低渲染分辨率（最低 50%），恢复后再调回'] }),
      bt(() => '云：' + (s.clouds ? '高品质' : '关'), own(() => s.clouds = !s.clouds)),
      sl(() => '亮度：' + (s.gamma < 0.01 ? '昏暗' : s.gamma > 0.99 ? '明亮' : Math.round(s.gamma * 100) + '%'), s.gamma, v => s.gamma = v),
      bt(() => '界面尺寸：' + (s.guiScale || '自动'), () => { s.guiScale = (s.guiScale + 1) % 5; setTimeout(() => g.ui.resize(), 0); }),
      fsSupported() ? bt(() => '全屏：' + onoff(!!fsElement()), () => toggleFullscreen()) : bt('全屏：不支持', () => { }, { enabled: false, tip: ['这个浏览器不支持网页全屏'] }),
      bt(() => '视角摇晃：' + onoff(s.bobbing), () => s.bobbing = !s.bobbing),
      bt('平滑光照：开', () => { }, { enabled: false }),
      bt('复制性能报告', () => copyText(PerfMon.report(g, null, 0)).then(ok => g.ui.message(ok ? '性能报告已复制到剪贴板' : '无法写入剪贴板，报告已输出到浏览器控制台', '#FFFF55')),
        { tip: ['复制最近 240 帧的帧时间、内存和设备信息', '游戏中按 F3 + L 记录 10 秒的完整报告'] }),
    ];
  }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.top = 33; this.bottom = u.h - 33;
    const rows = [], opts = this.options();
    for (let i = 0; i < opts.length;) {
      const o = opts[i];
      if (o.wide) { rows.push([Object.assign(o, { x: cx - 155, w: 310 })]); i++; continue; }
      const r = [Object.assign(o, { x: cx - 155, w: 150 })];
      if (opts[i + 1] && !opts[i + 1].wide) r.push(Object.assign(opts[i + 1], { x: cx + 5, w: 150 }));
      rows.push(r); i += r.length;
    }
    this.rows = rows;
    this.doneBtn = { x: cx - 100, y: u.h - 27, w: 200, h: 20, label: '完成', onClick: () => this.back() };
    this.place();
  }
  place() {
    const list = [];
    const maxScroll = Math.max(0, this.rows.length * 25 + 4 - (this.bottom - this.top));
    this.scroll = clamp(this.scroll, 0, maxScroll);
    this.rows.forEach((r, i) => { const y = this.top + 4 - this.scroll + i * 25 + 2; for (const w of r) { w.y = y; w.h = 20; if (y >= this.top && y + 20 <= this.bottom) list.push(w); } });
    this.widgets = [...list, this.doneBtn];
  }
  back() { this.game.saveSettings(); this.game.ui.open(this.parent); }
  drawExtra(ui) { ui.listBackground(this.top, this.bottom); }
  wheel(ui, dy) { this.scroll += Math.sign(dy) * 25; this.place(); }
  onEsc() { this.back(); }
}

// vanilla PauseScreen grid (rows of 204 / 98+98, padding-top 50, aligned at 1/4 of the screen)
class PauseScreen extends MenuScreen {
  constructor(game) { super(game, '游戏菜单'); this.pauses = true; this.titleY = 40; }
  layout() {
    const u = this.game.ui, cx = u.w / 2, g = this.game;
    // the vanilla grid assumes ~240 logical pixels; shrink it on 160~200 pixel phone viewports so 保存并退出 stays inside
    const short = u.h < 210, room = !!(g.net && g.net.room), roomMode = room && (g.net.opLevel | 0) >= 2;
    const rowCount = 6 + (roomMode ? 1 : 0), gap = short ? 2 : 4;
    const bh = short ? clamp(Math.floor((u.h - 8 - 26 - (rowCount - 1) * gap) / rowCount), 10, 18) : 20;
    const step = bh + gap, y = short ? 26 : Math.floor((u.h - 166) / 4) + 50;
    this.titleY = short ? 12 : 40;
    this.widgets = [
      { x: cx - 102, y, w: Companion.shown ? 150 : 204, h: bh, label: '回到游戏', onClick: () => g.ui.close() },
      // (the AI companion, companion.js - only where the service has it on)
      !Companion.shown ? null : { x: cx + 52, y, w: 50, h: bh, label: () => fitText(Companion.name, 44), tip: ['AI 伙伴的设置（和它聊天按 V）'], onClick: () => g.ui.open(new CompanionScreen(g, this)) },
      { x: cx - 102, y: y + step, w: 98, h: bh, label: '进度', onClick: () => g.ui.open(new AdvancementsScreen(g, this)) },
      { x: cx + 4, y: y + step, w: 98, h: bh, label: '统计信息', onClick: () => g.ui.open(new StatsScreen(g, this)) },
      { x: cx - 102, y: y + 2 * step, w: 98, h: bh, label: '游戏说明', onClick: () => g.ui.open(new HelpScreen(g, this)) },
      { x: cx + 4, y: y + 2 * step, w: 98, h: bh, label: '反馈问题', tip: ['遇到 bug、卡顿，或者有建议，发给我们（会附上现在的画面）'], onClick: () => g.ui.open(new FeedbackScreen(g, this, feedbackShot(g))) },
      room && !roomMode ? null : { x: roomMode ? cx - 102 : cx + 4, y: roomMode ? y + 4 * step : y + 3 * step, w: roomMode ? 204 : 98, h: bh, label: () => '模式：' + MODE_NAMES[g.mode], enabled: !!g.cheats || !!g.net, tip: g.cheats || g.net ? ['生存 → 创造 → 旁观（也可按 F3 + F4）'] : ['需要开启“允许命令”'], onClick: () => g.requestMode(MODE_NEXT[g.mode]) },
      { x: cx - 102, y: y + 3 * step, w: 98, h: bh, label: '选项…', onClick: () => g.ui.open(new OptionsScreen(g, this)) },
      g.net && g.net.room ? { x: cx + 4, y: y + 3 * step, w: 98, h: bh, label: '房间…', tip: ['邀请朋友、看在场的玩家；房主可以踢人、封禁、禁言'], onClick: () => g.ui.open(new RoomScreen(g, this)) } : null,
      { x: cx - 102, y: y + (roomMode ? 5 : 4) * step, w: 204, h: bh, label: '保存并退回到标题屏幕', onClick: () => g.quitToTitle() },
    ].filter(Boolean);
  }
  onEsc() { this.game.ui.close(); }
}
const MODE_NAMES = { survival: '生存', creative: '创造', spectator: '旁观' };
const MODE_NEXT = { survival: 'creative', creative: 'spectator', spectator: 'survival' };

class AdvancementsScreen extends MenuScreen {
  constructor(game, parent) {
    super(game, '进度');
    this.parent = parent; this.pauses = true; this.bgDim = 0.75; this.titleY = 8;
    this.cat = 'story'; this.sel = null; this.scroll = 0; this.tabs = [];
  }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 26, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  visible() {
    return Object.keys(ADVANCEMENTS).filter((k) => ADVANCEMENTS[k].cat === this.cat && (!ADVANCEMENTS[k].hidden || this.game.adv[k]));
  }
  iconId(e) {
    try { return item(e.icon); } catch (err) { try { return item('paper'); } catch (e2) { return 0; } }
  }
  depth(id) {
    let n = 0, p = ADVANCEMENTS[id] && ADVANCEMENTS[id].parent;
    while (p && ADVANCEMENTS[p] && n < 8) { n++; p = ADVANCEMENTS[p].parent; }
    return n;
  }
  drawExtra(ui) {
    const c = ui.ctx, g = this.game, W = ui.w, H = ui.h;
    const list = this.visible();
    if (!list.length) this.sel = null;
    if (!this.sel || ADVANCEMENTS[this.sel].cat !== this.cat) this.sel = list[0] || null;
    // 分类页签：原版五类；空间紧，页签只放图标和名称，数量放进选中类的摘要
    const tabY = 20, tabH = 17, gap = 2;
    const tabW = Math.floor((W - 8 - gap * 4) / 5), tabX0 = 4;
    this.tabs = [];
    Object.keys(ADV_CATS).forEach((cat, i) => {
      const x = tabX0 + i * (tabW + gap), y = tabY, on = cat === this.cat;
      c.fillStyle = on ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.5)';
      c.fillRect(x, y, tabW, tabH);
      c.strokeStyle = on ? '#FFFFFF' : '#555555'; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, tabW - 1, tabH - 1);
      const icon = this.iconId({ icon: ADV_CATS[cat].icon });
      if (icon) ui.drawItem({ id: icon, count: 1 }, x + 2, y + 1);
      const label = fitText(ADV_CATS[cat].title, tabW - 20);
      Font.draw(c, label, x + 18, y + 3, on ? '#FFFFFF' : '#AAAAAA');
      this.tabs.push({ x, y, w: tabW, h: tabH, cat });
    });
    const done = Object.keys(ADVANCEMENTS).filter((k) => g.adv[k]).length;
    const total = Object.keys(ADVANCEMENTS).length;
    const catTotal = Object.keys(ADVANCEMENTS).filter((k) => ADVANCEMENTS[k].cat === this.cat).length;
    const catDone = Object.keys(ADVANCEMENTS).filter((k) => ADVANCEMENTS[k].cat === this.cat && g.adv[k]).length;
    const summary = ADV_CATS[this.cat].title + ' ' + catDone + '/' + catTotal;
    Font.draw(c, summary, 8, 8, '#FFFF55');
    Font.draw(c, done + '/' + total, W - 8 - Font.width(done + '/' + total), 8, '#AAAAAA');
    // 列表：两列（窄屏一列），按原版树状缩进；隐藏进度完成后才出现
    const cols = W >= 380 ? 3 : W >= 260 ? 2 : 1, rowH = 18, top = 39, detailH = 50;
    const bot = H - 26 - 8 - detailH;
    const cw = Math.floor((W - 20) / cols);
    this.maxScroll = Math.max(0, Math.ceil(list.length / cols) * rowH + 4 - (bot - top));
    this.scroll = clamp(this.scroll || 0, 0, this.maxScroll);
    c.save(); c.beginPath(); c.rect(0, top, W, bot - top); c.clip();
    list.forEach((id, i) => {
      const x = 10 + (i % cols) * cw, y = top + 2 + Math.floor(i / cols) * rowH - this.scroll;
      if (y > bot || y + rowH < top) return;
      const a = ADVANCEMENTS[id], got = !!g.adv[id], selected = id === this.sel;
      c.fillStyle = selected ? 'rgba(255,255,255,0.25)' : got ? 'rgba(35,95,35,0.55)' : 'rgba(0,0,0,0.45)';
      c.fillRect(x, y, cw - 4, rowH - 1);
      const fc = a.frame === 'challenge' ? '#FF55FF' : a.frame === 'goal' ? '#55FF55' : '#AAAAAA';
      c.fillStyle = fc; c.fillRect(x, y, 2, rowH - 1);
      const icon = this.iconId(a);
      if (icon) ui.drawItem({ id: icon, count: 1 }, x + 4, y + 1);
      const indent = Math.min(12, this.depth(id) * 2);
      const name = fitText(a.title, cw - 32 - indent);
      Font.draw(c, name, x + 24 + indent, y + 4, got ? '#FFFF55' : '#BBBBBB');
    });
    c.restore();
    // 滚动条
    if (list.length && this.maxScroll > 0) {
      const sx = W - 8, bh = Math.max(24, (bot - top) * (bot - top) / (Math.ceil(list.length / cols) * rowH + 4));
      const by = top + (bot - top - bh) * this.scroll / this.maxScroll;
      ui.nine('wscroller_bg', sx, top, 6, bot - top, 1); ui.nine('wscroller', sx, by, 6, bh, 1);
    }
    // 详情：原版的目标/挑战边框色、中文标题、描述和完成状态
    const a = this.sel && ADVANCEMENTS[this.sel];
    const py = bot + 4;
    c.fillStyle = 'rgba(0,0,0,0.72)'; c.fillRect(10, py, W - 20, detailH);
    c.strokeStyle = a ? (a.frame === 'challenge' ? '#FF55FF' : a.frame === 'goal' ? '#55FF55' : '#888888') : '#444444';
    c.strokeRect(10.5, py + 0.5, W - 21, detailH - 1);
    if (!a) { Font.draw(c, '这一类还没有可显示的进度', 18, py + 8, '#AAAAAA'); return; }
    const icon = this.iconId(a);
    if (icon) ui.drawItem({ id: icon, count: 1 }, 16, py + 3);
    Font.draw(c, a.title, 42, py + 4, g.adv[this.sel] ? '#FFFF55' : '#FFFFFF');
    const fname = a.frame === 'challenge' ? '挑战' : a.frame === 'goal' ? '目标' : '任务';
    Font.draw(c, fname + (g.adv[this.sel] ? ' · 已完成' : ' · 未完成'), 42, py + 16, a.frame === 'challenge' ? '#FF55FF' : a.frame === 'goal' ? '#55FF55' : '#AAAAAA');
    const desc = fitText(a.desc || '', W - 56);
    Font.draw(c, desc, 16, py + 32, '#CCCCCC');
  }
  mouseDown(ui, mx, my, b) {
    if (b !== 0) return;
    for (const t of this.tabs) if (mx >= t.x && mx < t.x + t.w && my >= t.y && my < t.y + t.h) {
      if (this.cat !== t.cat) { this.cat = t.cat; this.scroll = 0; this.sel = null; Sound.click(); }
      return;
    }
    const list = this.visible(), cols = ui.w >= 380 ? 3 : ui.w >= 260 ? 2 : 1, rowH = 18, top = 39;
    const bot = ui.h - 26 - 8 - 50, cw = Math.floor((ui.w - 20) / cols);
    if (mx >= 10 && mx < ui.w - 10 && my >= top && my < bot) {
      const i = Math.floor((my - top - 2 + this.scroll) / rowH) * cols + (mx - 10 >= cw ? 1 : 0);
      this.drag = { y: my, scroll: this.scroll, moved: false, id: i >= 0 && i < list.length ? list[i] : null };
      return;
    }
    super.mouseDown(ui, mx, my, b);
  }
  mouseMove(ui, mx, my) {
    if (!this.drag) return;
    const dy = my - this.drag.y;
    if (Math.abs(dy) > 4) this.drag.moved = true;
    if (this.drag.moved) this.scroll = clamp(this.drag.scroll - dy, 0, this.maxScroll || 0);
  }
  mouseUp() {
    if (this.drag && !this.drag.moved && this.drag.id) { this.sel = this.drag.id; Sound.click(); }
    this.drag = null;
  }
  wheel(ui, dy) { this.scroll = clamp((this.scroll || 0) + Math.sign(dy) * 24, 0, this.maxScroll || 0); }
  onEsc() { this.game.ui.open(this.parent); }
}

class StatsScreen extends MenuScreen {
  constructor(game, parent) { super(game, '统计信息'); this.parent = parent; this.pauses = true; this.bgDim = 0.75; }
  layout() { const u = this.game.ui; this.widgets = [{ x: u.w / 2 - 100, y: u.h - 28, w: 200, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) }]; }
  drawExtra(ui) {
    const g = this.game, s = g.stats, c = ui.ctx;
    const lines = [['游戏天数', Math.floor(g.worldTime / 24000) + 1], ['放置的方块', s.placed], ['挖掘的方块', s.mined], ['击杀的生物', s.kills], ['经验等级', g.xpLevel()], ['世界种子', g.world.seed]];
    lines.forEach(([a, b], i) => { Font.draw(c, a, ui.w / 2 - 100, 50 + i * 14, '#FFFFFF'); const t = String(b); Font.draw(c, t, ui.w / 2 + 100 - Font.width(t), 50 + i * 14, '#FFFF55'); });
  }
  onEsc() { this.game.ui.open(this.parent); }
}

class DeathScreen extends MenuScreen {
  constructor(game) { super(game, null); this.blurBg = false; this.bgDim = 0; this.pauses = false; this.t = performance.now(); }
  layout() {
    const u = this.game.ui, cx = u.w / 2, y = Math.floor(u.h / 4 + 72), g = this.game;
    const toTitle = () => { g.player.health = 20; g.player.deathTime = 0; g.respawn(); g.quitToTitle(); };
    this.widgets = g.hardcore ? [
      { x: cx - 100, y, w: 200, h: 20, label: '旁观世界', onClick: () => { g.respawn(); g.setMode('spectator', true); } },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: '标题屏幕', onClick: toTitle },
    ] : [
      { x: cx - 100, y, w: 200, h: 20, label: '重生', onClick: () => g.respawn() },
      { x: cx - 100, y: y + 24, w: 200, h: 20, label: '标题屏幕', onClick: toTitle },
    ];
  }
  draw(ui) {
    const c = ui.ctx;
    // vanilla DeathScreen: fillGradient(0x60500000 -> 0xA0803030)
    const gr = c.createLinearGradient(0, 0, 0, ui.h);
    gr.addColorStop(0, 'rgba(80,0,0,0.376)'); gr.addColorStop(1, 'rgba(128,48,48,0.627)');
    c.fillStyle = gr; c.fillRect(0, 0, ui.w, ui.h);
    c.save(); c.scale(2, 2); Font.center(c, this.game.hardcore ? '游戏结束！' : '你死了！', ui.w / 4, 30, '#FFFFFF'); c.restore();
    Font.center(c, this.game.deathMsg || '', ui.w / 2, 85, '#FFFFFF');
    const sc = '分数：', sv = String(this.game.deathScore || 0), sx = ui.w / 2 - Font.width(sc + sv) / 2;
    Font.draw(c, sc, sx, 100, '#FFFFFF'); Font.draw(c, sv, sx + Font.width(sc), 100, '#FFFF55');
    const ok = performance.now() - this.t > 1000;
    for (const w of this.widgets) { w.enabled = ok; ui.button(w); }
  }
}

class HelpScreen extends MenuScreen {
  constructor(game, parent) { super(game, '游戏说明'); this.parent = parent; this.pauses = true; this.bgDim = 0.8; this.bgDirt = parent instanceof TitleScreen; this.page = 0; this.titleY = 10; }
  layout() {
    const u = this.game.ui, cx = u.w / 2;
    this.widgets = [
      { x: cx - 154, y: u.h - 26, w: 74, h: 20, label: '< 上一页', onClick: () => this.page = Math.max(0, this.page - 1) },
      { x: cx - 76, y: u.h - 26, w: 152, h: 20, label: '完成', onClick: () => this.game.ui.open(this.parent) },
      { x: cx + 80, y: u.h - 26, w: 74, h: 20, label: '下一页 >', onClick: () => this.page = Math.min(HELP_PAGES.length - 1, this.page + 1) },
    ];
  }
  drawExtra(ui) {
    const c = ui.ctx, pg = HELP_PAGES[this.page];
    Font.center(c, `${pg.title}  (${this.page + 1}/${HELP_PAGES.length})`, ui.w / 2, 24, '#FFFF55');
    let y = 40;
    for (const line of pg.lines) {
      if (y > ui.h - 40) break;
      const [k, v] = line.split('|');
      if (v !== undefined) { Font.draw(c, k, ui.w / 2 - 150, y, '#FFFFA0'); Font.draw(c, v, ui.w / 2 - 60, y, '#FFFFFF'); }
      else Font.draw(c, k, ui.w / 2 - 150, y, '#E0E0E0');
      y += 11;
    }
  }
  onEsc() { this.game.ui.open(this.parent); }
}
const HELP_PAGES = [
  { title: '基本操作', lines: ['W A S D|移动', '空格|跳跃 / 游泳上浮 / (创造) 双击切换飞行', '左 Shift|潜行（不会从边缘掉落）/ 飞行下降', '左 Ctrl 或 双击 W|疾跑', '鼠标移动|转动视角', '鼠标左键|挖掘方块 / 攻击生物（按住持续挖掘）', '鼠标右键|放置方块 / 使用物品 / 打开容器 / 吃东西 / 拉弓', '鼠标中键|选取方块', '滚轮 / 1-9|切换快捷栏', 'E|打开物品栏', 'Q|丢弃物品 (Ctrl+Q 丢弃一组)', 'F1 / F3 / F5|隐藏界面 / 调试信息 / 切换视角', 'T 或 /|打开聊天与命令', 'Esc|游戏菜单（暂停）'] },
  { title: '物品栏操作', lines: ['左键|拿起 / 放下整组物品', '右键|拿起一半 / 放下一个', 'Shift + 左键|快速移动物品', '按住左键拖动|在多个格子之间平均分配', '按住右键拖动|每个格子放一个', '双击|收集同类物品', '悬停 + 数字键|与快捷栏交换', '悬停 + Q|丢弃物品', '', '创造模式物品栏：点击顶部标签切换分类，', '滚轮滚动；最后一个标签可以搜索物品。', '把物品放到右下角的 X 格可以删除。'] },
  { title: '触屏操作', lines: ['（选项 → 控制… → 触屏操作；手机和平板默认开启）', '左下方向键|移动（按住上键时出现斜向键）', '方向键中间|潜行（点一下切换）', '跳跃键|跳跃 / 游泳上浮 / (创造) 双击切换飞行', '飞行时|跳跃键上升，下方按钮下降', '疾跑键 / 双击上键|疾跑', '在屏幕上拖动|转动视角', '轻点|放置方块 / 使用物品 / 攻击准星对准的生物', '按住不动|挖掘方块（手持食物、弓等则为使用）', '“互动”按钮|与准星对准的生物互动 / 交易', '点 / 按住快捷栏|选择 / 丢弃整组物品', '快捷栏右侧 …|打开物品栏', '物品栏里|点击=左键，长按=右键，双击=快速移动'] },
  { title: '生存入门', lines: ['1. 徒手撸树获得原木，合成木板（在物品栏 2x2 合成格）', '2. 4 个木板合成工作台，右键打开 3x3 合成', '3. 木板竖放 2 个合成木棍，制作木镐', '4. 挖石头获得圆石，制作石镐、熔炉', '5. 煤炭 + 木棍合成火把，照亮洞穴防止怪物生成', '6. 用熔炉把粗铁冶炼成铁锭，制作铁镐与铁甲', '7. 铁镐可以挖掘钻石矿（在 Y<16 的深层）', '', '饥饿值不足时无法疾跑、不能回血，记得吃东西！', '夜晚会生成僵尸、骷髅、苦力怕和蜘蛛。', '摔落、溺水、岩浆、仙人掌都会造成伤害。', '按 Esc → 进度 查看你的成就目标。'] },
  { title: '常用配方', lines: ['工作台|4 木板 (2x2)', '木棍|2 木板竖放', '镐|上排 3 材料 + 中间竖放 2 木棍', '斧 / 锹 / 剑 / 锄|同原版摆法', '熔炉|8 圆石围一圈', '箱子|8 木板围一圈', '火把|煤炭/木炭 在 木棍 上方', '面包|3 小麦横排', 'TNT|火药与沙子交错 (5 火药 + 4 沙子)', '床|3 羊毛 + 3 木板，夜晚右键睡觉跳过黑夜', '弓 / 箭|木棍+线 / 燧石+木棍+羽毛', '桶|3 铁锭 V 形；可装水和熔岩', '盔甲|皮革/铁/钻石，同原版摆法', '其他: 楼梯、台阶、门、梯子、书架、砖块…'] },
  { title: '玩法机制', lines: ['• 平滑光照与环境光遮蔽，火把/荧石/熔岩发光', '• 真实的水与熔岩流动，水遇熔岩生成黑曜石/圆石', '• 沙子与沙砾会受重力下落', '• TNT 与苦力怕爆炸可以破坏地形并连锁引爆', '• 用锄头耕地、种小麦，骨粉催熟；树苗可以长成树', '• 用剪刀剪羊毛，用小麦/种子/胡萝卜引诱并繁殖动物', '• 熔炉冶炼矿石与烹饪食物，获得经验', '• 昼夜循环、月相、星空、云层、雨雪天气；床可跳过夜晚', '• 多种生物群系：平原、森林、桦木林、针叶林、', '  雪原、沙漠、山地、海洋、河流、沙滩', '• 世界自动保存，可在主菜单管理多个存档', '• 三个维度：主世界、下界、末地（各自独立保存）', '• 使用原版音效（声音来自对应方向和距离）', '• 两个箱子并排放置会合成大型箱子（潜行放置则不合并）', '• 选项 → 光影：关 / 低 / 中 / 高 / 极限（实时阴影、水面反射等）'] },
  { title: '通关路线', lines: ['1. 准备铁装备、弓箭、食物，挖到钻石做钻石镐', '2. 用钻石镐挖 10 块以上黑曜石（水浇在熔岩源上）', '3. 黑曜石搭 4x5 门框，打火石点燃 → 进入下界', '4. 在下界找到下界要塞（暗红色砖块的桥与走廊）', '5. 击杀烈焰人获得烈焰棒 → 合成烈焰粉', '6. 击杀末影人获得末影珍珠（别盯着它的眼睛看！）', '7. 末影珍珠 + 烈焰粉 = 末影之眼（准备 12 个以上）', '8. 回主世界向空中扔末影之眼，它会飞向要塞方向', '9. 在眼睛掉落处往下挖，找到要塞里的末地传送门', '10. 把末影之眼放进 12 个框架，跳进传送门', '11. 用弓箭射掉黑曜石柱顶的末地水晶（会治疗末影龙）', '12. 末影龙停在中央传送门上时攻击它的头部', '13. 击败末影龙后跳进返回传送门 → 终末之诗 → 通关！'] },
  { title: '下界与末地', lines: ['• 下界：没有昼夜和水，水会蒸发，床会爆炸', '  坐标与主世界 1:8 对应，传送门会自动建造或连接', '• 恶魂：远程发射火球，用剑或拳头可以把火球打回去', '• 烈焰人：三连发小火球，会点燃你；要塞里有刷怪笼', '• 僵尸猪灵：中立，攻击一只会让附近的同伴一起围攻', '• 岩浆怪：会分裂；末影人：直视会激怒，遇水瞬移', '• 末影珍珠：右键投掷后传送到落点，受到 5 点伤害', '• 末地：床同样会爆炸；掉进虚空会死亡', '• 末影龙 200 生命值：盘旋、俯冲、喷射龙息火球，', '  停在传送门上时喷吐龙息（站在紫雾里会持续掉血）', '• 头部受到全额伤害，身体和翅膀只受到约 1/4 伤害', '• 末地水晶爆炸威力很大，不要近战打它！'] },
  { title: '村庄与结构', lines: ['• 原版地形的世界会生成原版结构：五种风格的村庄、', '  掠夺者前哨站、古城、试炼密室、古迹废墟、沙漠神殿、', '  丛林神庙、沼泽小屋、雪屋、沉船、海底废墟、', '  废弃传送门、废弃矿井、埋藏的宝藏；下界有堡垒遗迹、', '  下界要塞与下界化石', '• 结构里的箱子按原版战利品表生成物品', '• 无业村民会认领附近的工作站（堆肥桶→农民、', '  讲台→图书管理员、高炉→盔甲匠…）', '• 右键有职业的村民打开交易界面：点左侧的交易，', '  材料会自动放好，取走右侧物品即完成交易', '• 交易让村民升级（新手→大师）并解锁新交易', '• 铁傀儡守护村庄，会攻击附近的敌对生物', '• /locate village 查找最近的村庄（或其他结构名）'] },
  { title: '命令 (按 T 或 /)', lines: ['/gamemode creative|survival|切换游戏模式', '/time set day|night|noon|<数值>|设置时间', '/weather clear|rain|设置天气', '/give <物品英文名> [数量]|给予物品，如 /give ender_eye 12', '/tp <x> <y> <z>|传送', '/summon <生物>|生成生物，如 blaze ghast ender_dragon', '/kill|自杀', '/kill @e[type=<生物>]|清除指定实体，如 ender_dragon', '/locate <结构>|查找结构，如 village stronghold fortress', '/tpdim overworld|nether|end|直接前往某个维度', '/spawnpoint|设置重生点为当前位置', '/seed|显示世界种子', '/clear|清空物品栏', '/xp <数量>|获得经验'] },
];

class ChatScreen extends MenuScreen {
  constructor(game, prefill = '') { super(game, null); this.blurBg = false; this.bgDim = 0; this.isChat = true; this.prefill = prefill; this.hist = game.chatHistory || (game.chatHistory = []); this.hi = this.hist.length; game.ui.chatOff = 0; }
  // the wheel (or a finger dragged) goes back through the last 100 messages, 7 lines a notch, 1 with shift - like
  // vanilla's ChatScreen.mouseScrolled; there was no scrolling at all (players' feedback 2026-10-31)
  wheel(ui, dy) { ui.chatOff = clamp((ui.chatOff || 0) - Math.sign(dy) * (ui.wheelShift ? 1 : 7), 0, Math.max(0, ui.chat.length - 20)); ui.wheelShift = false; }
  layout() {
    const u = this.game.ui, send = (v) => { u.close(); if (v.trim()) { this.hist.push(v); runCommand(this.game, v.trim()); } };
    // (on a touch screen a 发送 button at the end of the line, and the keyboard's return key reads 发送: iOS players
    // found no way to send - feedback 2026-11-01 12:58)
    const tb = navigator.maxTouchPoints > 0 || (typeof touchOn === 'function' && touchOn(this.game)), bw = tb ? 34 : 0;
    this.widgets = tb ? [{ x: u.w - 2 - bw, y: u.h - 15, w: bw, h: 14, label: '发送', onClick: () => send(u.input.value) }] : [];
    // (laid out again - the window resized, as Android's on-screen keyboard coming up does - the text typed so far
    // stays: it went back to the prefill, "安卓打字时聊天框文字被清空", feedback 2026-11-01 09:15)
    const v = this.shownOnce && u.input.style.display === 'block' ? u.input.value : this.prefill; this.shownOnce = true;
    u.showInput(2, u.h - 14, u.w - 4 - (bw ? bw + 2 : 0), 12, v, send, { onEsc: () => u.close(), max: 256, enter: 'send' });
    const el = u.input, prev = el.onkeydown;
    el.onkeydown = (e) => {
      if (e.key === 'ArrowUp' && this.hi > 0) { this.hi--; el.value = this.hist[this.hi]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { this.hi = Math.min(this.hist.length, this.hi + 1); el.value = this.hist[this.hi] || ''; e.preventDefault(); }
      else if (e.key === 'Tab') { e.preventDefault(); this.complete(el); }
      prev(e);
    };
  }
  complete(el) {
    const v = el.value, parts = v.split(' ');
    if (parts[0] === '/give' && parts.length === 2) { const m = Object.keys(ITEM_KEY).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/give ' + m[0]; }
    else if (parts[0] === '/summon' && parts.length === 2) { const m = Object.keys(MOB_TYPES).filter(k => k.startsWith(parts[1])); if (m.length) el.value = '/summon ' + m[0]; }
    else if (parts.length === 1) { const m = ['/gamemode', '/time', '/weather', '/give', '/tp', '/summon', '/kill', '/locate', '/tpdim', '/spawnpoint', '/seed', '/clear', '/xp', '/help'].filter(k => k.startsWith(v)); if (m.length) el.value = m[0] + ' '; }
  }
  draw(ui) { const c = ui.ctx, b = this.widgets[0]; c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(2, ui.h - 14, ui.w - 4 - (b ? b.w + 2 : 0), 12); if (b) ui.button(b); }
}

// leaving a world for the title (single player, a room on the server, a local room) takes its chat along, like vanilla's
// disconnect (the lines typed stay for ↑): a room's messages were still there in the single-player world entered next
// (players' feedback 2026-11-01 10:09)
(() => {
  const st = Game.prototype.startTitle;
  Game.prototype.startTitle = function (...a) { if (this.ui) { this.ui.chat.length = 0; this.ui.chatOff = 0; } return st.apply(this, a); };
})();

// a command as typed, made what a server accepts: runs of spaces outside quotes one space, none at the ends (a taken
// suggestion leaves a space after it; the server's parser refuses "/gamemode creative " and double spaces - the
// command just failed: players' feedback 2026-11-01). Chat stays as typed
function cmdTidy(text) {
  if (!text.startsWith('/')) return text;
  let out = '', q = null;
  for (const ch of text.trim()) {
    if (q) { out += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; out += ch; continue; }
    if (/\s/.test(ch)) { if (!out.endsWith(' ')) out += ' '; continue; }
    out += ch;
  }
  return out.trim();
}
function runCommand(g, text) {
  text = cmdTidy(text);
  if (g.net) { g.net.chat(text); return; } // on a server: chat and commands are the server's
  const p = g.player, ui = g.ui;
  if (!text.startsWith('/')) { ui.message('<玩家> ' + text); return; }
  // (vanilla's syntax and most commands: cmdrun.js; /locate and /tpdim still here)
  if (typeof cmdExec === 'function' && !/^\/(locate|tpdim|dimension)\b/.test(text)) { cmdExec(g, text); return; }
  const [cmd, ...a] = text.slice(1).split(/\s+/);
  const err = (m) => ui.message(m, '#FF5555');
  if (!g.cheats && !['help', 'seed', 'me', 'msg', 'tell', 'w', 'list', 'trigger'].includes(cmd)) return err('这个世界没有开启“允许命令”。请在创建世界时打开“允许命令”，或使用已开启命令的存档。');
  try {
    switch (cmd) {
      case 'help': ui.message('可用命令: /gamemode /time /weather /give /tp /summon /kill [@e[type=…]] /locate /tpdim /spawnpoint /seed /clear /xp', '#FFFF55'); break;
      case 'gamemode': case 'gm': {
        const m = { creative: 'creative', c: 'creative', 1: 'creative', survival: 'survival', s: 'survival', 0: 'survival', spectator: 'spectator', sp: 'spectator', 3: 'spectator' }[a[0]];
        if (!m) return err('用法: /gamemode creative|survival|spectator');
        g.setMode(m); break;
      }
      case 'time': {
        if (a[0] === 'set' || a[0] === 'add') {
          const named = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
          let v = named[a[1]] ?? parseInt(a[1]);
          if (isNaN(v)) return err('用法: /time set day|night|noon|midnight|<数值>');
          if (a[0] === 'set') g.worldTime = Math.floor(g.worldTime / 24000) * 24000 + v; else g.worldTime += v;
          ui.message('时间已设置为 ' + v, '#AAAAAA');
        } else ui.message('当前时间: ' + g.dayTime(), '#AAAAAA');
        break;
      }
      case 'weather': {
        if (a[0] === 'clear') { g.rainTarget = 0; g.weather = 0; g.weatherTimer = 24000; }
        else if (a[0] === 'rain' || a[0] === 'thunder') { g.rainTarget = 1; g.weather = 1; g.weatherTimer = 12000; }
        else return err('用法: /weather clear|rain');
        ui.message('天气已更改', '#AAAAAA'); break;
      }
      case 'give': {
        const key = (a[0] || '').replace('minecraft:', '');
        const id = ITEM_KEY[key];
        if (id === undefined) return err('未知物品: ' + key);
        const n = Math.max(1, Math.min(64 * 36, parseInt(a[1]) || 1));
        let left = n;
        while (left > 0) { const k = Math.min(left, maxStack(id)); const r = p.inv.add({ id, count: k, dmg: 0 }); if (r) { g.dropFromPlayer({ id, count: r, dmg: 0 }); } left -= k; }
        ui.message(`已将 ${n} 个 [${ITEMS[id].cn}] 给予玩家`, '#AAAAAA'); break;
      }
      case 'tp': {
        const v = a.map((s, i) => s.startsWith('~') ? p.pos[i] + (parseFloat(s.slice(1)) || 0) : parseFloat(s) - (i === 1 ? (g.world.minY || 0) : 0));
        if (v.length < 3 || v.some(isNaN)) return err('用法: /tp <x> <y> <z>');
        p.pos = [v[0], v[1], v[2]]; p.prev = [...p.pos]; p.vel = [0, 0, 0]; p.fallDist = 0;
        ui.message(`已传送至 ${v.map((x, i) => (x + (i === 1 ? (g.world.minY || 0) : 0)).toFixed(1)).join(', ')}`, '#AAAAAA'); break;
      }
      case 'summon': {
        const t = (a[0] || '').replace('minecraft:', '');
        if (t === 'tnt') { g.addEntity(new PrimedTNT(g, Math.floor(p.pos[0]), p.pos[1], Math.floor(p.pos[2]))); break; }
        if (!MOB_TYPES[t] && t !== 'ender_dragon') return err('未知生物: ' + t + '（可用: ' + Object.keys(MOB_TYPES).join(' ') + ' ender_dragon）');
        const d = g.lookDir();
        if (t === 'ender_dragon') { g.addEntity(new EnderDragon(g, p.pos[0] + d[0] * 20, p.pos[1] + 15, p.pos[2] + d[2] * 20)); ui.message('已生成 末影龙', '#AAAAAA'); break; }
        const m = createMob(g, t, p.pos[0] + d[0] * 3, p.pos[1] + 0.5, p.pos[2] + d[2] * 3);
        m.persistent = true;
        g.addEntity(m);
        ui.message('已生成 ' + MOB_TYPES[t].cn, '#AAAAAA'); break;
      }
      case 'kill': {
        const sel = a.join('').replace(/\s/g, '');
        if (sel.startsWith('@e')) {
          const m = sel.match(/type=(?:minecraft:)?([a-z_]+)/);
          let n = 0;
          for (const e of g.entities) {
            if (e.dead || (m && e.type !== m[1])) continue;
            if (!m && !(e instanceof Living) && !(e instanceof ItemEntity) && !e.hittable) continue;
            if (e instanceof EnderDragon) { if (e.deathTime === 0) { e.health = 0; e.deathTime = 1; Sound.ev('entity.ender_dragon.death', e.pos, 10, 1); n++; } continue; }
            if (e instanceof EndCrystal) { e.dead = true; n++; continue; }
            if (e instanceof Living) { if (e.deathTime === 0) { e.health = 0; e.die({ type: 'void' }); n++; } }
            else { e.dead = true; n++; }
          }
          ui.message(n ? `已清除 ${n} 个实体` : '没有找到匹配的实体', n ? '#AAAAAA' : '#FF5555');
          break;
        }
        if (g.mode === 'creative') { p.health = 0; p.die({ type: 'void' }); } else p.hurt(1000, { type: 'void' });
        break;
      }
      case 'locate': {
        const what = (a[0] === 'structure' ? a[1] : a[0]) || '';
        if (what.includes('stronghold')) { const s = g.nearestStronghold(); if (!s) return err('该维度没有要塞'); ui.message(`最近的要塞位于 [${s.x}, ~, ${s.z}]（距离 ${Math.round(Math.hypot(s.x - p.pos[0], s.z - p.pos[2]))} 格）`, '#55FF55'); }
        else if (what.includes('fortress')) { if (g.dim !== 'nether') return err('下界要塞只存在于下界'); const f = g.world.nearestFortress(p.pos[0], p.pos[2]); if (!f) return err('附近没有下界要塞'); ui.message(`最近的下界要塞位于 [${f.x}, ${f.y}, ${f.z}]（距离 ${Math.round(Math.hypot(f.x - p.pos[0], f.z - p.pos[2]))} 格）`, '#55FF55'); }
        else if (what && g.world.gen2 && g.genPool) {
          // vanilla structures (village, bastion_remnant, pillager_outpost, ancient_city, trail_ruins, trial_chambers, ...)
          const name = what.replace('minecraft:', '');
          ui.message('正在查找 ' + name + ' ...', '#AAAAAA');
          g.genPool.request({ type: 'locate', name, cx: Math.floor(p.pos[0]) >> 4, cz: Math.floor(p.pos[2]) >> 4, dim: g.dim }, (m) => {
            if (!m.r) { ui.message('附近找不到 ' + name, '#FF5555'); return; }
            g.lastLocate = m.r;
            ui.message(`最近的 ${m.r.name} 位于 [${m.r.x}, ~, ${m.r.z}]（距离 ${Math.round(m.r.d)} 格）`, '#55FF55');
          });
        }
        else if (what) return err('这个存档使用旧生成器，只能查找要塞和下界要塞；' + what + ' 请在默认生成的世界里查找');
        else return err('用法: /locate stronghold|fortress|village|bastion_remnant|...');
        break;
      }
      case 'tpdim': case 'dimension': {
        const d = { overworld: 'overworld', nether: 'nether', the_nether: 'nether', end: 'end', the_end: 'end' }[(a[0] || '').replace('minecraft:', '')];
        if (!d) return err('用法: /tpdim overworld|nether|end');
        if (d === g.dim) return err('你已经在这个维度了');
        if (d === 'end') { ui.message('正在进入末地…', '#AAAAAA'); g.enterEndPortal(); break; }
        if (d === 'nether' || g.dim === 'nether') { ui.message(d === 'nether' ? '正在进入下界…' : '正在返回主世界…', '#AAAAAA'); g.useNetherPortal(); break; }
        ui.message('正在返回主世界…', '#AAAAAA');
        g.leaveEnd();
        break;
      }
      case 'spawnpoint': p.spawn = [Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2])]; p.bedSpawn = false; ui.message('已设置重生点', '#AAAAAA'); break;
      case 'seed': ui.message('种子: [' + (g.worldMeta ? g.worldMeta.seed : g.world.seed) + ']', '#FFFFFF'); break;
      case 'clear': p.inv.slots.fill(null); ui.message('已清空物品栏', '#AAAAAA'); break;
      case 'xp': g.addXp(parseInt(a[0]) || 0); break;
      default: err('未知命令。输入 /help 查看帮助');
    }
  } catch (e) { err('命令出错: ' + e.message); }
}

Game.prototype.setMode = function (m, quiet) {
  const p = this.player, prev = this.mode;
  if (m !== prev) this.prevMode = prev;
  this.mode = m;
  if (m === 'spectator') { p.flying = true; p.noClip = true; }
  else {
    p.noClip = false;
    if (m === 'survival') p.flying = false;
    if (prev === 'spectator' && m === 'creative') p.flying = true;
  }
  if (!quiet) this.ui.message('已将自己的游戏模式设置为' + { survival: '生存模式', creative: '创造模式', spectator: '旁观模式' }[m], '#AAAAAA');
};

// 「退出游戏」: most places do not let a page close itself (a tab the player opened, the Bilibili app, the Toy page's
// frame) - window.close() did nothing there and the button seemed dead (Android feedback 2026-10-31). In Toy the
// container closes it (toy.closeBrowser); elsewhere the page tries, and if it is still here a moment later, says how
async function quitGame(g) {
  const sc = g.ui.screen;
  if (fsElement()) fsExit();
  try {
    if (typeof Toy !== 'undefined' && await Promise.race([Toy.inToy(), new Promise((r) => setTimeout(() => r(false), 1500))]))
      await Promise.race([Toy.closeBrowser(), new Promise((r) => setTimeout(r, 1500))]);
  } catch (e) { }
  try { window.close(); } catch (e) { }
  setTimeout(() => { if (!document.hidden && g.ui.screen === sc && sc) sc.quitTip = performance.now(); }, 600);
}

// the page full screen and back. iPhone WebKit has no element full screen at all (only a <video> can), iPads and older
// Safari only the webkit-prefixed one: requestFullscreen called where it is missing threw - telemetry 11-02/03: 878
// devices, the iOS Bilibili app and Safari. Where there is none (or the frame may not: fullscreenEnabled false) the
// 全屏 buttons say so and the key tells the player instead of doing nothing
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
// Not on an iPad either (IOS_WEBGL, 11-07): the webkit-prefixed call there since 11-06, and iPad sessions that went full
// screen died 3x as often (33.7% vs 10.6% - the page killed and opened again); before, the call failed and none did
function fsSupported() {
  const de = document.documentElement;
  if (typeof IOS_WEBGL !== 'undefined' && IOS_WEBGL) return false;
  return !!(de.requestFullscreen || de.webkitRequestFullscreen) && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled) !== false;
}
function fsExit() {
  const ex = document.exitFullscreen || document.webkitExitFullscreen;
  try { const r = ex && ex.call(document); if (r && r.catch) r.catch(() => { }); } catch (e) { }
}
function toggleFullscreen() {
  if (fsElement()) { fsExit(); return; }
  const de = document.documentElement, req = de.requestFullscreen || de.webkitRequestFullscreen;
  const no = () => { if (typeof game !== 'undefined' && game.ui) game.ui.message('这个浏览器不支持网页全屏', '#FFFF55'); };
  if (!req || !fsSupported()) { no(); return; }
  const lock = () => { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Escape']).catch(() => { }); };
  try { const r = req.call(de); if (r && r.then) r.then(lock, () => { }); } catch (e) { no(); }
}
