// Cloudflare Pages Function - 巴法云控制代理
// 用 onRequest catch-all 处理所有 HTTP 方法

const cacheStore = {};

async function fetchWithTimeout(url, options = {}, timeout = 6000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();

  // OPTIONS 跨域预检
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 健康检查
  if (method === 'GET') {
    return jsonResp({ ok: true, service: 'bemfa-proxy' }, 200);
  }

  if (method !== 'POST') {
    return jsonResp({ code: -1, msg: 'method not allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ code: -1, msg: 'bad json' }, 400);
  }

  const { uid, topic, msg } = body;
  if (!uid || !topic || !msg) {
    return jsonResp({ code: -1, msg: 'missing params' }, 400);
  }

  // 5 秒去重(避开巴法云 30 秒冷却)
  const cacheKey = `${uid}:${topic}:${msg}`;
  const now = Date.now();
  if (cacheStore[cacheKey] && now - cacheStore[cacheKey] < 5000) {
    return jsonResp({ code: 0, msg: 'cached', cached: true }, 200);
  }

  const bemfaUrl = `https://apis.bemfa.com/v1/control?uid=${encodeURIComponent(uid)}&topic=${encodeURIComponent(topic)}&type=1&msg=${encodeURIComponent(msg)}`;

  try {
    const resp = await fetchWithTimeout(bemfaUrl, {}, 6000);
    const data = await resp.json().catch(() => ({ code: -1, msg: 'parse error' }));
    cacheStore[cacheKey] = now;
    return jsonResp({
      code: data.code ?? 0,
      msg: data.msg ?? 'OK',
      bemfa: data,
    }, 200);
  } catch (e) {
    return jsonResp({ code: -1, msg: 'timeout: ' + e.message }, 504);
  }
}
