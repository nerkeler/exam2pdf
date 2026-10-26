const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSearchQuery,
  buildSearchUrl,
  resolveSearchGuidePosition,
  SEARCH_BUTTON_WIDTH,
  SEARCH_BUTTON_HEIGHT
} = require("./xhs-search.cjs");

const viewport = { width: 1220, height: 813 };

test("builds an ordered query from the selected search filters", () => {
  assert.equal(
    buildSearchQuery({ grade: " 八年级 ", subject: "数学", version: "沪科版", paperType: "期中", unit: "" }),
    "八年级 数学 沪科版 期中"
  );
  assert.equal(buildSearchQuery({ subject: "数学", unit: "第11章" }), "数学 第11章");
});

test("builds a Xiaohongshu search URL and rejects an empty query", () => {
  assert.equal(
    buildSearchUrl("八年级 数学 沪科版 期中"),
    "https://www.xiaohongshu.com/search_result?keyword=%E5%85%AB%E5%B9%B4%E7%BA%A7+%E6%95%B0%E5%AD%A6+%E6%B2%AA%E7%A7%91%E7%89%88+%E6%9C%9F%E4%B8%AD&source=web_explore_feed"
  );
  assert.equal(buildSearchUrl("   "), null);
});

test("anchors right of the Xiaohongshu search magnifier, vertically centered on it", () => {
  const position = resolveSearchGuidePosition(
    { left: 286, right: 1099, top: 83, bottom: 124 },
    { left: 265, right: 1119, top: 62, bottom: 178 },
    { left: 1100, right: 1130, top: 70, bottom: 110 },
    viewport
  );
  // 放大镜右缘 + 8 超出视口安全边时被右缘钳制（贴边显示）
  // 按钮顶边与搜索框顶边对齐（row.top = 62）
  assert.deepEqual(position, {
    left: Math.min(1130 + 8, viewport.width - SEARCH_BUTTON_WIDTH - 12),
    top: 62,
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});

test("clamps to the viewport when the magnifier sits at the right edge", () => {
  const position = resolveSearchGuidePosition(
    { left: 286, right: 1099, top: 83, bottom: 124 },
    { left: 265, right: 1119, top: 62, bottom: 178 },
    { left: 1150, right: 1210, top: 70, bottom: 110 },
    viewport
  );
  assert.equal(position.left, viewport.width - SEARCH_BUTTON_WIDTH - 12);
  assert.ok(position.top >= 12);
});

test("falls back to the search row and the corner when no magnifier is found", () => {
  const rowOnly = resolveSearchGuidePosition(
    { left: 286, right: 1099, top: 83, bottom: 124 },
    { left: 265, right: 1119, top: 62, bottom: 178 },
    null,
    viewport
  );
  assert.equal(rowOnly.left, 1119 + 8);
  const corner = resolveSearchGuidePosition(null, null, null, viewport);
  assert.deepEqual(corner, {
    left: viewport.width - SEARCH_BUTTON_WIDTH - 12,
    top: 12,
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});
