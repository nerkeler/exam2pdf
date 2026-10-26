const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { checkPdfRuntime, getBuildArgs } = require("./package-app.cjs");

test("requires complete offline PDF.js assets before packaging", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-package-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.throws(() => checkPdfRuntime(root), /Missing bundled PDF.js/);
  const runtime = path.join(root, "node_modules/pdfjs-dist");
  for (const name of ["build", "cmaps", "standard_fonts", "wasm"]) await fs.mkdir(path.join(runtime, name), { recursive: true });
  for (const name of ["build/pdf.mjs", "build/pdf.worker.mjs", "LICENSE"]) await fs.writeFile(path.join(runtime, name), "fixture");
  assert.equal(checkPdfRuntime(root), runtime);
  await fs.rm(path.join(runtime, "build/pdf.worker.mjs"));
  assert.throws(() => checkPdfRuntime(root), /pdf.worker.mjs/);
});

test("builds explicit architectures with publication disabled on all platforms", () => {
  assert.deepEqual(getBuildArgs("mac", "arm64"), ["--mac", "dmg", "zip", "--arm64", "--publish", "never"]);
  assert.deepEqual(getBuildArgs("win", "x64"), ["--win", "nsis", "--x64", "--publish", "never"]);
  assert.deepEqual(getBuildArgs("linux", "x64"), ["--linux", "AppImage", "deb", "--x64", "--publish", "never"]);
  assert.throws(() => getBuildArgs("other", "x64"), /Unknown/);
  assert.throws(() => getBuildArgs("win", "mips"), /Unsupported/);
});
