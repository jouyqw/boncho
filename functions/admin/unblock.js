export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("X-Admin-Token") || "";
  const ip = url.searchParams.get("ip") || "";

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.CLICK_GUARD_KV) {
    return json({ error: "CLICK_GUARD_KV binding is not configured." }, 500);
  }

  if (!ip) {
    return json({ error: "ip is required." }, 400);
  }

  await env.CLICK_GUARD_KV.delete(`block:${ip}`);
  return json({ ok: true, unblocked: ip });
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
