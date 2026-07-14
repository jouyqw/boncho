export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("X-Admin-Token") || "";

  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!env.CLICK_GUARD_KV) {
    return json({ error: "CLICK_GUARD_KV binding is not configured." }, 500);
  }

  const format = url.searchParams.get("format") || "json";
  const list = await env.CLICK_GUARD_KV.list({ prefix: "state:ad:" });
  const rows = [];

  for (const key of list.keys) {
    const item = await env.CLICK_GUARD_KV.get(key.name, "json");
    if (item) {
      rows.push({
        ip: item.ip,
        source: item.source,
        referrer: item.referrer,
        country: item.country,
        asn: item.asn,
        minuteCount: item.minuteCount,
        hourCount: item.hourCount,
        dayCount: item.dayCount,
        lastAt: item.lastAt,
        reason: Array.isArray(item.reasons) ? item.reasons.join(" / ") : "",
        ua: item.ua
      });
    }
  }

  rows.sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || "")));

  if (format === "csv") {
    const csv = [
      "ip,lastAt,source,country,asn,minuteCount,hourCount,dayCount,reason,referrer",
      ...rows.map((row) =>
        [
          row.ip,
          row.lastAt,
          row.source,
          row.country,
          row.asn,
          row.minuteCount,
          row.hourCount,
          row.dayCount,
          row.reason,
          row.referrer
        ]
          .map(csvCell)
          .join(",")
      )
    ].join("\n");

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=suspect-ad-ips.csv",
        "cache-control": "no-store"
      }
    });
  }

  return json({ count: rows.length, rows });
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

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
