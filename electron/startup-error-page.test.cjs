const test = require("node:test");
const assert = require("node:assert/strict");
const { createStartupErrorPage, createStartupErrorUrl } = require("./startup-error-page.cjs");

test("renders startup errors as escaped text in a self-contained diagnostic page", () => {
  const page = createStartupErrorPage(new Error("missing <library> & \"records\""));
  assert.match(page, /家卷 没有加载成功/);
  assert.match(page, /missing &lt;library&gt; &amp; &quot;records&quot;/);
  assert.doesNotMatch(page, /<library>/);
  assert.match(page, /default-src 'none'/);
});

test("encodes the diagnostic page as a data URL", () => {
  const url = createStartupErrorUrl("加载失败");
  assert.match(url, /^data:text\/html;charset=utf-8,/);
  assert.match(decodeURIComponent(url.slice(url.indexOf(",") + 1)), /加载失败/);
});
