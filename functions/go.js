const TARGETS = {
  home: "https://bonchojw.com/",
  product: "https://naver.me/xquUFjXU"
};

const LIMITS = {
  minuteClicks: 4,
  hourClicks: 12,
  dayClicks: 30,
  minSecondsBetweenClicks: 5,
  blockTtlSeconds: 60 * 60 * 24 * 30
};

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const targetName = url.searchParams.get("to") || "home";
  const targetUrl = TARGETS[targetName] || TARGETS.home;

  const event = await buildClickEvent(request, url, targetName);
  let decision = { blocked: false, reasons: [] };

  if (env.CLICK_GUARD_KV) {
    decision = await judgeAndStoreClick(env.CLICK_GUARD_KV, event);
  }

  if (decision.blocked) {
    return new Response("Blocked by click guard", {
      status: 403,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }

  return Response.redirect(targetUrl, 302);
}

async function buildClickEvent(request, url, targetName) {
  const ip = getClientIp(request);
  const ua = request.headers.get("User-Agent") || "";
  const referrer = request.headers.get("Referer") || "";
  const now = Date.now();

  return {
    ip,
    ua,
    uaHash: await sha256(`${ip}|${ua}`),
    referrer,
    targetName,
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

async function judgeAndStoreClick(kv, event) {
  if (!event.ip) {
    return { blocked: false, reasons: [] };
  }

  const now = event.ts;
  const minuteBucket = Math.floor(now / 60000);
  const hourBucket = Math.floor(now / 3600000);
  const day = event.at.slice(0, 10).replaceAll("-", "");

  const minuteCount = await increment(kv, `count:minute:${event.ip}:${minuteBucket}`, 3600);
  const hourCount = await increment(kv, `count:hour:${event.ip}:${hourBucket}`, 60 * 60 * 26);
  const dayCount = await increment(kv, `count:day:${event.ip}:${day}`, 60 * 60 * 24 * 8);

  const lastKey = `last:${event.ip}`;
  const last = await kv.get(lastKey, "json");
  await kv.put(lastKey, JSON.stringify(event), { expirationTtl: 60 * 60 * 24 * 8 });

  const reasons = [];
  if (minuteCount >= LIMITS.minuteClicks) reasons.push(`1분 ${minuteCount}회 클릭`);
  if (hourCount >= LIMITS.hourClicks) reasons.push(`1시간 ${hourCount}회 클릭`);
  if (dayCount >= LIMITS.dayClicks) reasons.push(`하루 ${dayCount}회 클릭`);
  if (last && now - last.ts < LIMITS.minSecondsBetweenClicks * 1000) {
    reasons.push(`${LIMITS.minSecondsBetweenClicks}초 이내 반복 클릭`);
  }
  if (last && last.uaHash === event.uaHash && last.referrer === event.referrer && minuteCount >= 2) {
    reasons.push("같은 기기/유입경로 반복");
  }

  await kv.put(
    `event:${event.at}:${event.ip}:${event.uaHash.slice(0, 10)}`,
    JSON.stringify({ ...event, minuteCount, hourCount, dayCount, reasons }),
    { expirationTtl: 60 * 60 * 24 * 14 }
  );

  const shouldBlock =
    reasons.length >= 2 ||
    minuteCount >= LIMITS.minuteClicks + 2 ||
    hourCount >= LIMITS.hourClicks + 4 ||
    dayCount >= LIMITS.dayClicks + 10;

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

async function increment(kv, key, ttl) {
  const current = Number((await kv.get(key)) || "0");
  const next = current + 1;
  await kv.put(key, String(next), { expirationTtl: ttl });
  return next;
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
