'use strict';
// Netlify Functions entry point. All /api/*.php routes are rewritten here.
const { getStore, connectLambda } = require('@netlify/blobs');
const { createApi } = require('../lib/backend');

let api = null;
function backend() {
  if (!api) {
    const store = getStore({ name: 'opusmc', consistency: 'strong' });
    api = createApi({ store });
  }
  return api;
}

exports.handler = async (event, context) => {
  try {
    // Netlify can run Functions in Lambda compatibility mode, where the Blobs
    // environment is not injected into process.env automatically.
    if (typeof connectLambda === 'function') connectLambda(event);
    return await backend().handle(event, context);
  } catch (e) {
    console.error('opusmc api error', e);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ error: '后端内部错误：' + (e && e.message ? e.message : 'unknown') }),
    };
  }
};
