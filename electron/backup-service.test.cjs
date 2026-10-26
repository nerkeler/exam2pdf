const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { createBackup, restoreBackup, validateEntryPath } = require("./backup-service.cjs");
const { PostStore } = require("./post-store.cjs");

test("rejects empty and truncated archives without clearing the current library", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-truncated-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const current = path.join(root, "current", "library");
  const currentPosts = new PostStore(path.join(current, "posts"));
  await currentPosts.initialize();
  const saved = await currentPosts.createPost({ title: "保留数据", images: [{ mime: "image/jpeg", base64: Buffer.from("preserved").toString("base64") }] });
  const complete = path.join(root, "complete.tar.gz");
  await createBackup(path.join(root, "empty-source"), complete);
  const completeTar = zlib.gunzipSync(await fs.readFile(complete));
  for (const [name, tar] of [
    ["empty", Buffer.alloc(0)],
    ["no-roots", Buffer.alloc(1024)],
    ["no-ending", completeTar.subarray(0, completeTar.length - 1024)],
    ["half-ending", completeTar.subarray(0, completeTar.length - 512)]
  ]) {
    const archive = path.join(root, name + ".tar.gz");
    await fs.writeFile(archive, zlib.gzipSync(tar));
    await assert.rejects(restoreBackup(archive, current), /不完整|缺少/);
    assert.equal((await currentPosts.getPost(saved.post.id)).title, "保留数据");
  }
});

test("does not delete an existing backup when refusing to overwrite it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-no-overwrite-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = path.join(root, "library");
  const backupPath = path.join(root, "existing.tar.gz");
  const original = Buffer.from("keep this existing backup");
  await fs.writeFile(backupPath, original);

  await assert.rejects(createBackup(library, backupPath), { code: "EEXIST" });
  assert.deepEqual(await fs.readFile(backupPath), original);
});

test("replaces an existing backup only after a complete temporary archive is written", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-replace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = path.join(root, "library");
  const backupPath = path.join(root, "backup.tar.gz");
  await fs.writeFile(backupPath, "old backup");

  const result = await createBackup(library, backupPath, null, { overwrite: true });
  const archive = await fs.readFile(backupPath);
  assert.equal(result.filePath, backupPath);
  assert.ok(result.bytes > 10);
  assert.ok(zlib.gunzipSync(archive).length >= 1024);
  assert.deepEqual(await fs.readdir(root), ["backup.tar.gz", "library"]);
});

test("preserves supplemental pages and missing source pages across backup restore", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-supplemental-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const sourcePosts = new PostStore(path.join(sourceLibrary, "posts"));
  await sourcePosts.initialize();
  const collected = await sourcePosts.createPost({
    title: "有缺页的试卷",
    noteId: "supplemental-backup-note",
    expectedImages: 3,
    images: [
      { mime: "image/jpeg", base64: Buffer.from("source-page-one").toString("base64"), sourceIndex: 0 },
      { mime: "image/jpeg", base64: Buffer.from("source-page-three").toString("base64"), sourceIndex: 2 }
    ]
  });
  await sourcePosts.appendPostImages(collected.post.id, [{
    mime: "image/png",
    base64: Buffer.from("supplemental-page").toString("base64")
  }]);

  const backupPath = path.join(root, "supplemental.tar.gz");
  await createBackup(sourceLibrary, backupPath);
  const restoredLibrary = path.join(root, "restored", "library");
  await restoreBackup(backupPath, restoredLibrary);

  const restoredPosts = new PostStore(path.join(restoredLibrary, "posts"));
  const restored = await restoredPosts.getPost(collected.post.id);
  assert.equal(restored.expectedImages, 3);
  assert.equal(restored.sourcePageCount, 2);
  assert.equal(restored.supplementalImages, 1);
  assert.equal(restored.missingImages, 1);
  assert.deepEqual(restored.pageOrder, ["page-001.jpg", "page-003.jpg", "page-004.png"]);
  assert.equal(restored.images.find((image) => image.supplemental)?.sourceIndex, null);
  assert.equal(
    await fs.readFile(path.join(restoredLibrary, "posts", collected.post.id, "page-004.png"), "utf8"),
    "supplemental-page"
  );
});

