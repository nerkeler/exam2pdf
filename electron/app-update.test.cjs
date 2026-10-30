const test = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, RELEASES_PAGE } = require("./app-update.cjs");

test("orders versions by core numbers", () => {
  assert.equal(compareVersions("0.1.4-preview.1", "0.1.3-preview.1"), 1);
  assert.equal(compareVersions("0.1.3-preview.1", "0.1.4-preview.1"), -1);
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
});

test("orders prerelease identifiers per semver", () => {
  assert.equal(compareVersions("0.1.4-preview.2", "0.1.4-preview.1"), 1);
  assert.equal(compareVersions("0.1.4-preview.10", "0.1.4-preview.9"), 1);
  assert.equal(compareVersions("0.1.4", "0.1.4-preview.1"), 1);
  assert.equal(compareVersions("0.1.4-preview.1", "0.1.4"), -1);
});

test("strips the v prefix and treats equal versions as equal", () => {
  assert.equal(compareVersions("v0.1.4-preview.1", "0.1.4-preview.1"), 0);
  assert.equal(compareVersions("0.1.4-preview.1", "v0.1.4-preview.1"), 0);
});

test("exposes the latest release page", () => {
  assert.equal(RELEASES_PAGE, "https://github.com/nerkeler/exam2pdf/releases/latest");
});
