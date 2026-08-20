import { fetchHtml, cleanText, decodeUrl } from "../net.js";

const SEARCH_URL = (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20`;

const REDIRECT_RE = /[?&]u=a1([^&"']+)/;

/** Resolve a Bing ck/a redirect URL back to the real target. */
function resolveBingUrl(url) {
  const m = String(url).match(REDIRECT_RE);
  if (m) {
    try {
      return decodeUrl(decodeUrl(m[1]));
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Crawl Bing search results.
 * @returns {Array<{title,url,displayUrl,snippet,engine}>}
 */
export async function crawlBing(query, { timeout = 20000 } = {}) {
  const { html } = await fetchHtml(SEARCH_URL(query), { timeout });
  const results = [];

  // Split the page into per-result <li class="b_algo"> blocks.
  const blocks = html.split(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>/i).slice(1);

  for (const block of blocks) {
    const anchor = block.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!anchor) continue;

    let url = decodeUrl(anchor[1]);
    url = resolveBingUrl(url);
    // Skip Bing-internal links.
    if (!/^https?:\/\//i.test(url)) continue;
    if (/^https?:\/\/(www\.)?(bing|microsoft)\.com\//i.test(url)) continue;

    const titleMatch = block.match(/<h2[^>]*>(.*?)<\/h2>/is);
    const title = titleMatch ? cleanText(titleMatch[1]) : "";

    const citeMatch = block.match(/<cite[^>]*>(.*?)<\/cite>/is);
    const displayUrl = citeMatch ? cleanText(citeMatch[1]) : "";

    let snippet = "";
    const pMatch = block.match(/<p[^>]*>(.*?)<\/p>/is);
    if (pMatch) snippet = cleanText(pMatch[1]);

    if (title || url) {
      results.push({ title, url, displayUrl, snippet, engine: "bing" });
    }
  }

  return results;
}