test("accepts a backup whose print order is a subset of the collected images", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-subset-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const sourcePosts = new PostStore(path.join(sourceLibrary, "posts"));
  await sourcePosts.initialize();
  const collected = await sourcePosts.createPost({
    title: "有移除页的试卷",
    images: [
      { mime: "image/jpeg", base64: Buffer.from("page-one").toString("base64"), sourceIndex: 0 },
      { mime: "image/jpeg", base64: Buffer.from("page-two").toString("base64"), sourceIndex: 1 }
    ]
  });
  await sourcePosts.removePostPage(collected.post.id, "page-002.jpg");

  const backupPath = path.join(root, "subset.tar.gz");
  await createBackup(sourceLibrary, backupPath);
  const restoredLibrary = path.join(root, "restored", "library");
  await restoreBackup(backupPath, restoredLibrary);

  const restored = await new PostStore(path.join(restoredLibrary, "posts")).getPost(collected.post.id);
  assert.deepEqual(restored.pageOrder, ["page-001.jpg"]);
  assert.equal(restored.removedImages, 1);
  // 被移除页的原始文件随备份一起保留
  await fs.access(path.join(restoredLibrary, "posts", collected.post.id, "page-002.jpg"));
});

test("backs up and restores posts, answers, and training history", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const userData = path.join(root, "userdata");
  const library = path.join(userData, "library");
  const postId = "d3f8b328-279d-47ab-8f53-20c38759565a";
  const answerId = "f2e4801a-a607-44ec-97c8-6533c51229f6";
  const trainingId = "a2f4801a-a607-44ec-97c8-6533c51229f6";
  for (const [category, id, title] of [["posts", postId, "采集试卷"], ["answers", answerId, "学生作答"]]) {
    const recordDir = path.join(library, category, id);
    await fs.mkdir(recordDir, { recursive: true });
    await fs.writeFile(path.join(recordDir, "page-001.jpg"), Buffer.from(category));
    await fs.writeFile(path.join(recordDir, "post.json"), JSON.stringify({ id, title, recordType: category === "answers" ? "answer" : "post", images: [{ file: "page-001.jpg" }], pageOrder: ["page-001.jpg"] }));
  }
  const trainingsDir = path.join(library, "trainings");
  await fs.mkdir(trainingsDir, { recursive: true });
  await fs.writeFile(path.join(trainingsDir, "history.json"), JSON.stringify([{
    id: trainingId, topic: "有理数运算", source: "本地基础题型模板", createdAt: new Date().toISOString(), status: "approved",
    questions: [{ prompt: "计算：1 + 2", answer: "3" }]
  }]));
  const backupPath = path.join(root, "backup.tar.gz");
  const profile = { schemaVersion: 1, provider: "qwen", model: "qwen-vl-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
  const result = await createBackup(library, backupPath, profile);
  assert.ok(result.entries >= 7);
  await fs.rm(path.join(library, "posts", postId), { recursive: true });
  await fs.writeFile(path.join(library, "answers", answerId, "post.json"), "corrupted");

  const restored = await restoreBackup(backupPath, library);
  assert.equal(restored.restoredRecords, 3);
  assert.deepEqual(restored.settingsProfile, profile);
  assert.equal(await fs.access(path.join(library, "settings", "ai-settings.json")).then(() => true, () => false), false);
  assert.equal(await fs.readFile(path.join(library, "posts", postId, "page-001.jpg"), "utf8"), "posts");
  assert.equal(await fs.readFile(path.join(library, "answers", answerId, "page-001.jpg"), "utf8"), "answers");
  assert.equal(JSON.parse(await fs.readFile(path.join(library, "answers", answerId, "post.json"), "utf8")).title, "学生作答");
  assert.equal(JSON.parse(await fs.readFile(path.join(library, "trainings", "history.json"), "utf8"))[0].id, trainingId);
});

test("rejects archive paths that escape or include unsupported data", () => {
  assert.equal(validateEntryPath("posts/record/page-001.jpg"), "posts/record/page-001.jpg");
  assert.equal(validateEntryPath("trainings/history.json"), "trainings/history.json");
  assert.equal(validateEntryPath("settings/ai-settings.json"), "settings/ai-settings.json");
  assert.throws(() => validateEntryPath("../secrets"), /无效路径|越界路径/);
  assert.throws(() => validateEntryPath("answers\\record\\post.json"), /无效路径/);
  assert.throws(() => validateEntryPath("settings.json"), /不支持的数据目录/);
  assert.throws(() => validateEntryPath("settings/api-key.txt"), /不支持的数据目录/);
});

