const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSearchQuery,
  buildSearchUrl,
  resolveSearchPanelBounds
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

test("search drawer stays at the webpage edge without depending on page content", () => {
  assert.deepEqual(resolveSearchPanelBounds(viewport),{left:1128,top:12,width:80,height:32});
});
test("search drawer stays within narrow and short viewports", () => {
  for (const width of [1,10,50,320,1200]) for (const height of [1,10,100,800]) {
    const panel=resolveSearchPanelBounds({width,height},true);
    assert.ok(panel.left>=0 && panel.left+panel.width<=width);
    assert.ok(panel.top>=0 && panel.top+panel.height<=height);
  }
});

test('opening the panel leaves the button anchored at the same top-right corner',()=>{
  const closed=resolveSearchPanelBounds(viewport), open=resolveSearchPanelBounds(viewport,true);
  assert.equal(closed.left+closed.width,open.left+open.width);
  assert.equal(closed.top,open.top);
});
