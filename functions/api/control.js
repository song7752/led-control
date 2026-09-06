// Cloudflare Pages Function - 巴法云控制代理
// 正确 API: POST https://apis.bemfa.com/va/postJsonMsg
const cacheStore = {};

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

  // 5 秒去重
  const cacheKey = `${uid}:${topic}:${msg}`;
  const now = Date.now();
  if (cacheStore[cacheKey] && now - cacheStore[cacheKey] < 5000) {
    return jsonResp({ code: 0, msg: "cached", cached: true }, 200);
  }

  // 正确 API: POST https://apis.bemfa.com/va/postJsonMsg
  const apiUrl = "https://apis.bemfa.com/va/postJsonMsg";
  const payload = { uid, topic, type: 1, msg };

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(tid);

    const data = await resp.json().catch(() => ({ code: -1, message: "parse error" }));
    cacheStore[cacheKey] = now;

    return jsonResp({
      code: data.code ?? -1,
      msg: data.message ?? "OK",
      cached: false,
      raw: data,
    }, 200);
  } catch (e) {
    return jsonResp({ code: -1, msg: "timeout: " + e.message }, 504);
  }
}