import { cleanText } from "./net.js";

const STOPWORDS = new Set(
  ("a an the and or but if of to in on for with at by from as is are was were be been being " +
    "it its this that these those which who whom whose what how when where why do does did done " +
    "get gets got getting have has had having not no nor so such only also just can could will would shall should may might must vs about above what s t ve ll me my your").split(
    " "
  )
);

const TRUSTED_RE =
  /wikipedia|wiktionary|github|stackoverflow|gov\.cn|edu\.cn|nih\.gov|python\.org|npmjs|developer\.mozilla|microsoft\.com\/learn|apple\.com\/documentation|linux\.org|kernel\.org|arxiv\.org|pubmed|springer|nature\.com|elsevier|ieee\.org|acm\.org/i;

const SPAM_RE =
  /baijiahao|xueqiu|zhihu.*?column|\/deal|\/coupon|\/promo|click\?|redirect|reward|download-for|\badvertising\b|\bmyp2p\b/i;

const BAIDU_ADS_RE = /aria-label="(广告|推广)"|class="[^"]*\bad\b[^"]*"/i;

/** Hard-filter pages that are not useful as AI answer sources (galleries, videos, songs, captchas). */
const JUNK_RE =
  /(image\.baidu\.com|image-so\.com|wappass\.baidu\.com|\/captcha\/|\/security_verify|\/search\/index\?tn=baiduimage)|(douyin\.com\/video|kuaishou\.com\/|iesdouyin)|(music\.163\.com\/song|y\.qq\.com\/n\/ryqq\/song|kugou\.com\/song|kuwo\.cn)/i;

function isJunk(r) {
  const hay = `${r.url} ${r.title}`;
  return JUNK_RE.test(hay);
}

/** Split a query into searchable tokens (handles both English words and Chinese). */
export function tokenize(query = "") {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const tokens = new Set();

  // ASCII words
  for (const w of q.match(/[a-z0-9][a-z0-9-]{1,}/gi) || []) {
    if (!STOPWORDS.has(w)) tokens.add(w.toLowerCase());
  }

  // Chinese chars + bigrams (characters between ASCII blocks / punctuation)
  const cjk = q.replace(/[a-z0-9\s\-_.,!?()"'<>;:/\\\[\]{}@#$%^&*+=~`|]/gi, "").trim();
  if (cjk.length >= 1) {
    for (const ch of cjk) tokens.add(ch);
    if (cjk.length >= 2) {
      for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk.slice(i, i + 2));
    }
  }

  return [...tokens];
}

function countMatches(text, tokens) {
  if (!text) return 0;
  const t = text.toLowerCase();
  let n = 0;
  for (const tok of tokens) {
    if (t.includes(tok)) n++;
  }
  return n;
}

/** Cross-engine consensus: group results sharing the same normalized origin+path. */
function buildConsensus(results) {
  const keyof = (url) => {
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
  };
  const domainof = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  const byKey = new Map();
  const enginesByDomain = new Map();
  for (let i = 0; i < results.length; i++) {
    const key = keyof(results[i].url);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(i);

    const dom = domainof(results[i].url);
    if (dom) {
      if (!enginesByDomain.has(dom)) enginesByDomain.set(dom, new Set());
      enginesByDomain.get(dom).add(results[i].engine);
    }
  }
  return { byKey, enginesByDomain };
}

function isChinese(query) {
  return /[\u4e00-\u9fff]/.test(query);
}

/**
 * Rank merged results by *correctness*.
 *
 * Scoring model (0-100):
 *   relevance  — how well the result covers the query terms (title/url/snippet)
 *   consensus  — a page that both Bing AND Baidu agree on is very likely correct
 *   trusted    — known-authoritative sources get a boost
 *   position   — search engines rank good results first
 *   spam       — ad / junk penalized
 *
 * @param {Array<{title,url,snippet,engine}>} results merged from engines
 * @param {string} query
 * @returns {Array<object>} results sorted by score desc with a `score` field
 */
export function rankResults(results, query) {
  const tokens = tokenize(query);
  const filtered = results.filter((r) => !isJunk(r));
  const { byKey, enginesByDomain } = buildConsensus(filtered);
  const cjk = isChinese(query);

  const domainOf = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };

  const scored = filtered.map((r, idx) => {
    const title = r.title || "";
    const url = r.url || "";
    const snippet = r.snippet || "";

    const titleMatch = countMatches(title, tokens);
    const urlMatch = countMatches(url, tokens);
    const snippetMatch = countMatches(snippet, tokens);

    const denom = Math.max(1, tokens.length);
    let relevance =
      (titleMatch * 3 + urlMatch * 1.2 + snippetMatch * 1) / denom;

    if (cjk) relevance *= 1.15;

    // Exact-URL consensus: both engines returned the identical page.
    const group = byKey.get(normKey(url)) || [];
    const groupSize = group.length;
    const groupEngines = group.length > 1 ? ["bing", "baidu"] : [r.engine];
    const consensusBoost = group.length > 1 ? 12 : 0;

    // Domain-level consensus: the site is returned by both engines.
    const dom = domainOf(url);
    const domEngines = enginesByDomain.get(dom);
    const domainBoth = domEngines && domEngines.size > 1;
    const domainBoost = domainBoth ? 7 : 0;

    const trustedBoost = TRUSTED_RE.test(url) ? 8 : 0;

    // A result whose own title is a question is usually not a definitive answer.
    let questionPenalty = 0;
    const qTitle =
      /[?？]|是谁(\?|？|\s|$)|是什么(\?|？|\s|$)|为什么(\?|？|\s|$)|怎么办(\?|？|\s|$)|\bhow(\b|\?)|what(\b|\?)|why(\b|\?)/i.test(title);
    if (qTitle) questionPenalty += 6;

    let spamPenalty = 0;
    if (SPAM_RE.test(url) || SPAM_RE.test(title)) spamPenalty += 10;
    if (BAIDU_ADS_RE.test(title + snippet)) spamPenalty += 14;

    const position = Math.max(0, (20 - idx) * 0.4);

    let score = Math.round(relevance * 12 + consensusBoost + domainBoost + trustedBoost + position - spamPenalty - questionPenalty);
    score = Math.max(0, Math.min(99, score));

    return {
      ...r,
      score,
      groupSize,
      groupEngines: [...new Set(groupEngines)],
      engines: [r.engine],
      domainConsensus: domainBoth,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored;
}

/** Normalized full-URL key for exact-consensus grouping. */
function normKey(url) {
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

/**
 * Produce an LLM-friendly summary: pick the single most-correct answer and
 * synthesize a concise grounded answer string.
 */
export function buildSummary(ranked, query) {
  if (!ranked.length) {
    return {
      answer: `未能从 Bing 或百度检索到与“${query}”相关的有效结果。`,
      best: null,
      confidence: 0,
    };
  }

  const best = ranked[0];
  const confidence = Math.min(99, Math.round(best.score + best.groupSize * 4));

  const sources = ranked
    .slice(0, 5)
    .map((r, i) => `${i + 1}. [${r.title || "无标题"}](${r.url})`)
    .join("\n");

  const answer =
    `根据检索结果，与“${query}”最相关的答案是：` +
    `${best.title || "未命名页面"}（${best.url}）。\n` +
    `摘要：${best.snippet || "（无摘要）"}\n\n来源（按相关度排序）：\n${sources}`;

  return { answer, best, confidence };
}
