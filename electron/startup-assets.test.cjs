const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadCollectorScript, tryRunOptionalStartupTask } = require("./startup-assets.cjs");

test("missing collector script becomes a recoverable asset error", () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const loaded = loadCollectorScript("collector.js", () => { throw missing; });
  assert.equal(loaded.source, "");
  assert.equal(loaded.error, missing);
});

test("optional startup view failures are reported without aborting the caller", () => {
  const failure = new Error("WebContentsView unavailable");
  let reported = null;
  const created = tryRunOptionalStartupTask(() => { throw failure; }, (error) => { reported = error; });
  assert.equal(created, false);
  assert.equal(reported, failure);
  assert.equal(tryRunOptionalStartupTask(() => {}, () => assert.fail("unexpected error")), true);
});

test("main process isolates optional XHS startup from the workbench window", () => {
  const source = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(source, /tryRunOptionalStartupTask\(createXhsView/);
  assert.match(source, /if \(collectorAsset\.error\)/);
  assert.match(source, /小红书网页视图初始化失败/);
  assert.match(source, /monitorWindowStartup\(windowBeingStarted, pageLoad, showWindowLoadFailure, \{ showWindow: !startupSmoke \}\)/);
  assert.match(source, /加载工作台失败/);
  assert.match(source, /showWindowLoadFailure\(error\)/);
  assert.match(source, /function showInitializationFailure\(error\)/);
  assert.match(source, /showInitializationFailure\(error\);/);
  assert.match(source, /window\.__exam2pdfBootComplete === true/);
  assert.match(source, /启动检查跳过小红书网页/);
});
