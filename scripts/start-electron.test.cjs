const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("startup check loads the real Electron runtime without opening a window", () => {
  const script = path.join(__dirname, "start-electron.cjs");
  const result = spawnSync(process.execPath, [script, "--check-only"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, String(result.stderr || result.stdout));
  assert.match(result.stdout, /Electron Node-mode runtime probe verified: \d+\.\d+\.\d+/);
});

test("provides an isolated Electron renderer startup smoke command", () => {
  const root = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const script = fs.readFileSync(path.join(__dirname, "start-electron.cjs"), "utf8");
  assert.equal(packageJson.scripts["smoke:startup"], "node scripts/start-electron.cjs --startup-smoke");
  assert.match(script, /EXAM2PDF_STARTUP_SMOKE = "1"/);
  assert.match(script, /EXAM2PDF_STARTUP_SMOKE_DATA = smokeDataPath/);
  assert.match(script, /fs\.rmSync\(smokeDataPath, \{ recursive: true, force: true \}\)/);
});
