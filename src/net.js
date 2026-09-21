const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Connection": "keep-alive",
};

/**
 * Warm up a domain so it sets session cookies before the real request.
 */
export async function primeSession(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, redirect: "follow", signal: controller.signal });
    storeCookies(res, url);
  } catch {
    /* best-effort */
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal cookie jar keyed by hostname (set-cookie passthrough). */
const cookieJar = new Map();

function storeCookies(res, url) {
  try {
    const host = new URL(url).hostname;
    // headers.getSetCookie() is Node 18+; fall back to raw header string for older versions.
    let setCookies = [];
    if (res.headers.getSetCookie) {
      setCookies = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get("set-cookie");
      if (raw) setCookies = Array.isArray(raw) ? raw : [raw];
    }
    if (!setCookies.length) return;
    const jar = cookieJar.get(host) || new Map();
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim();
      const val = pair.slice(eq + 1).trim();
      jar.set(key, val);
    }
    cookieJar.set(host, jar);
  } catch {}
}

function jarHeader(url) {
  try {
    const host = new URL(url).hostname;
    const jar = cookieJar.get(host);
    if (!jar || jar.size === 0) return "";
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  } catch {
    return "";
  }
}

export async function fetchHtml(url, { timeout = 20000, redirect = "follow", extraHeaders = {}, retries = 1 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const cookie = jarHeader(url);
    try {
      const res = await fetch(url, {
        headers: {
          ...DEFAULT_HEADERS,
          ...(cookie ? { Cookie: cookie } : {}),
          ...extraHeaders,
        },
        redirect,
        signal: controller.signal,
      });
      storeCookies(res, url);
      const html = await res.text();
      clearTimeout(timer);
      return {
        status: res.status,
        html,
        finalUrl: res.url || url,
        headers: Object.fromEntries(res.headers.entries()),
      };
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  throw lastError;
}

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  middot: "·", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019",
  hellip: "…", mdash: "—", ndash: "–", times: "×", copy: "©", reg: "®",
};

/** Strip HTML tags, decode common entities, collapse whitespace. */
export function cleanText(input = "") {
  if (!input) return "";
  return input
    .replace(/<[^>]*>/g, " ")
    // Separate regex for hex (&#xHEX;) vs decimal (&#NNN;) avoids the 'x' being
    // included in the capture group and causing parseInt("x4E2D",16)->NaN.
    .replace(/&#x([0-9a-fA-F]+);|&#[xX]?(\d+);/g, (m, hex, dec) => {
      try {
        return String.fromCodePoint(parseInt(hex ?? dec, hex !== undefined ? 16 : 10));
      } catch {
        return "";
      }
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** Decode a URL-encoded string. */
export function decodeUrl(s = "") {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Normalized URL key for exact-consensus grouping (exported for rank.js reuse). */
export function normUrlKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const keys = [...u.searchParams.keys()]
      .sort()
      .slice(0, 3)
      .map((k) => `${k}=${u.searchParams.get(k) || ""}`);
    return `${host}${path}?${keys.join("&")}`;
  } catch {
    return url;
  }
}
