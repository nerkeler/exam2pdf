const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// Exercise the actual asynchronous main-process handler without opening a browser
// or using the user's authenticated Xiaohongshu session.
function createMeasurement() {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const start = source.indexOf("async function measureXhsSearchPosition(");
  const end = source.indexOf("function sameXhsSearchPosition(", start);
  assert.ok(start >= 0 && end > start);
  let finish;
  const delayed = new Promise((resolve) => { finish = resolve; });
  let applied = 0;
  const context = vm.createContext({
    xhsView: { webContents: { isDestroyed: () => false, executeJavaScript: () => delayed } },
    requestedXhsBounds: { width: 1200, height: 800, visible: true },
    xhsReady: true,
    xhsPageRevision: 1,
    xhsSearchMeasureAttempts: 0,
    xhsSearchPositionReady: false,
    xhsSearchPosition: {},
    SEARCH_BUTTON_WIDTH: 80,
    SEARCH_BUTTON_HEIGHT: 32,
    resolveSearchGuidePosition: () => ({ left: 900, top: 20, width: 80, height: 32 }),
    sameXhsSearchPosition: () => false,
    applyXhsSearchOverlayBounds: () => { applied++; },
    setTimeout,
    console
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context,
    finish: () => finish({ input: {}, row: {}, viewport: { width: 1200, height: 800 } }),
    applied: () => applied
  };
}

for (const [name, invalidate] of [
  ["switches away from the collection screen", (context) => { context.requestedXhsBounds = null; }],
  ["replaces the view after closing its window", (context) => { context.xhsView = null; }],
  ["navigates to a new document", (context) => { context.xhsPageRevision++; }],
  ["resizes the embedded viewport", (context) => { context.requestedXhsBounds = { width: 900, height: 600, visible: true }; }]
]) {
  test("discards delayed search geometry when the app " + name, async () => {
    const measurement = createMeasurement();
    const pending = measurement.context.measureXhsSearchPosition();
    invalidate(measurement.context);
    measurement.finish();
    await pending;
    assert.equal(measurement.applied(), 0);
    assert.equal(measurement.context.xhsSearchPositionReady, false);
  });
}

test("applies search geometry while its page and viewport are still current", async () => {
  const measurement = createMeasurement();
  const pending = measurement.context.measureXhsSearchPosition();
  measurement.finish();
  await pending;
  assert.equal(measurement.applied(), 1);
  assert.equal(measurement.context.xhsSearchPositionReady, true);
});
