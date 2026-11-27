// 启动动画 / 标题背景视频（设置里可以开关、换成本地视频）
// 设置存在 localStorage：mcjs-startup = { on, src: 'builtin'|'custom', title }
// 自定义视频存在 IndexedDB：mcjs-media / blobs / 'startup'
window.StartupMedia = (function () {
  const KEY = 'mcjs-startup';
  const DEFAULTS = { on: false, src: 'builtin', title: false };
  const BUILTIN = 'media/startup.mp4';

  function get() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { c = {}; }
    // 启动动画默认关闭；只有用户在设置里手动打开过才会 on=true
    return { on: c.on === true, src: c.src === 'custom' ? 'custom' : 'builtin', title: c.title === true, name: typeof c.name === 'string' ? c.name : '' };
  }
  function put(patch) {
    const c = Object.assign(get(), patch || {});
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { }
    return c;
  }

  // ---- 自定义视频：IndexedDB ----
  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('浏览器不支持本地视频存储'));
      const r = indexedDB.open('mcjs-media', 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('打不开本地视频存储'));
    });
  }
  async function saveBlob(blob) { const db = await idb(); await new Promise((res, rej) => { const q = db.transaction('blobs', 'readwrite').objectStore('blobs').put(blob, 'startup'); q.onsuccess = res; q.onerror = () => rej(q.error); }); }
  async function loadBlob() { const db = await idb(); return await new Promise((res, rej) => { const q = db.transaction('blobs', 'readonly').objectStore('blobs').get('startup'); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }
  async function clearBlob() { try { const db = await idb(); await new Promise((res) => { const q = db.transaction('blobs', 'readwrite').objectStore('blobs').delete('startup'); q.onsuccess = res; q.onerror = res; }); } catch (e) { } }

  async function blobUrl() {
    try { const b = await loadBlob(); if (b) return URL.createObjectURL(b); } catch (e) { }
    return null;
  }
  // 启动动画的地址：内置，或用户自己选的视频（没有就回退到内置）
  async function bootUrl() {
    const c = get(); if (!c.on) return null;
    if (c.src === 'custom') { const u = await blobUrl(); if (u) return u; }
    return BUILTIN;
  }
  // 主菜单背景视频的地址；没开就返回 null
  async function titleUrl() {
    const c = get(); if (!c.title) return null;
    if (c.src === 'custom') { const u = await blobUrl(); if (u) return u; }
    return BUILTIN;
  }

  // ---- 标题界面上的 <video id="titlevideo"> ----
  function el() { return document.getElementById('titlevideo'); }
  // 标题界面每帧取这一帧画面（没有开、没加载好就返回 null）
  function videoEl() { const v = el(); return v && v.style.display !== 'none' && v.readyState >= 2 && v.videoWidth ? v : null; }
  function hideTitle() {
    const v = el(); if (!v) return;
    v.style.display = 'none';
    try { v.pause(); } catch (e) { }
  }
  function showWith(url) {
    const v = el(); if (!v) return null;
    hideTitle();
    if (!url) return null;
    v.muted = true; v.loop = true; v.playsInline = true;
    if (v.getAttribute('src') !== url) v.src = url;
    v.style.display = 'block'; v.style.opacity = '0'; // 实际画面由 TitleScreen 画进 UI 画布（UI 画布不透明，DOM 视频放它后面会被盖住）
    const p = v.play(); if (p && p.catch) p.catch(() => hideTitle());
    return v;
  }
  // TitleScreen 构造时调用：按设置决定是否把视频铺在主菜单后面
  function titleVideo() {
    return titleUrl().then(u => showWith(u)).catch(() => hideTitle());
  }

  // 设置界面：选内置 / 选本地文件 / 关 / 主菜单也用
  async function setOn(on) { const c = put({ on: !!on }); if (!c.on) hideTitle(); return c; }
  async function setSource(src) { return put({ src: src === 'custom' ? 'custom' : 'builtin' }); }
  async function setTitle(on) { const c = put({ title: !!on }); if (!c.title) hideTitle(); return c; }
  async function useFile(file) {
    if (!file) throw new Error('没有选择文件');
    if (!/^video\//.test(file.type || '') && !/\.(mp4|webm|ogg|mov|m4v)$/i.test(file.name || '')) throw new Error('请选择视频文件（mp4 / webm）');
    await saveBlob(file);
    return put({ on: true, src: 'custom', name: file.name || '本地视频' });
  }
  async function useBuiltin() { await clearBlob(); return put({ src: 'builtin', name: '' }); }
  // 设置里的「预览」：全屏播一次，点画面结束
  async function preview() {
    const c = get(); let url = c.src === 'custom' ? await blobUrl() : BUILTIN;
    if (!url) url = BUILTIN;
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.playsInline = true; v.autoplay = true;
    v.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:9;cursor:pointer';
    const close = () => { try { v.pause(); } catch (e) { } v.remove(); };
    v.onclick = close; v.onended = close;
    document.body.appendChild(v);
    const q = v.play(); if (q && q.catch) q.catch(() => close());
    return true;
  }

  return { get, put, bootUrl, titleUrl, titleVideo, hideTitle, videoEl, setOn, setSource, setTitle, useFile, useBuiltin, loadBlob, preview };
})();
