import { fetchHtml, cleanText, decodeUrl, primeSession } from "../net.js";

const REDIRECT_RE = /^https?:\/\/(www\.)?baidu\.com\/link\?/i;

/** Simple in-memory cache: baidu redirect URL -> final URL. */
const redirectCache = new Map();

/**
 * Resolve a baidu.com/link redirect to the real destination URL.
 * Cached + limited to avoid hammering; falls back to the original link.
 */
async function resolveRedirect(linkUrl, concurrency) {
  if (redirectCache.has(linkUrl)) return redirectCache.get(linkUrl);
  if (concurrency.current >= concurrency.limit) return linkUrl;

  concurrency.current++;
  try {
    const { finalUrl } = await fetchHtml(linkUrl, {
      timeout: 6000,
      redirect: "follow",
      extraHeaders: { Referer: "https://www.baidu.com/" },
    });
    const final =
      finalUrl && finalUrl !== linkUrl && REDIRECT_RE.test(linkUrl) ? finalUrl : linkUrl;
    redirectCache.set(linkUrl, final);
    return final;
  } catch {
    redirectCache.set(linkUrl, linkUrl);
    return linkUrl;
  } finally {
    concurrency.current--;
  }
}

/** True when the page is Baidu's anti-bot captcha wall. */
function isCaptcha(html, finalUrl = "") {
  return (
    /百度安全验证|安全验证|wappass|tuxing/.test(html.slice(0, 5000)) ||
    /wappass\.baidu\.com\/static\/captcha/.test(finalUrl)
  );
}

/**
 * Crawl Baidu search results, resolving baidu.com/link redirects to real URLs.
 * Primes a session cookie first and retries on Baidu's flaky anti-bot wall.
 * @returns {Promise<Array<{title,url,displayUrl,snippet,engine}>>}
 */
export async function crawlBaidu(query, { timeout = 20000, retries = 2 } = {}) {
  // First hit the homepage to obtain a BAIDUID session cookie.
  await primeSession("https://www.baidu.com");

  let html = "";
  let finalUrl = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const base = attempt % 2 === 0 ? "https://www.baidu.com/s" : "https://m.baidu.com/s";
    const response = await fetchHtml(`${base}?wd=${encodeURIComponent(query)}&rn=20&ie=utf-8`, { timeout });
    html = response.html;
    finalUrl = response.finalUrl;
    if (!isCaptcha(html, finalUrl)) break;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  if (isCaptcha(html, finalUrl)) return [];

  const leftIdx = html.indexOf(`id="content_left"`);
  const body = leftIdx >= 0 ? html.slice(leftIdx) : html;
  const blocks = body.split(/<div[^>]*class="result[^"]*"[^>]*>/i).slice(1);

  const raw = [];

  for (const block of blocks) {
    const anchor = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!anchor) continue;
    const rawUrl = decodeUrl(anchor[1].trim());
    if (!/^https?:\/\//i.test(rawUrl)) continue;

    const titleMatch = block.match(/<h3[^>]*>[\s\S]*?<\/h3>/i);
    const title = titleMatch ? cleanText(titleMatch[0]) : "";

    let snippet = "";
    let m = block.match(/class="[^"]*\bc-abstract\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!m) m = block.match(/class="[^"]*\bcontent-right_[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!m) {
      const sp = block.match(/class="[^"]*sc-paragraph[^"]*"[^>]*>([\s\S]{15,}?)<\/span>/);
      if (sp) m = sp;
    }
    if (m) snippet = cleanText(m[1]);

    raw.push({ title, rawUrl, snippet });
  }

  // Deduplicate by link + resolve redirects (bounded concurrency).
  const concurrency = { current: 0, limit: 6 };
  const seen = new Set();
  const results = [];

  for (const r of raw) {
    if (!r.title && !r.rawUrl) continue;
    if (REDIRECT_RE.test(r.rawUrl)) {
      const url = await resolveRedirect(r.rawUrl, concurrency);
      if (url === r.rawUrl) continue; // unresolvable baidu link -> skip
      if (seen.has(url)) continue;
      seen.add(url);
      const displayUrl = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 40);
      results.push({ title: r.title, url, displayUrl, snippet: r.snippet, engine: "baidu" });
    } else {
      const url = r.rawUrl;
      if (/^https?:\/\/(www\.)?baidu\.com\//i.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      const displayUrl = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 40);
      results.push({ title: r.title, url, displayUrl, snippet: r.snippet, engine: "baidu" });
    }
  }

  return results;
}