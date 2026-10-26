const test = require("node:test");
const assert = require("node:assert/strict");
const { isXhsUrl, noteIdFromUrl, isXhsImageUrl } = require("./xhs-url.cjs");

test("accepts only HTTPS Xiaohongshu hosts without URL credentials", () => {
  assert.equal(isXhsUrl("https://www.xiaohongshu.com/explore"), true);
  assert.equal(isXhsUrl("https://creator.xiaohongshu.com/"), true);
  assert.equal(isXhsUrl("http://www.xiaohongshu.com/"), false);
  assert.equal(isXhsUrl("https://xiaohongshu.com.evil.test/"), false);
  assert.equal(isXhsUrl("https://evilxiaohongshu.com/"), false);
  assert.equal(isXhsUrl("https://name@xiaohongshu.com/"), false);
  assert.equal(isXhsUrl("not a URL"), false);
});

test("extracts a note id only from supported Xiaohongshu note routes", () => {
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/explore/abc_123?source=feed"), "abc_123");
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/discovery/item/abc-123/"), "abc-123");
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/search_result/abc123"), "abc123");
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/user/profile/abc123"), null);
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/explore/"), null);
  assert.equal(noteIdFromUrl("https://xiaohongshu.com.evil.test/explore/abc123"), null);
  assert.equal(noteIdFromUrl("http://www.xiaohongshu.com/explore/abc123"), null);
  assert.equal(noteIdFromUrl("https://www.xiaohongshu.com/explore/" + "a".repeat(129)), null);
});

test("accepts image URLs only from HTTPS XHS and XHS CDN hosts", () => {
  assert.equal(isXhsImageUrl("https://sns-webpic.xhscdn.com/2026/abc.jpg"), true);
  assert.equal(isXhsImageUrl("https://www.xiaohongshu.com/image/abc.jpg"), true);
  assert.equal(isXhsImageUrl("http://sns-webpic.xhscdn.com/abc.jpg"), false);
  assert.equal(isXhsImageUrl("https://xhscdn.com.evil.test/abc.jpg"), false);
  assert.equal(isXhsImageUrl("https://cdn.evil.test/abc.jpg"), false);
  assert.equal(isXhsImageUrl("https://name@xhscdn.com/abc.jpg"), false);
});