test("rejects AI settings backups that contain secrets or invalid endpoints", async (t) => {
  const { validateAiSettingsProfile, createBackup } = require("./backup-service.cjs");
  assert.throws(() => validateAiSettingsProfile({ schemaVersion: 1, provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "secret" }), /格式无效/);
  assert.throws(() => validateAiSettingsProfile({ schemaVersion: 1, provider: "deepseek", model: "deepseek-chat", baseUrl: "http://api.deepseek.com/v1" }), /HTTPS/);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-settings-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(createBackup(path.join(root, "library"), path.join(root, "invalid.tar.gz"), {
    schemaVersion: 1, provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "secret"
  }), /格式无效/);
});

test("keeps the current library when the selected backup contains invalid record data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const targetLibrary = path.join(root, "target", "library");
  const sourceId = "d3f8b328-279d-47ab-8f53-20c38759565a";
  const targetId = "f2e4801a-a607-44ec-97c8-6533c51229f6";
  const sourceRecord = path.join(sourceLibrary, "posts", sourceId);
  const targetRecord = path.join(targetLibrary, "posts", targetId);
  await fs.mkdir(sourceRecord, { recursive: true });
  await fs.writeFile(path.join(sourceRecord, "post.json"), "not json");
  await fs.mkdir(targetRecord, { recursive: true });
  await fs.writeFile(path.join(targetRecord, "post.json"), JSON.stringify({ id: targetId, images: [], pageOrder: [] }));
  const backupPath = path.join(root, "bad.tar.gz");
  await createBackup(sourceLibrary, backupPath);

  await assert.rejects(restoreBackup(backupPath, targetLibrary), /JSON|Unexpected|损坏/);
  assert.equal(await fs.readFile(path.join(targetRecord, "post.json"), "utf8"), JSON.stringify({ id: targetId, images: [], pageOrder: [] }));
});

test("restores older backups without training history as an empty history", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-backup-legacy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const targetLibrary = path.join(root, "target", "library");
  const backupPath = path.join(root, "legacy.tar.gz");
  await createBackup(sourceLibrary, backupPath);
  const restored = await restoreBackup(backupPath, targetLibrary);
  assert.equal(restored.restoredRecords, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(targetLibrary, "trainings", "history.json"), "utf8")), []);
});

test("keeps the current library when training history in a backup is invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-training-backup-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const targetLibrary = path.join(root, "target", "library");
  const sourceTrainings = path.join(sourceLibrary, "trainings");
  const targetTrainings = path.join(targetLibrary, "trainings");
  await fs.mkdir(sourceTrainings, { recursive: true });
  await fs.writeFile(path.join(sourceTrainings, "history.json"), JSON.stringify([{ id: "bad-id", status: "draft", questions: [] }]));
  await fs.mkdir(targetTrainings, { recursive: true });
  const preserved = JSON.stringify([{ sentinel: true }]);
  await fs.writeFile(path.join(targetTrainings, "history.json"), preserved);
  const backupPath = path.join(root, "bad-training.tar.gz");
  await createBackup(sourceLibrary, backupPath);

  await assert.rejects(restoreBackup(backupPath, targetLibrary), /无效的训练记录/);
  assert.equal(await fs.readFile(path.join(targetTrainings, "history.json"), "utf8"), preserved);
});

test("rejects a backup whose answer references a missing training session", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-training-link-backup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceLibrary = path.join(root, "source", "library");
  const targetLibrary = path.join(root, "target", "library");
  const answerId = "f2e4801a-a607-44ec-97c8-6533c51229f6";
  const missingTrainingId = "a2f4801a-a607-44ec-97c8-6533c51229f6";
  const answerDirectory = path.join(sourceLibrary, "answers", answerId);
  await fs.mkdir(answerDirectory, { recursive: true });
  await fs.writeFile(path.join(answerDirectory, "post.json"), JSON.stringify({
    id: answerId, recordType: "answer", trainingId: missingTrainingId, images: [], pageOrder: []
  }));
  const targetTrainings = path.join(targetLibrary, "trainings");
  await fs.mkdir(targetTrainings, { recursive: true });
  const preserved = "[]\n";
  await fs.writeFile(path.join(targetTrainings, "history.json"), preserved);
  const backupPath = path.join(root, "broken-link.tar.gz");
  await createBackup(sourceLibrary, backupPath);

  await assert.rejects(restoreBackup(backupPath, targetLibrary), /不存在或未审核/);
  assert.equal(await fs.readFile(path.join(targetTrainings, "history.json"), "utf8"), preserved);
});
