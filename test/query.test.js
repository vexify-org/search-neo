import { test } from "node:test";
import assert from "node:assert/strict";
import { refineQuery, mergeBatches } from "../src/query.js";

test("refineQuery handles plain keyword queries (no change)", () => {
  const v = refineQuery("nodejs event loop");
  assert.ok(v.includes("nodejs event loop"));
  assert.equal(v.length, 1);
});

test("refineQuery strips leading noise words", () => {
  assert.ok(refineQuery("请问谁是习近平").includes("习近平"));
  assert.ok(refineQuery("帮我查一下什么是AI").includes("什么是AI"));
  assert.ok(refineQuery("谁知道中国在哪").includes("中国在哪"));
});

test("refineQuery generates at most 4 variants", () => {
  const v = refineQuery("谁是中国首位航天员");
  assert.ok(v.length <= 4);
  assert.ok(v.length >= 2);
});

test("refineQuery handles all Chinese interrogative prefixes", () => {
  const cases = [
    ["什么是人工智能", "人工智能"],
    ["为什么天空是蓝色的", "天空是蓝色的"],
    ["如何学习编程", "学习编程"],
    ["哪里是北京", "北京"],
    ["哪个是最好的浏览器", "最好的浏览器"],
  ];
  for (const [input, expected] of cases) {
    const v = refineQuery(input);
    assert.ok(
      v.some((x) => x.includes(expected)),
      `Expected "${expected}" in variants for "${input}"`
    );
  }
});

test("refineQuery strips trailing interrogatives from noun phrases", () => {
  const v = refineQuery("中国首位航天员是谁");
  assert.ok(v.includes("中国首位航天员"));
  assert.ok(v.some((x) => x.endsWith("是谁")));
});

test("mergeBatches deduplicates by engine+url, keeps cross-engine duplicates", () => {
  const batches = [
    { query: "中国航天", results: [{ engine: "bing", url: "https://a.com", title: "A" }] },
    {
      query: "中国 航天",
      results: [
        { engine: "baidu", url: "https://a.com", title: "A" },
        { engine: "bing", url: "https://b.com", title: "B" },
      ],
    },
  ];
  const merged = mergeBatches(batches);
  // a.com appears on both engines -> kept twice (different dedup key: bing|a.com vs baidu|a.com)
  assert.equal(merged.length, 3);
  const aEntries = merged.filter((r) => r.url === "https://a.com");
  const bEntry = merged.find((r) => r.url === "https://b.com");
  assert.equal(aEntries.length, 2);
  assert.ok(bEntry);
});
