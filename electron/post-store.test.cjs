const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { PostStore } = require("./post-store.cjs");

async function makeStore(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-post-store-"));
  const store = new PostStore(root);
  await store.initialize();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, store };
}

function image(base64) {
  return { mime: "image/jpeg", base64, width: 1200, height: 1600 };
}

test("creates a post, stores images, and lists it after a fresh store instance", async (t) => {
  const { root, store } = await makeStore(t);
  const result = await store.createPost({
    title: "单元测试卷",
    author: "老师",
    source: "小红书采集",
    sourceUrl: "https://www.xiaohongshu.com/explore/abc123",
    noteId: "abc123",
    images: [image(Buffer.from("page-one").toString("base64")), image(Buffer.from("page-two").toString("base64"))]
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.post.pages, 2);
  assert.equal(result.post.author, "老师");
  assert.equal((await fs.readFile(path.join(root, result.post.id, "page-001.jpg"))).toString(), "page-one");

  const reopened = new PostStore(root);
  assert.equal((await reopened.listPosts())[0].title, "单元测试卷");
});

test("treats a second collection of the same note as a duplicate", async (t) => {
  const { store } = await makeStore(t);
  const payload = { title: "原题", noteId: "note-1", images: [image(Buffer.from("same").toString("base64"))] };
  const first = await store.createPost(payload);
  const duplicate = await store.createPost({ ...payload, title: "再次采集" });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.post.id, first.post.id);
  assert.equal((await store.listPosts()).length, 1);
});

test("serializes two overlapping collections of the same note", async (t) => {
  const { store } = await makeStore(t);
  const payload = { title: "并发采集", noteId: "concurrent-note", images: [image(Buffer.from("same").toString("base64"))] };
  const [first, second] = await Promise.all([store.createPost(payload), store.createPost(payload)]);
  assert.equal([first, second].filter((item) => item.duplicate).length, 1);
  assert.equal((await store.listPosts()).length, 1);
});

