const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const { pathToFileURL } = require("node:url");

for (const failure of ["html-write", "native-window"]) {
  test("removes temporary student images when print preparation fails at " + failure, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-print-preparation-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, "page-001.jpg"), "original image");
    const source = fsSync.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
    const start = source.indexOf("async function preparePrintWindow(");
    const end = source.indexOf("async function exportPdfViaDialog(", start);
    assert.ok(start >= 0 && end > start);
    const context = vm.createContext({
      fs: { ...fs, async writeFile(file, ...args) {
        if (failure === "html-write" && path.basename(file) === "print.html") throw new Error("simulated full disk");
        return fs.writeFile(file, ...args);
      } },
      path,
      randomUUID,
      pathToFileURL,
      app: { getPath: () => root },
      mainWindow: null,
      processPrintImage: () => ({ data: Buffer.from("processed student image"), width: 10, height: 10 }),
      createPrintHtml: () => "<html>fixture</html>",
      BrowserWindow: class { constructor() { throw new Error("simulated native window failure"); } }
    });
    vm.runInContext(source.slice(start, end), context);
    const store = {
      async getPost() { return { id: "fixture", title: "fixture", pageOrder: ["page-001.jpg"], images: [{ file: "page-001.jpg", mime: "image/jpeg" }] }; },
      postDirectory: () => root
    };
    await assert.rejects(context.preparePrintWindow(store, "fixture", null, "fixture"), /simulated/);
    assert.deepEqual(await fs.readdir(root), ["page-001.jpg"]);
    assert.equal(await fs.readFile(path.join(root, "page-001.jpg"), "utf8"), "original image");
  });
}
