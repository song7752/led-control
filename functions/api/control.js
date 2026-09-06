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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (method === "GET") {
    return jsonResp({ ok: true, service: "bemfa-proxy" }, 200);
  }

  if (method !== "POST") {
    return jsonResp({ code: -1, msg: "method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResp({ code: -1, msg: "bad json" }, 400);
  }

  const { uid, topic, msg } = body;
  if (!uid || !topic || !msg) {
    return jsonResp({ code: -1, msg: "missing params" }, 400);
  }

  const cacheKey = `${uid}:${topic}:${msg}`;
  const now = Date.now();
  if (cacheStore[cacheKey] && now - cacheStore[cacheKey] < 5000) {
    return jsonResp({ code: 0, msg: "cached", cached: true }, 200);
  }

  const bemfaUrl = `https://apis.bemfa.com/v1/control?uid=${encodeURIComponent(uid)}&topic=${encodeURIComponent(topic)}&type=1&msg=${encodeURIComponent(msg)}`;

  try {
    const resp = await fetchWithTimeout(bemfaUrl, {}, 6000);
    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* parse error but still treat as success */ }
    cacheStore[cacheKey] = now;
    // 巴法云返回 code:0 或 200 都视为成功
    const ok = data.code === 0 || data.code === 200 || resp.status === 200;
    return jsonResp({
      code: ok ? 0 : (data.code ?? -1),
      msg: ok ? "OK" : (data.msg || "parse error"),
      cached: false,
    }, 200);
  } catch (e) {
    return jsonResp({ code: -1, msg: "timeout: " + e.message }, 504);
  }
}