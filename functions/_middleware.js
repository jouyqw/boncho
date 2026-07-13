export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/admin/") || url.pathname === "/go") {
    return next();
  }

  if (isObviousScanner(request, url)) {
    return new Response("Blocked", { status: 403 });
  }

  if (!shouldInspectRequest(request, url)) {
    return next();
  }

  const ip = getClientIp(request);
  if (!ip || !env.CLICK_GUARD_KV) {
    return next();
  }

  const blocked = await env.CLICK_GUARD_KV.get(`block:${ip}`, "json");
  if (blocked) {
    return renderBlockedResponse(blocked);
  }

  if (shouldTrackAdVisit(request, url)) {
    const event = await buildVisitEvent(request, url);
    const decision = await judgeAndStoreVisit(env.CLICK_GUARD_KV, event);
    if (decision.blocked) {
      return renderBlockedResponse({ reason: decision.reasons.join(" / ") });
    }
  }

  return next();
}

const LIMITS = {
  minuteVisits: 5,
  hourVisits: 18,
  dayVisits: 45,
  minSecondsBetweenVisits: 4,
  blockTtlSeconds: 60 * 60 * 24 * 30,
  stateTtlSeconds: 60 * 60 * 24 * 8
};

function shouldInspectRequest(request, url) {
  if (request.method !== "GET") return false;
  const accept = request.headers.get("Accept") || "";
  const path = url.pathname.toLowerCase();
  if (path.startsWith("/assets/")) return false;
  if (/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|mp4|txt|xml|json)$/i.test(path)) return false;
  return accept.includes("text/html") || path === "/" || !path.includes(".");
}

function shouldTrackAdVisit(request, url) {
  const referrer = request.headers.get("Referer") || "";
  const source = url.searchParams.get("utm_source") || "";
  return /naver|google/i.test(`${source} ${referrer}`);
}

function isObviousScanner(request, url) {
  const ua = request.headers.get("User-Agent") || "";
  const path = url.pathname.toLowerCase();
  if (/wp-admin|wp-login|phpmyadmin|\.env|xmlrpc\.php/.test(path)) return true;
  if (/curl|l9scan|leakix|nikto|sqlmap|masscan|zgrab/i.test(ua)) return true;
  return false;
}

async function buildVisitEvent(request, url) {
  const ip = getClientIp(request);
  const ua = request.headers.get("User-Agent") || "";
  const referrer = request.headers.get("Referer") || "";
  const now = Date.now();

  return {
    ip,
    ua,
    uaHash: await sha256(`${ip}|${ua}`),
    referrer,
    source: url.searchParams.get("utm_source") || detectSource(referrer),
    medium: url.searchParams.get("utm_medium") || "",
    campaign: url.searchParams.get("utm_campaign") || "",
    keyword: url.searchParams.get("utm_term") || url.searchParams.get("n_keyword") || "",
    landing: url.pathname,
    country: request.cf?.country || "",
    asn: request.cf?.asn || "",
    colo: request.cf?.colo || "",
    at: new Date(now).toISOString(),
    ts: now
  };
}

async function judgeAndStoreVisit(kv, event) {
  const minuteBucket = Math.floor(event.ts / 60000);
  const hourBucket = Math.floor(event.ts / 3600000);
  const day = event.at.slice(0, 10).replaceAll("-", "");
  const stateKey = `state:ad:${event.ip}:${day}`;
  const previous = (await kv.get(stateKey, "json")) || {};

  const minuteCount = previous.minuteBucket === minuteBucket ? Number(previous.minuteCount || 0) + 1 : 1;
  const hourCount = previous.hourBucket === hourBucket ? Number(previous.hourCount || 0) + 1 : 1;
  const dayCount = Number(previous.dayCount || 0) + 1;

  const reasons = [];
  if (minuteCount >= LIMITS.minuteVisits) reasons.push(`1분 ${minuteCount}회 접속`);
  if (hourCount >= LIMITS.hourVisits) reasons.push(`1시간 ${hourCount}회 접속`);
  if (dayCount >= LIMITS.dayVisits) reasons.push(`하루 ${dayCount}회 접속`);
  if (previous.lastTs && event.ts - previous.lastTs < LIMITS.minSecondsBetweenVisits * 1000) {
    reasons.push(`${LIMITS.minSecondsBetweenVisits}초 이내 반복 접속`);
  }
  if (previous.lastUaHash === event.uaHash && previous.lastReferrer === event.referrer && minuteCount >= 3) {
    reasons.push("같은 기기/유입경로 반복 접속");
  }

  const state = {
    ip: event.ip,
    source: event.source,
    referrer: event.referrer,
    ua: event.ua,
    country: event.country,
    asn: event.asn,
    minuteBucket,
    minuteCount,
    hourBucket,
    hourCount,
    dayCount,
    lastTs: event.ts,
    lastAt: event.at,
    lastUaHash: event.uaHash,
    lastReferrer: event.referrer,
    reasons
  };

  await kv.put(stateKey, JSON.stringify(state), { expirationTtl: LIMITS.stateTtlSeconds });

  const shouldBlock =
    reasons.length >= 2 ||
    minuteCount >= LIMITS.minuteVisits + 2 ||
    hourCount >= LIMITS.hourVisits + 5 ||
    dayCount >= LIMITS.dayVisits + 10;

  if (shouldBlock) {
    const block = {
      ip: event.ip,
      reason: reasons.join(" / "),
      source: event.source,
      referrer: event.referrer,
      ua: event.ua,
      country: event.country,
      asn: event.asn,
      minuteCount,
      hourCount,
      dayCount,
      blockedAt: event.at
    };
    await kv.put(`block:${event.ip}`, JSON.stringify(block), {
      expirationTtl: LIMITS.blockTtlSeconds
    });
    await kv.put(`blocked-log:${event.at}:${event.ip}`, JSON.stringify(block), {
      expirationTtl: 60 * 60 * 24 * 90
    });
    return { blocked: true, reasons };
  }

  return { blocked: false, reasons };
}

function getClientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    ""
  );
}

function detectSource(referrer) {
  if (referrer.includes("naver.")) return "naver";
  if (referrer.includes("google.")) return "google";
  return "direct";
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function renderBlockedResponse(blocked) {
  return new Response(renderBlockedPage(blocked), {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
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
