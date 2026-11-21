const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GradeStagingStore, sanitizePages } = require("./grade-staging.cjs");

const STUDENT = "1e2ea4cc-7aa5-44d7-a62b-f5fc6822c8a6";

async function makeStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-grade-staging-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new GradeStagingStore(root);
}

const page = (over = {}) => ({ mime: "image/jpeg", base64: Buffer.from("page-bytes").toString("base64"), width: 1200, height: 1600, ...over });

test("save/load roundtrip persists pages with rotation for one student", async (t) => {
  const store = await makeStore(t);
  await store.save(STUDENT, [page(), page({ rotation: 90 })]);
  const loaded = await store.load(STUDENT);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[1].rotation, 90);
  assert.equal(loaded[0].base64, page().base64);
});

test("staging files are per-student and survive store re-creation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-grade-staging-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = new GradeStagingStore(root);
  await first.save(STUDENT, [page()]);
  const other = "9a3d365c-26ab-4593-97b0-ab3fdfd484da";
  await first.save(other, [page(), page()]);
  // 新实例（模拟应用重启）读回同一学生的暂存
  const second = new GradeStagingStore(root);
  assert.equal((await second.load(STUDENT)).length, 1);
  assert.equal((await second.load(other)).length, 2);
});

test("empty save clears the staging file", async (t) => {
  const store = await makeStore(t);
  await store.save(STUDENT, [page()]);
  const result = await store.save(STUDENT, []);
  assert.equal(result.pages, 0);
  assert.deepEqual(await store.load(STUDENT), []);
});

test("clear removes the file and load of an unknown student yields empty", async (t) => {
  const store = await makeStore(t);
  await store.save(STUDENT, [page()]);
  await store.clear(STUDENT);
  assert.deepEqual(await store.load(STUDENT), []);
  assert.deepEqual(await store.load("f78ed91b-c37b-4689-bf39-f60a49f2716a"), []);
});

test("invalid student ids and junk pages are rejected or filtered", async (t) => {
  const store = await makeStore(t);
  await assert.rejects(store.save("not-a-uuid", [page()]), /学生标识无效/);
  await assert.rejects(store.load(""), /学生标识无效/);
  await assert.rejects(store.clear("../escape"), /学生标识无效/);
  const loaded = await store.load(STUDENT); // 未知学生 → 空数组而非抛错
  assert.deepEqual(loaded, []);
  const filtered = sanitizePages([
    null,
    { base64: "" },
    { mime: "image/png", base64: "ok", width: 100, height: 50 },
    { mime: "image/png", base64: "rot", width: 100, height: 50, rotation: 45 },
    page({ width: 33.4, height: -5 })
  ]);
  assert.equal(filtered.length, 3, "null/空/非法条目必须被过滤");
  assert.equal(filtered[0].rotation, 0, "契约外角度必须归零");
  assert.equal(filtered[2].width, 33, "非整数宽高取整");
  assert.equal(filtered[2].height, 1, "负数宽高钳到 1");
});
