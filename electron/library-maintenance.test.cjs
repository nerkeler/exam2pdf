const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { PostStore } = require("./post-store.cjs");
const { withStoreLocks } = require("./library-maintenance.cjs");

test("holds incoming collections and uploads until backup or restore releases all store queues", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-maintenance-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const posts = new PostStore(path.join(root, "posts"));
  const answers = new PostStore(path.join(root, "answers"));
  await Promise.all([posts.initialize(), answers.initialize()]);
  let release;
  let markStarted;
  const held = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const maintenance = withStoreLocks([posts, answers], async () => { markStarted(); await held; });
  await started;
  const payload = { title: "并发写入", images: [{ mime: "image/jpeg", base64: Buffer.from("fixture").toString("base64") }] };
  let writes = 0;
  const saves = [posts.createPost(payload), answers.createPost({ ...payload, recordType: "answer" })]
    .map((operation) => operation.then(() => { writes++; }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  release();
  await Promise.all([maintenance, ...saves]);
  assert.equal(writes, 2);
  await assert.rejects(withStoreLocks([posts, answers], async () => { throw new Error("invalid backup"); }), /invalid backup/);
  await answers.createPost({ ...payload, recordType: "answer" });
  assert.equal((await answers.listPosts()).length, 2);
});