test("fills missing pages when the same note is collected again after a partial failure", async (t) => {
  const { store } = await makeStore(t);
  const payload = {
    title: "多页试卷",
    noteId: "partial-note",
    expectedImages: 3,
    images: [
      { ...image(Buffer.from("one").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("three").toString("base64")), sourceIndex: 2 }
    ]
  };
  const first = await store.createPost(payload);
  assert.equal(first.post.pages, 2);
  assert.equal(first.post.missingImages, 1);

  const retry = await store.createPost({
    ...payload,
    images: [
      { ...image(Buffer.from("one").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("two").toString("base64")), sourceIndex: 1 },
      { ...image(Buffer.from("three").toString("base64")), sourceIndex: 2 }
    ]
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.added, 1);
  assert.equal(retry.post.pages, 3);
  assert.equal(retry.post.missingImages, 0);
  assert.deepEqual(retry.post.pageOrder, ["page-001.jpg", "page-002.jpg", "page-003.jpg"]);
});

test("appends local pages without changing the source note's missing-page state", async (t) => {
  const { root, store } = await makeStore(t);
  const partial = await store.createPost({
    title: "原帖缺一页",
    noteId: "partial-with-supplement",
    expectedImages: 3,
    images: [
      { ...image(Buffer.from("source-one").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("source-three").toString("base64")), sourceIndex: 2 }
    ]
  });

  const supplemented = await store.appendPostImages(partial.post.id, [image(Buffer.from("local-addition").toString("base64"))]);
  assert.equal(supplemented.pages, 3);
  assert.equal(supplemented.sourcePageCount, 2);
  assert.equal(supplemented.supplementalImages, 1);
  assert.equal(supplemented.expectedImages, 3);
  assert.equal(supplemented.missingImages, 1);
  assert.deepEqual(supplemented.pageOrder, ["page-001.jpg", "page-003.jpg", "page-004.jpg"]);

  const retry = await store.createPost({
    title: "原帖缺一页",
    noteId: "partial-with-supplement",
    expectedImages: 3,
    images: [
      { ...image(Buffer.from("source-one").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("source-two").toString("base64")), sourceIndex: 1 },
      { ...image(Buffer.from("source-three").toString("base64")), sourceIndex: 2 }
    ]
  });
  assert.equal(retry.added, 1);
  assert.equal(retry.post.pages, 4);
  assert.equal(retry.post.sourcePageCount, 3);
  assert.equal(retry.post.supplementalImages, 1);
  assert.equal(retry.post.missingImages, 0);
  assert.deepEqual(retry.post.pageOrder, ["page-001.jpg", "page-002.jpg", "page-003.jpg", "page-004.jpg"]);
  assert.equal((await fs.readFile(path.join(root, partial.post.id, "page-004.jpg"))).toString(), "local-addition");
});

test("validates supplemental page limits and rejects adding worksheet images to an answer record", async (t) => {
  const { store } = await makeStore(t);
  const post = await store.createPost({ title: "页数上限", images: Array.from({ length: 23 }, (_, index) => ({
    ...image(Buffer.from("page-" + index).toString("base64")), sourceIndex: index
  })) });
  await assert.rejects(store.appendPostImages(post.post.id, [image(Buffer.from("page-24").toString("base64")), image(Buffer.from("page-25").toString("base64"))]), /最多保存 24 张/);
  await assert.rejects(store.appendPostImages(post.post.id, [{ mime: "application/pdf", base64: "AA==" }]), /格式不支持/);

  const answer = await store.createPost({ recordType: "answer", title: "作答页", images: [image(Buffer.from("answer").toString("base64"))] });
  await assert.rejects(store.appendPostImages(answer.post.id, [image(Buffer.from("extra").toString("base64"))]), /从批阅页添加/);
});

test("allows supplementing a print selection after removing an original page", async (t) => {
  const { root, store } = await makeStore(t);
  const created = await store.createPost({ title: "先移除再补充", images: [image(Buffer.from("one").toString("base64")), image(Buffer.from("two").toString("base64"))] });
  const [first, removed] = created.post.pageOrder;
  await store.removePostPage(created.post.id, removed);
  const updated = await store.appendPostImages(created.post.id, [image(Buffer.from("extra").toString("base64"))]);
  assert.deepEqual(updated.pageOrder, [first, "page-003.jpg"]);
  assert.equal(updated.removedImages, 1);
  assert.equal(updated.supplementalImages, 1);
  assert.equal((await fs.readFile(path.join(root, created.post.id, removed))).toString(), "two");
});

test("keeps collected files intact when pages are removed and restores the source order on demand", async (t) => {
  const { root, store } = await makeStore(t);
  const result = await store.createPost({
    title: "可整理",
    images: [image(Buffer.from("one").toString("base64")), image(Buffer.from("two").toString("base64"))]
  });
  const [first, second] = result.post.pageOrder;

  const reordered = await store.reorderPost(result.post.id, [second, first]);
  assert.deepEqual(reordered.pageOrder, [second, first]);
  assert.deepEqual((await new PostStore(root).getPost(result.post.id)).pageOrder, [second, first]);

  // 移除只影响打印视图：原始文件与图片清单保留，可统计、可恢复
  const removed = await store.removePostPage(result.post.id, second);
  assert.deepEqual(removed.pageOrder, [first]);
  assert.equal(removed.removedImages, 1);
  await fs.access(path.join(root, result.post.id, second));
  const kept = await store.getPost(result.post.id);
  assert.deepEqual(kept.images.map((item) => item.file).sort(), [first, second].sort());

  // 恢复原始页序：被移除的页按来源页序回归，文件内容原样
  const restored = await store.resetPostOrder(result.post.id);
  assert.deepEqual(restored.pageOrder, [first, second]);
  assert.equal(restored.removedImages, 0);
  assert.equal((await fs.readFile(path.join(root, result.post.id, second))).toString(), "two");

  // 打印页序允许是子集，但仍拒绝未知页与重复页
  const subset = await store.reorderPost(result.post.id, [second]);
  assert.deepEqual(subset.pageOrder, [second]);
  await assert.rejects(store.reorderPost(result.post.id, ["page-999.jpg"]), /页面顺序/);
  await assert.rejects(store.reorderPost(result.post.id, [first, first]), /页面顺序/);
});

test("restores source pages first with supplemental pages kept last", async (t) => {
  const { store } = await makeStore(t);
  const result = await store.createPost({
    title: "缺页后补充",
    noteId: "restore-order-note",
    expectedImages: 3,
    images: [
      { ...image(Buffer.from("p1").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("p3").toString("base64")), sourceIndex: 2 }
    ]
  });
  await store.appendPostImages(result.post.id, [image(Buffer.from("extra").toString("base64"))]);
  await store.reorderPost(result.post.id, ["page-004.jpg", "page-003.jpg", "page-001.jpg"]);
  await store.removePostPage(result.post.id, "page-001.jpg");
  assert.deepEqual((await store.getPost(result.post.id)).pageOrder, ["page-004.jpg", "page-003.jpg"]);

  const restored = await store.resetPostOrder(result.post.id);
  assert.deepEqual(restored.pageOrder, ["page-001.jpg", "page-003.jpg", "page-004.jpg"]);
  assert.equal(restored.removedImages, 0);
});

test("does not treat a page intentionally removed by the user as a retryable failure", async (t) => {
  const { store } = await makeStore(t);
  const payload = {
    title: "已整理",
    noteId: "removed-page-note",
    expectedImages: 2,
    images: [
      { ...image(Buffer.from("one").toString("base64")), sourceIndex: 0 },
      { ...image(Buffer.from("two").toString("base64")), sourceIndex: 1 }
    ]
  };
  const post = (await store.createPost(payload)).post;
  const removed = await store.removePostPage(post.id, "page-002.jpg");
  assert.equal(removed.pages, 1);
  assert.equal(removed.missingImages, 0);

  const retry = await store.createPost(payload);
  assert.equal(retry.added, 0);
  assert.equal(retry.post.pages, 1);
  assert.equal(retry.post.missingImages, 0);
});

test("stores answer sheets separately and only preserves valid human review fields", async (t) => {
  const { store } = await makeStore(t);
  const answer = await store.createPost({
    recordType: "answer",
    studentName: "小明",
    title: "第一次月考作答",
    images: [image(Buffer.from("answer page").toString("base64"))]
  });
  assert.equal(answer.post.recordType, "answer");
  assert.equal(answer.post.source, "学生作答");
  assert.equal((await store.listPosts("post")).length, 0);
  assert.equal((await store.listPosts("answer")).length, 1);

  const trainingId = "a2f4801a-a607-44ec-97c8-6533c51229f6";
  const saved = await store.saveReview(answer.post.id, [{
    questionNo: "5",
    studentAnswer: "x = 3",
    result: "错误",
    errorType: "计算",
    knowledgePoints: ["一元一次方程", "一元一次方程"],
    correctAnswer: "x = 5",
    solutionSummary: "移项后再计算。",
    mastered: false
  }], true, trainingId);
  assert.equal(saved.reviewStatus, "confirmed");
  assert.equal(saved.trainingId, trainingId);
  assert.equal((await store.getPost(answer.post.id)).trainingId, trainingId);
  assert.deepEqual(saved.review[0].knowledgePoints, ["一元一次方程"]);
  assert.equal((await store.getPost(answer.post.id)).review[0].result, "错误");
  await assert.rejects(store.saveReview(answer.post.id, [{ questionNo: "1", result: "看起来正确" }], true), /判定无效/);
});

test("rejects an order containing an unknown image", async (t) => {
  const { store } = await makeStore(t);
  const result = await store.createPost({ title: "顺序校验", images: [image(Buffer.from("one").toString("base64"))] });
  await assert.rejects(store.reorderPost(result.post.id, ["page-999.jpg"]), /页面顺序/);
});

test("does not resolve unlisted files or paths outside the post folder", async (t) => {
  const { store } = await makeStore(t);
  const result = await store.createPost({ title: "媒体路径", images: [image(Buffer.from("one").toString("base64"))] });
  assert.equal((await store.resolveImage(result.post.id, "page-001.jpg")).mime, "image/jpeg");
  await assert.rejects(store.resolveImage(result.post.id, "../../post.json"));
  await assert.rejects(store.resolveImage(result.post.id, "page-999.jpg"));
});

test("rejects non-image data and oversized images before writing a post", async (t) => {
  const { store } = await makeStore(t);
  await assert.rejects(store.createPost({ title: "坏格式", images: [{ mime: "application/pdf", base64: "AA==" }] }), /格式不支持/);
  const tooLarge = Buffer.alloc(16 * 1024 * 1024 + 1).toString("base64");
  await assert.rejects(store.createPost({ title: "大文件", images: [image(tooLarge)] }), /过大|超过/);
  assert.equal((await store.listPosts()).length, 0);
});

test("stores, summarizes, and updates the subject of a record", async (t) => {
  const { store } = await makeStore(t);
  const result = await store.createPost({ title: "八年级数学月考卷", subject: "数学", images: [image(Buffer.from("one").toString("base64"))] });
  assert.equal(result.post.subject, "数学");
  // 未指定科目时为空（未分类）
  const anonymous = await store.createPost({ title: "我的收藏", images: [image(Buffer.from("two").toString("base64"))] });
  assert.equal(anonymous.post.subject, "");
  // 更新科目
  const updated = await store.setSubject(anonymous.post.id, "物理");
  assert.equal(updated.subject, "物理");
  assert.equal((await store.getPost(anonymous.post.id)).subject, "物理");
  // 超长截断
  const truncated = await store.setSubject(anonymous.post.id, "x".repeat(50));
  assert.equal(truncated.subject, "x".repeat(20));
});

test("applies the default subject when none is provided", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-post-store-default-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new PostStore(root, { defaultSubject: "数学" });
  await store.initialize();
  const inferred = await store.createPost({ title: "八年级数学月考", subject: "数学", images: [image(Buffer.from("one").toString("base64"))] });
  assert.equal(inferred.post.subject, "数学");
  const defaulted = await store.createPost({ title: "无科目记录", images: [image(Buffer.from("two").toString("base64"))] });
  assert.equal(defaulted.post.subject, "数学");
});

