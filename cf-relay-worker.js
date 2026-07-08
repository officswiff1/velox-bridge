// cf-relay-worker.js
// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker: authenticated "dumb byte pipe".
//
// Purpose: move large media (reference images, video frames, motion-control
// videos) from a SOURCE URL straight into Magnific's signed GCS upload URL, so
// the bytes flow Cloudflare ↔ internet (free unmetered egress) and NEVER transit
// the Render server. This keeps Render's 5 GB/month bandwidth near-zero.
//
// The origin server (server.js) still owns all Magnific auth/session logic:
//   1. server.js calls Magnific temporal-upload-url  → gets signed GCS `upload_url`
//   2. server.js calls THIS worker { from: sourceUrl, to: upload_url }  ← tiny JSON
//   3. worker fetches sourceUrl and streams it into PUT upload_url        ← big bytes
//   4. server.js calls Magnific verify → continues generation
//
// Safety:
//   • Requires a shared secret header (x-relay-key) — not an open proxy.
//   • Only allows uploads TO trusted GCS/Magnific hosts (SSRF guard).
//   • Streams with Content-Length when the source provides it (big videos OK,
//     no full-file buffering); buffers only as a fallback for length-less sources.
//
// Deploy:  wrangler deploy   (or paste into a new Worker in the Cloudflare dash)
// Set secret:  wrangler secret put RELAY_SECRET
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_UPLOAD_HOSTS = [
  "storage.googleapis.com",   // Magnific temporal uploads are signed GCS URLs
  "googleapis.com",
];

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      // lightweight health check (no secret needed) — returns 200 for uptime pings
      return json({ ok: true, service: "cf-relay-worker" });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // ── Auth: shared secret ──
    const key = request.headers.get("x-relay-key");
    if (!env.RELAY_SECRET || key !== env.RELAY_SECRET) {
      return json({ error: "unauthorized" }, 401);
    }

    // ── Parse ──
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
    const { from, to, contentType } = body || {};
    if (!from || !to) return json({ error: "'from' and 'to' are required" }, 400);

    // ── SSRF guard: only upload TO trusted GCS hosts ──
    let toHost;
    try { toHost = new URL(to).hostname; } catch { return json({ error: "invalid 'to' url" }, 400); }
    const hostOk = ALLOWED_UPLOAD_HOSTS.some(h => toHost === h || toHost.endsWith("." + h));
    if (!hostOk) return json({ error: `upload host not allowed: ${toHost}` }, 403);

    // ── Fetch the source (bytes enter the Worker, not the origin) ──
    let src;
    try {
      src = await fetch(from, { headers: { "user-agent": "Mozilla/5.0" } });
    } catch (e) {
      return json({ error: `source fetch error: ${String(e).slice(0, 150)}` }, 502);
    }
    if (!src.ok) return json({ error: `source fetch failed: HTTP ${src.status}` }, 502);

    const ct  = contentType || (src.headers.get("content-type") || "application/octet-stream").split(";")[0].trim();
    const len = src.headers.get("content-length");

    // ── Stream into the signed PUT ──
    const putHeaders = { "content-type": ct };
    let putBody;
    if (len) {
      // Known length → stream through without buffering (big videos safe)
      putHeaders["content-length"] = len;
      putBody = src.body;
    } else {
      // No Content-Length (chunked source) → buffer as fallback.
      // Guard memory: refuse absurdly large length-less bodies.
      const ab = await src.arrayBuffer();
      if (ab.byteLength > 100 * 1024 * 1024) {
        return json({ error: "source too large without content-length (>100MB)" }, 413);
      }
      putBody = ab;
    }

    let put;
    try {
      put = await fetch(to, { method: "PUT", headers: putHeaders, body: putBody });
    } catch (e) {
      return json({ error: `upload PUT error: ${String(e).slice(0, 150)}` }, 502);
    }
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      return json({ error: `upload PUT failed: HTTP ${put.status}`, detail: t.slice(0, 200) }, 502);
    }

    return json({ ok: true, contentType: ct, bytes: len ? Number(len) : undefined });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
