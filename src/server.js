import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { search } from "./search.js";
import { aiEnabled } from "./ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const INDEX_HTML = existsSync(path.join(PUBLIC_DIR, "index.html"))
  ? readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8")
  : null;

const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || "0.0.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

// Basic in-memory rate limiter: 20 search requests per minute per IP
const rateMap = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW_MS;
  }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...SECURITY_HEADERS,
    ...CORS,
  });
  res.end(body);
}

/** Minimal LLM-friendly payload — avoid junk, keep it tight. */
function compactPayload(full) {
  return {
    query: full.query,
    variants: full.variants,
    answer: full.summary.answer,
    confidence: full.summary.confidence,
    ai_verified: full.ai_verified,
    top: full.results.slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      score: r.score,
      engines: r.domainConsensus ? ["bing", "baidu"] : r.groupEngines || r.engines || [r.engine],
    })),
    meta: full.meta,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (u.pathname === "/health" || u.pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok", provider: "Vexify", ai: aiEnabled() });
  }

  if (u.pathname === "/" || u.pathname === "/index.html") {
    if (INDEX_HTML) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(INDEX_HTML);
    }
    return sendJson(res, 200, { message: "search-neo API — use /search?q=...", provider: "Vexify" });
  }

  const isSearch = u.pathname === "/search" || u.pathname === "/api/search";
  if (isSearch) {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    if (!checkRateLimit(ip)) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", ...CORS });
      return res.end(JSON.stringify({ error: "Too many requests. Try again in a minute." }));
    }
    const q = (u.searchParams.get("q") || "").trim();
    if (!q) return sendJson(res, 400, { error: "Missing required query param: q" });

    try {
      const ai = u.searchParams.get("ai") !== "0";
      const full = await search(q, { ai });
      if (u.searchParams.get("compact") === "1" || u.searchParams.get("format") === "compact") {
        return sendJson(res, 200, compactPayload(full));
      }
      return sendJson(res, 200, full);
    } catch (err) {
      return sendJson(res, 500, { error: String(err?.message || err) });
    }
  }

  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Not found. Try /search?q=<query>" }));
});

server.listen(PORT, HOST, () => {
  console.log(`search-neo — Powered By Vexify`);
  console.log(`API   : http://${HOST}:${PORT}/search?q=<query>`);
  console.log(`UI    : http://${HOST}:${PORT}/`);
  console.log(`AI    : ${aiEnabled() ? "enabled" : "disabled (heuristic ranking active)"}`);
});