'use strict';
// ---------------------------------------------------------------------------
// Chunk mesh worker.
// The page used to load this file expecting decoration + lighting + meshing;
// it did not exist, so every device silently fell back to meshing on the main
// thread. This file implements the mesh half for real: the page gathers a
// section's padded arrays and this worker builds the GPU buffers. Chunk
// decoration/finalisation still runs on the page (the worker also has no game
// state), but the expensive per-section meshing is now off the UI thread.
// ---------------------------------------------------------------------------
self.window = self; // assets.js assigns window.ASSETS
importScripts('util.js', 'assets.js', 'blockdata.js', 'itemdata.js', 'blocks.js', 'experimental263.js', 'world.js', 'models.js', 'mesher.js', 'vmodels.js');

initAnimTable();
postMessage({ type: 'ready', meshOnly: true });

self.onmessage = (e) => {
  const m = e.data;
  if (!m) return;
  try {
    if (m.type === 'opts') { setFastLeaves(!!m.fastLeaves); return; }
    if (m.type === 'ping') { postMessage({ type: 'pong' }); return; }
    if (m.type === 'reset') { return; } // no world state needed for meshing
    if (m.type === 'mesh') {
      const M = self.Mesher || Mesher;
      M.load(m);
      const r = M.buildGathered(m.cx, m.sy, m.cz);
      const tr = [];
      if (r.opaque) tr.push(r.opaque.buffer);
      if (r.trans) tr.push(r.trans.buffer);
      postMessage({ type: 'mesh', id: m.id, opaque: r.opaque, trans: r.trans, nOpaque: r.nOpaque, nTrans: r.nTrans, vis: r.vis }, tr);
    }
  } catch (err) {
    postMessage({ type: 'mesh', id: m.id, error: String(err && err.stack || err) });
    postMessage({ type: 'error', where: 'mesh', msg: String(err && err.message || err), stack: String(err && err.stack || '') });
  }
};
