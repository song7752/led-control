// Cloudflare Pages Function - 巴法云控制代理(乐观更新版)
const cacheStore = {};
const requestLog = [];

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

function addLog(entry) {
  requestLog.unshift({ ts: new Date().toISOString(), ...entry });
  if (requestLog.length > 10) requestLog.pop();
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === "/api/logs" && method === "GET") {
    return jsonResp({ logs: requestLog }, 200);
  }

  if (method === "GET") {
    return jsonResp({ ok: true, service: "bemfa-proxy", time: new Date().toISOString() }, 200);
  }

  if (method !== "POST") {
    return jsonResp({ code: -1, msg: "method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResp({ code: -1, msg: "bad json: " + e.message }, 400);
  }

  const { uid, topic, msg } = body;
  if (!uid || !topic || !msg) {
    return jsonResp({ code: -1, msg: "missing params (uid/topic/msg)" }, 400);
  }

  const cacheKey = `${uid}:${topic}:${msg}`;
  const now = Date.now();
  const cached = cacheStore[cacheKey] && (now - cacheStore[cacheKey] < 5000);

  // 无论是否缓存,都返回成功(乐观响应)
  // 但只在非缓存时才真发巴法云
  if (cached) {
    addLog({ type: "cache_skip", uid, topic, msg, note: "5s dedup, not resent" });
    return jsonResp({
      code: 0,
      msg: "OK (cached, not resent)",
      cached: true,
      real_sent: false,
    }, 200);
  }

  const apiUrl = "https://apis.bemfa.com/va/postJsonMsg";
  const payload = { uid, topic, type: 1, msg };

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const t0 = Date.now();
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    const ms = Date.now() - t0;

    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { data = { raw: text.substring(0, 200) }; }

    const ok = data.code === 0;
    if (ok) {
      // 只在成功时记录缓存
      cacheStore[cacheKey] = now;
    }

    addLog({
      type: "control",
      uid, topic, msg,
      http_status: resp.status,
      ms,
      bemfa_code: data.code,
      bemfa_msg: data.message,
      ok,
    });

    return jsonResp({
      code: ok ? 0 : (data.code ?? -1),
      msg: ok ? "OK" : (data.message || "failed"),
      cached: false,
      real_sent: true,
      http_status: resp.status,
      ms,
      detail: data,
    }, 200);
  } catch (e) {
    addLog({ type: "fetch_error", error: e.message, uid, topic, msg });
    return jsonResp({
      code: -1,
      msg: "fetch failed: " + e.message,
      stage: "cloudflare_to_bemfa",
      real_sent: false,
    }, 504);
  }
}