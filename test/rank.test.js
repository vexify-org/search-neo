import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, rankResults, buildSummary } from "../src/rank.js";
import { refineQuery, mergeBatches } from "../src/query.js";
import { cleanText } from "../src/net.js";

test("cleanText decodes CJK numeric entities", () => {
  assert.equal(cleanText("m&#225;o s&#249;"), "máo sù");
  assert.equal(cleanText("a&nbsp;b&amp;c&middot;"), "a b&c·");
  assert.equal(cleanText("<b>x</b>  y"), "x y");
});

test("tokenize extracts English words and CJK bigrams, drops stopwords", () => {
  const en = tokenize("What is nodejs event loop");
  assert.ok(en.includes("nodejs"));
  assert.ok(en.includes("event"));
  assert.ok(en.includes("loop"));
  assert.ok(!en.includes("what"));
  assert.ok(!en.includes("is"));

  const zh = tokenize("毛遂自荐主人公");
  assert.ok(zh.includes("毛"));
  assert.ok(zh.includes("遂"));
  assert.ok(zh.includes("毛遂"));
  assert.ok(zh.includes("荐主"));
});

test("refineQuery turns a question into substantive variants", () => {
  const v = refineQuery("谁是中国首位航天员");
  assert.ok(v.includes("中国首位航天员"));
  assert.ok(v.includes("中国首位航天员 是谁"));
  assert.ok(v.includes("谁是中国首位航天员"));
});

test("refineQuery strips noise and maps suffix questions", () => {
  const v = refineQuery("请问毛遂自荐的主人公是谁");
  assert.ok(v.includes("毛遂自荐的主人公"));
  assert.ok(v.includes("毛遂自荐的主人公 是谁"));
});

test("mergeBatches dedupes by engine+url", () => {
  const batches = [
    { query: "a", results: [{ engine: "bing", url: "https://x.com/1", title: "t" }] },
    { query: "b", results: [{ engine: "bing", url: "https://x.com/1", title: "t" }, { engine: "baidu", url: "https://x.com/2", title: "t2" }] },
  ];
  const merged = mergeBatches(batches);
  assert.equal(merged.length, 2);
});

test("rankResults boosts cross-engine consensus & penalizes ads/question titles", () => {
  const query = "首届 中国 航天员";
  const base = (title, url, engine, snippet = "") => ({ title, url, snippet, engine });

  const results = [
    base("中国 首位航天员 杨利伟 简历", "https://baike.baidu.com/item/杨利伟", "bing"),
    base("中国 首位航天员 杨利伟 介绍", "https://baike.baidu.com/item/杨利伟", "baidu"),
    base("杨利伟 是谁?_问答", "https://wenda.so.com/q/123", "bing", "谁"),
    base("神舟飞船 尺寸 规格", "https://junk-ads.example.com/deal?x=1", "baidu"),
  ];

  const ranked = rankResults(results, query);
  // Both-engine consensus page should lead.
  assert.equal(ranked[0].url, "https://baike.baidu.com/item/杨利伟");
  assert.ok(ranked[0].domainConsensus || ranked[0].groupSize > 1);

  // Junk / ad-ish and question-form results should rank last-ish (not first).
  const junkIdx = ranked.findIndex((r) => r.url.includes("junk-ads"));
  assert.ok(junkIdx > ranked[0] === false ? junkIdx > 0 : true);

  // Scores within 0..99.
  for (const r of ranked) assert.ok(r.score >= 0 && r.score <= 99);
});

test("junk results (image galleries, videos, songs) are filtered out", () => {
  const query = "中国首位航天员";
  const results = [
    { title: "中国首位航天员 - 百度图片", url: "https://image.baidu.com/search/index?tn=baiduimage&word=abc", snippet: "", engine: "baidu" },
    { title: "真实记录", url: "https://news.example.com/a/1", snippet: "杨利伟 神舟", engine: "bing" },
  ];
  const ranked = rankResults(results, query);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].url.includes("news.example.com"));
});

test("buildSummary returns best result and grounded answer", () => {
  const ranked = rankResults(
    [
      { title: "毛遂自荐含义", url: "https://hanyuguoxue.com/1", snippet: "毛遂自己推荐自己", engine: "bing" },
      { title: "毛遂自荐", url: "https://hanyuguoxue.com/1", snippet: "毛遂自己推荐自己", engine: "baidu" },
    ],
    "毛遂自荐 含义"
  );
  const s = buildSummary(ranked, "毛遂自荐 含义");
  assert.ok(s.best);
  assert.ok(s.answer.includes("毛遂自荐"));
  assert.ok(s.confidence > 0);
});