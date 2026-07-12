export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/admin/")) {
    return next();
  }

  const ip = getClientIp(request);
  if (!ip || !env.CLICK_GUARD_KV) {
    return next();
  }

  const blocked = await env.CLICK_GUARD_KV.get(`block:${ip}`, "json");
  if (!blocked) {
    return next();
  }

  return new Response(renderBlockedPage(blocked), {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    ""
  );
}

function renderBlockedPage(blocked) {
  const reason = escapeHtml(blocked.reason || "abnormal traffic");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>접속이 제한되었습니다</title>
  <style>
    body{margin:0;font-family:Arial,"Noto Sans KR",sans-serif;background:#f5f6f7;color:#222}
    main{max-width:520px;margin:15vh auto;padding:32px;background:#fff;border:1px solid #e1e4e8}
    h1{font-size:22px;margin:0 0 12px}
    p{line-height:1.7;color:#555}
    small{color:#888}
  </style>
</head>
<body>
  <main>
    <h1>접속이 일시적으로 제한되었습니다.</h1>
    <p>짧은 시간 안에 반복 접속이 확인되어 자동 보호가 적용되었습니다.</p>
    <small>${reason}</small>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
