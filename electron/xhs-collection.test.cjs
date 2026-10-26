const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PostStore } = require("./post-store.cjs");
const { buildXhsCollectionInput } = require("./xhs-collection.cjs");

function image(value, sourceIndex) {
  return {
    mime: "image/jpeg",
    base64: Buffer.from(value).toString("base64"),
    width: 1200,
    height: 1600,
    sourceIndex
  };
}

test("preserves expected image count through collection storage so retries fill missing pages", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-xhs-collection-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PostStore(path.join(root, "posts"));
  await store.initialize();

  const sourceUrl = "https://www.xiaohongshu.com/explore/retry-note";
  const first = await store.createPost(buildXhsCollectionInput({
    title: "部分采集的试卷",
    author: "老师",
    expectedImages: 3,
    images: [image("page one", 0), image("page three", 2)]
  }, sourceUrl, "retry-note"));
  assert.equal(first.post.expectedImages, 3);
  assert.equal(first.post.missingImages, 1);
  assert.deepEqual(first.post.pageOrder, ["page-001.jpg", "page-003.jpg"]);

  const retry = await store.createPost(buildXhsCollectionInput({
    title: "部分采集的试卷",
    author: "老师",
    expectedImages: 3,
    images: [image("page one", 0), image("page two", 1), image("page three", 2)]
  }, sourceUrl, "retry-note"));
  assert.equal(retry.duplicate, true);
  assert.equal(retry.added, 1);
  assert.equal(retry.post.missingImages, 0);
  assert.deepEqual(retry.post.pageOrder, ["page-001.jpg", "page-002.jpg", "page-003.jpg"]);
});

test("infers the subject from common title keywords", () => {
  const { inferSubject } = require("./xhs-collection.cjs");
  assert.equal(inferSubject("2026-2027八年级上册数学沪科版第一次月考"), "数学");
  assert.equal(inferSubject("七年级语文期中试卷"), "语文");
  assert.equal(inferSubject("初二英语月考"), "英语");
  assert.equal(inferSubject("八上物理期中"), "物理");
  assert.equal(inferSubject("初三化学月考卷"), "化学");
  assert.equal(inferSubject("小学奥数 competition"), "数学");
  assert.equal(inferSubject("道德与法治期末卷"), "政治");
  assert.equal(inferSubject("我的收藏笔记"), "");
  assert.equal(inferSubject(""), "");
});
