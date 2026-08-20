/** Question-prefix patterns (Chinese interrogatives at the start of a query). */
const QUESTION_PREFIXES = [
  /^谁是?(.+)$/,
  /^什么是?(.+)$/,
  /^什么(.+)$/,
  /^为什么(.+)$/,
  /^为何(.+)$/,
  /^如何(.+)$/,
  /^怎样(.+)$/,
  /^怎么样(.+)$/,
  /^怎么(.+)$/,
  /^几(.+)$/,
  /^哪(?:个|些|里|儿)?(.+)$/,
];

const QUESTION_SUFFIXES = [/怎么(办|了|做)?$/, /是谁$/, /是什么$/, /为什么$/, /在哪(里|儿)?$/, /多少钱$/, /吗$/, /呢$/, /吧$/];

const NOISE_WORDS = new Set(["就是", "请问", "帮我查一下", "谁知道", "我想知道", "告诉我"]);

/**
 * Build effective search queries for a user input. For plain keyword queries the
 * original query is used as-is. For question-form queries, several variants are
 * produced so the underlying engines focus on the substantive part:
 *
 *   "谁是中国首位航天员"        -> ["中国首位航天员", "中国首位航天员 是谁"]
 *   "毛遂自荐的主人公是谁"       -> ["毛遂自荐的主人公", "毛遂自荐的主人公 是谁"]
 */
export function refineQuery(raw = "") {
  let q = raw.trim().replace(/\s+/g, " ");

  // Strip leading filler / noise.
  for (const n of NOISE_WORDS) {
    if (q.startsWith(n)) q = q.slice(n.length).trim();
  }

  const variants = new Set();
  variants.add(q);

  let substantive = "";
  for (const re of QUESTION_PREFIXES) {
    const m = q.match(re);
    if (m && m[1].trim().length >= 1) {
      substantive = m[1].trim();
      break;
    }
  }

  // No interrogative prefix: strip a trailing interrogative to get the noun phrase.
  if (!substantive) {
    let stripped = q;
    for (const suf of QUESTION_SUFFIXES) {
      if (suf.test(stripped)) {
        stripped = stripped.replace(suf, "").trim();
        break;
      }
    }
    if (stripped !== q && stripped.length >= 2) substantive = stripped;
  }

  if (substantive) {
    variants.add(substantive);
    // Drop interrogative suffixes to make it a plain noun phrase.
    let np = substantive;
    for (const suf of QUESTION_SUFFIXES) np = np.replace(suf, "").trim();
    if (np.length >= 2 && np !== substantive) variants.add(np);
    // Keep a "…是谁" variant to bias answer-seeking (person queries).
    variants.add(`${np} 是谁`);
    variants.add(`${np} 答案`);
  }

  return [...variants].filter((v) => v.length >= 1).slice(0, 4);
}

/** Merge results from multiple crawl runs, keeping the source query mapping. */
export function mergeBatches(batches) {
  const seen = new Set();
  const out = [];
  for (const b of batches) {
    for (const r of b.results) {
      const key = `${r.engine}|${r.url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...r, sourceQuery: b.query });
    }
  }
  return out;
}