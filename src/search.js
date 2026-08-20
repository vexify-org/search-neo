import { crawlBing } from "./engines/bing.js";
import { crawlBaidu } from "./engines/baidu.js";
import { rankResults, buildSummary } from "./rank.js";
import { aiJudge } from "./ai.js";
import { refineQuery, mergeBatches } from "./query.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function crawlOne(engine, query) {
  try {
    const results =
      engine === "bing" ? await crawlBing(query) : await crawlBaidu(query);
    return { engine, query, results };
  } catch (e) {
    return { engine, query, results: [], error: String(e?.message || e) };
  }
}

async function withTimeout(promise, ms, label) {
  const t = setTimeout(() => Promise.reject(new Error(`${label} timeout`)), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Run a full search: refine the query, crawl Bing + Baidu across refined
 * variants, merge, rank for correctness, optionally verify with an LLM judge.
 *
 * @param {string} query
 * @param {object} opts { ai: boolean, variants: number }
 */
export async function search(query, opts = {}) {
  const started = Date.now();
  const variants = refineQuery(query).slice(0, opts.variants ?? 2);

  // Crawl the first variant on both engines in parallel, then stagger the rest
  // to keep under Baidu's rate limiter.
  const batches = [];
  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    if (i > 0) await sleep(300 * i);
    const runs = await Promise.allSettled([
      withTimeout(crawlOne("bing", v), 25000, "bing"),
      withTimeout(crawlOne("baidu", v), 45000, "baidu"),
    ]);
    for (const r of runs) if (r.status === "fulfilled") batches.push(r.value);
  }

  const errors = batches.flatMap((b) => (b.error ? [b.error] : []));
  const byEngine = { bing: [], baidu: [] };
  for (const b of batches) {
    for (const r of b.results) byEngine[r.engine].push(r);
  }

  const merged = mergeBatches(batches);
  const ranked = rankResults(merged, query);
  const summary = buildSummary(ranked, query);

  let ai = null;
  if (opts.ai !== false) {
    ai = await aiJudge(query, ranked);
    if (ai && ai.bestId != null) {
      const best = ranked[ai.bestId];
      if (best) {
        summary.best = best;
        summary.answer = ai.answer || summary.answer;
        summary.confidence = ai.confidence ?? summary.confidence;
      }
    }
  }

  return {
    query,
    searchId:
      "srch_" + started.toString(36) + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    engineCount: Object.values(byEngine).filter((a) => a.length).length,
    engines: { bing: { total: byEngine.bing.length }, baidu: { total: byEngine.baidu.length } },
    variants,
    errors,
    ai_verified: Boolean(ai),
    summary,
    results: ranked.map((r, i) => ({ rank: i + 1, ...r })),
    meta: {
      elapsedMs: Date.now() - started,
      provider: "Vexify",
      note: "Results merged from Bing & Baidu and ranked by cross-engine consensus + relevance.",
    },
  };
}