test("auto-suffixes duplicate titles at creation within the same record type", async (t) => {
  const { store } = await makeStore(t);
  const first = await store.createPost({ title: "月考卷", images: [image(Buffer.from("one").toString("base64"))] });
  assert.equal(first.post.title, "月考卷");
  const second = await store.createPost({ title: "月考卷", images: [image(Buffer.from("two").toString("base64"))] });
  assert.equal(second.post.title, "月考卷（2）");
  const third = await store.createPost({ title: "月考卷", images: [image(Buffer.from("three").toString("base64"))] });
  assert.equal(third.post.title, "月考卷（3）");
  // 手动带序号的标题也会跳到下一个可用序号
  const manual = await store.createPost({ title: "月考卷（2）", images: [image(Buffer.from("four").toString("base64"))] });
  assert.equal(manual.post.title, "月考卷（4）");
  // 帖子与作答是两个独立列表，互不影响
  const answer = await store.createPost({ recordType: "answer", title: "月考卷", images: [image(Buffer.from("answer").toString("base64"))] });
  assert.equal(answer.post.title, "月考卷");
});

test("re-collecting the same note refreshes stored page bytes for higher quality", async (t) => {
  const { root, store } = await makeStore(t);
  const payload = {
    title: "画质提升卷",
    noteId: "quality-note",
    expectedImages: 1,
    images: [{ ...image(Buffer.from("low-quality-bytes").toString("base64")), sourceIndex: 0 }]
  };
  const first = await store.createPost(payload);
  const pageFile = path.join(root, first.post.id, "page-001.jpg");
  assert.equal((await fs.readFile(pageFile)).toString(), "low-quality-bytes");

  // 重新采集：同笔记、更高画质的字节 → 就地刷新，元数据保留
  const better = { ...payload, images: [{ ...image(Buffer.from("high-quality-bytes-with-more-detail").toString("base64")), sourceIndex: 0 }] };
  const again = await store.createPost(better);
  assert.equal(again.duplicate, true);
  assert.equal(again.updated, 1);
  assert.equal((await fs.readFile(pageFile)).toString(), "high-quality-bytes-with-more-detail");
  assert.equal(again.post.pages, 1);
  assert.equal(again.post.pageOrder.join(","), "page-001.jpg");

  // 再采集相同字节 → 无需更新
  const same = await store.createPost(better);
  assert.equal(same.updated, 0);
});
