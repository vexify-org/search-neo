import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText, decodeUrl, normUrlKey } from "../src/net.js";

test("cleanText decodes numeric HTML entities", () => {
  assert.equal(cleanText("m&#225;o s&#249;"), "máo sù");
  assert.equal(cleanText("&#x4E2D;&#x6587;"), "中文");
});

test("cleanText strips HTML tags and collapses whitespace", () => {
  assert.equal(cleanText("<b>bold</b>   <i>italic</i>"), "bold italic");
  assert.equal(cleanText("<p>hello</p><p>world</p>"), "hello world");
});

test("cleanText decodes named HTML entities", () => {
  assert.equal(cleanText("a&nbsp;b&amp;c&middot;"), "a b&c·");
  // Curly-quote entities decode to Unicode curly quotes, not ASCII
  assert.ok(cleanText("&ldquo;quoted&rdquo;").includes("\u201c"));
  assert.ok(cleanText("&ldquo;quoted&rdquo;").includes("\u201d"));
});

test("cleanText handles empty and null input", () => {
  assert.equal(cleanText(""), "");
  assert.equal(cleanText(null), "");
  assert.equal(cleanText(undefined), "");
});

test("decodeUrl decodes percent-encoded strings", () => {
  // %E6%AF%8F%E5%AE%9A%E8%87%AA%E6%8F%9B = "每多自荐"
  assert.equal(decodeUrl("%E6%AF%8F%E5%A4%9A%E8%87%AA%E8%8D%90"), "每多自荐");
  assert.equal(decodeUrl("hello%20world"), "hello world");
  assert.equal(decodeUrl("already+plain"), "already+plain");
});

test("decodeUrl returns input on invalid sequences", () => {
  assert.equal(decodeUrl("%ZZ"), "%ZZ");
  assert.equal(decodeUrl(""), "");
});

test("normUrlKey normalizes URLs consistently", () => {
  const a = normUrlKey("https://example.com/page?id=1&sort=name");
  const b = normUrlKey("https://example.com/page?sort=name&id=1");
  assert.equal(a, b);

  const c = normUrlKey("https://www.example.com/path///");
  const d = normUrlKey("https://example.com/path");
  assert.equal(c, d);

  const e = normUrlKey("https://www.example.com/");
  const f = normUrlKey("https://example.com/");
  assert.equal(e, f);
});

test("normUrlKey falls back to raw URL on parse failure", () => {
  const raw = "not-a-valid-url";
  assert.equal(normUrlKey(raw), raw);
});
