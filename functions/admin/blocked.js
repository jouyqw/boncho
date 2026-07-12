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
  const list = await env.CLICK_GUARD_KV.list({ prefix: "block:" });
  const rows = [];

  for (const key of list.keys) {
    const item = await env.CLICK_GUARD_KV.get(key.name, "json");
    if (item) rows.push(item);
  }

  rows.sort((a, b) => String(b.blockedAt || "").localeCompare(String(a.blockedAt || "")));

  if (format === "csv") {
    const csv = [
      "ip,blockedAt,reason,source,country,asn,minuteCount,hourCount,dayCount",
      ...rows.map((row) =>
        [
          row.ip,
          row.blockedAt,
          row.reason,
          row.source,
          row.country,
          row.asn,
          row.minuteCount,
          row.hourCount,
          row.dayCount
        ]
          .map(csvCell)
          .join(",")
      )
    ].join("\n");

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=blocked-ips.csv",
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
