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

test('student avatars persist through rename and reject invalid choices without changing the roster', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'student-avatar-'));
  try {
    const store = new StudentStore(root); await store.initialize();
    const student = await store.create('小雨', 'female');
    assert.equal(student.gender, 'female');
    await store.rename(student.id, '小宇', 'male');
    assert.equal((await new StudentStore(root).list())[0].gender, 'male');
    await store.rename(student.id, '小宇同学');
    assert.equal((await store.list())[0].gender, 'male');
    await assert.rejects(store.rename(student.id, '不保存', 'invalid'));
    await assert.rejects(store.create('不保存', 'invalid'));
    assert.equal((await store.list())[0].name, '小宇同学');
    assert.equal((await store.list()).length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('custom avatar is persisted and can be cleared while invalid data cannot overwrite it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'student-custom-avatar-'));
  try {
    const store = new StudentStore(root); await store.initialize();
    const avatar = 'data:image/jpeg;base64,/9j/AAAA';
    const student = await store.create('自定义头像', 'female', avatar);
    assert.equal((await new StudentStore(root).list())[0].avatar, avatar);
    await store.rename(student.id, '保留头像');
    assert.equal((await store.list())[0].avatar, avatar);
    await assert.rejects(store.rename(student.id, '非法', 'male', 'https://example.com/photo.jpg'));
    await assert.rejects(store.rename(student.id, '非法', 'male', 'data:image/svg+xml;base64,AAAA'));
    assert.equal((await store.list())[0].avatar, avatar);
    await store.rename(student.id, '使用预置', 'male', null);
    assert.equal((await store.list())[0].avatar, null);
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});
