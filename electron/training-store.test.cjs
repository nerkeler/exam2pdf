const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { TrainingStore } = require("./training-store.cjs");

function practice(topic = "一元一次方程") {
  return {
    topic,
    source: "本地基础题型模板",
    questions: [
      { prompt: "解方程：2x + 1 = 5", answer: "x = 2" },
      { prompt: "解方程：3x = 9", answer: "x = 3" }
    ]
  };
}

test("persists training history and parent approval across store instances", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-training-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TrainingStore(root);
  const created = await store.create(practice());
  assert.equal(created.status, "draft");
  assert.equal(created.questions.length, 2);
  assert.equal((await store.get(created.id)).topic, "一元一次方程");

  const approved = await store.setStatus(created.id, "approved");
  assert.equal(approved.status, "approved");
  const reopened = await new TrainingStore(root).list();
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].id, created.id);
  assert.equal(reopened[0].status, "approved");
});

test("rejects incomplete exercises and invalid status changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-training-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new TrainingStore(root);
  await assert.rejects(store.create({ topic: "缺答案", questions: [{ prompt: "题目", answer: "" }] }), /内容不完整/);
  const created = await store.create(practice());
  await assert.rejects(store.setStatus(created.id, "printed"), /状态无效/);
  await assert.rejects(store.setStatus("not-a-uuid", "approved"), /编号无效/);
});
