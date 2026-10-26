const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { printAndCleanup } = require("./print-job.cjs");

async function makePrintDirectory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-print-job-"));
  const directory = path.join(root, "print");
  await fs.mkdir(directory);
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return directory;
}

function makePrintWindow(print) {
  return {
    closed: false,
    webContents: { print },
    isDestroyed() { return this.closed; },
    close() { this.closed = true; }
  };
}

test("closes the print window and removes temporary files after success or user cancellation", async (t) => {
  for (const result of [{ success: true, failureReason: "" }, { success: false, failureReason: "Print job canceled" }]) {
    const printDirectory = await makePrintDirectory(t);
    const window = makePrintWindow((_options, callback) => callback(result.success, result.failureReason));
    const outcome = await printAndCleanup(window, printDirectory);

    assert.deepEqual(outcome, result);
    assert.equal(window.closed, true);
    await assert.rejects(fs.access(printDirectory), { code: "ENOENT" });
  }
});

test("cleans the print window and directory when Electron throws before invoking its callback", async (t) => {
  const printDirectory = await makePrintDirectory(t);
  const window = makePrintWindow(() => { throw new Error("printer unavailable"); });

  await assert.rejects(printAndCleanup(window, printDirectory), /printer unavailable/);
  assert.equal(window.closed, true);
  await assert.rejects(fs.access(printDirectory), { code: "ENOENT" });
});

test("still removes temporary files if closing the completed print window throws", async (t) => {
  const printDirectory = await makePrintDirectory(t);
  const window = makePrintWindow((_options, callback) => callback(true));
  window.close = () => { throw new Error("window close failed"); };

  await assert.rejects(printAndCleanup(window, printDirectory), /window close failed/);
  await assert.rejects(fs.access(printDirectory), { code: "ENOENT" });
});
