const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrintHtml, safePdfFileName } = require("./print-document.cjs");

test("creates one A4 page per image in the requested order", () => {
  const html = createPrintHtml("练习", [
    { url: "file:///tmp/page-1.jpg", width: 1200, height: 1800 },
    { url: "file:///tmp/page-2.jpg", width: 1800, height: 1200 }
  ]);
  assert.equal((html.match(/<section class="sheet/g) || []).length, 2);
  assert.ok(html.indexOf("page-1.jpg") < html.indexOf("page-2.jpg"));
  assert.match(html, /@page portrait\{size:A4 portrait/);
  assert.match(html, /@page landscape\{size:A4 landscape/);
  assert.match(html, /class="sheet portrait"/);
  assert.match(html, /class="sheet landscape"/);
});

test("escapes document titles and image URLs before inserting them into HTML", () => {
  const html = createPrintHtml("卷 <script>alert(1)</script>", [
    { url: "file:///tmp/a&b.jpg", width: 100, height: 100 }
  ]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /卷 &lt;script&gt;/);
  assert.match(html, /a&amp;b\.jpg/);
});

test("creates a filesystem-safe PDF name", () => {
  assert.equal(safePdfFileName("数学/测验:一"), "数学_测验_一.pdf");
  assert.equal(safePdfFileName(""), "试卷.pdf");
});
