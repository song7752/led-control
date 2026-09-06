// Cloudflare Pages Function - 巴法云控制代理
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

export async function onRequestPost({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ code: -1, msg: 'bad json' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const { uid, topic, msg } = body;
  if (!uid || !topic || !msg) {
    return new Response(JSON.stringify({ code: -1, msg: 'missing params' }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  // 5 秒去重(避开巴法云 30 秒冷却)
  const cacheKey = `${uid}:${topic}:${msg}`;
  const now = Date.now();
  if (cacheStore[cacheKey] && now - cacheStore[cacheKey] < 5000) {
    return new Response(JSON.stringify({ code: 0, msg: 'cached', cached: true }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }

  const bemfaUrl = `https://apis.bemfa.com/v1/control?uid=${encodeURIComponent(uid)}&topic=${encodeURIComponent(topic)}&type=1&msg=${encodeURIComponent(msg)}`;

  try {
    const resp = await fetchWithTimeout(bemfaUrl, {}, 6000);
    const data = await resp.json().catch(() => ({ code: -1, msg: 'parse error' }));
    cacheStore[cacheKey] = now;
    return new Response(JSON.stringify({
      code: data.code ?? 0,
      msg: data.msg ?? 'OK',
      bemfa: data,
    }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ code: -1, msg: 'timeout: ' + e.message }), {
      status: 504, headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    });
  }
}

export async function onRequestGet({ request }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  return new Response(JSON.stringify({ ok: true, service: 'bemfa-proxy' }), {
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}
