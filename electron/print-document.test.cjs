const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrintHtml, safePdfFileName, sheetImageLayout } = require("./print-document.cjs");

test("rotated pages switch sheet orientation and bake a CSS rotation", () => {
  const html = createPrintHtml("旋转", [
    { url: "file:///tmp/p1.jpg", width: 1200, height: 1800, rotation: 90 },
    { url: "file:///tmp/p2.jpg", width: 1200, height: 1800, rotation: 180 }
  ]);
  // 90° 后可视尺寸变横向 → 纸张用 landscape；180° 保持 portrait
  assert.ok(html.indexOf('class="sheet landscape"') < html.indexOf("p2.jpg"));
  assert.match(html, /style="width:\d+px;height:\d+px;transform:rotate\(90deg\)"/);
  assert.match(html, /transform:rotate\(180deg\)/);
  const layout = sheetImageLayout({ width: 1200, height: 1800, rotation: 90 });
  assert.equal(layout.landscape, true);
  // 布局盒必须是旋转前的宽高（视觉高宽互换后仍适配内容区）
  assert.equal(layout.style, "width:708px;height:1062px;transform:rotate(90deg)");
  const plain = sheetImageLayout({ width: 1200, height: 1800 });
  assert.equal(plain.style, "");
  assert.equal(plain.landscape, false);
});

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
