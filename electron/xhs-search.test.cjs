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

test("docks the search control right after the search row, centered on the input line", () => {
  const position = resolveSearchGuidePosition(
    { left: 286, right: 1099, top: 83, bottom: 124 },
    { left: 265, right: 1119, top: 62, bottom: 178 },
    viewport
  );
  assert.deepEqual(position, {
    left: 1119 + 8,
    top: Math.round(83 + (124 - 83 - SEARCH_BUTTON_HEIGHT) / 2),
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});

test("falls back above the search row when the right gutter is too narrow", () => {
  const position = resolveSearchGuidePosition(
    { left: 200, right: 900, top: 100, bottom: 140 },
    { left: 180, right: 1196, top: 60, bottom: 176 },
    viewport
  );
  assert.deepEqual(position, {
    left: 1196 - SEARCH_BUTTON_WIDTH,
    top: 60 - SEARCH_BUTTON_HEIGHT - 8,
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});

test("falls back below the search row when there is no room above it", () => {
  const position = resolveSearchGuidePosition(
    { left: 40, right: 1204, top: 16, bottom: 56 },
    { left: 20, right: 1204, top: 10, bottom: 76 },
    viewport
  );
  assert.deepEqual(position, {
    left: Math.min(1204 - SEARCH_BUTTON_WIDTH, 1220 - SEARCH_BUTTON_WIDTH - 12),
    top: 84,
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});

test("keeps the control in the top-right corner when no search row is visible", () => {
  assert.deepEqual(resolveSearchGuidePosition(null, null, viewport), {
    left: 1220 - SEARCH_BUTTON_WIDTH - 12,
    top: 12,
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
});
