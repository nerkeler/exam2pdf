const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StudentStore } = require("./student-store.cjs");

async function makeStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-student-store-"));
  const store = new StudentStore(root);
  await store.initialize();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store };
}

test("creates students with unique names and lists them after a fresh store instance", async (t) => {
  const { root, store } = await makeStore(t);
  const first = await store.create("大明");
  const second = await store.create("二明");
  assert.equal(first.name, "大明");
  assert.equal(second.name, "二明");
  await assert.rejects(store.create("大明"), /已有同名学生/);
  const reopened = new StudentStore(root);
  const roster = await reopened.list();
  assert.deepEqual(roster.map((student) => student.name).sort(), ["二明", "大明"]);
});

test("renames students and rejects unknown or duplicate names", async (t) => {
  const { store } = await makeStore(t);
  const created = await store.create("小明");
  const renamed = await store.rename(created.id, "大明");
  assert.equal(renamed.name, "大明");
  await assert.rejects(store.rename(created.id, ""), /请填写学生姓名/);
  await assert.rejects(store.rename("not-a-uuid", "老大"), /找不到这个学生/);
  assert.equal((await store.list()).length, 1);
});

test("removes students from the roster", async (t) => {
  const { store } = await makeStore(t);
  const created = await store.create("小明");
  await store.remove(created.id);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.remove(created.id), /找不到这个学生/);
});
