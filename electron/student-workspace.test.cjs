const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { StudentStore } = require('./student-store.cjs');
const { StudentWorkspace, scopedStore } = require('./student-workspace.cjs');
const { PostStore } = require('./post-store.cjs');
const { TrainingStore } = require('./training-store.cjs');
const { createBackup, restoreBackup } = require('./backup-service.cjs');
const { deriveLearningStats } = require('./learning-stats.cjs');

const image = { mime: 'image/png', base64: Buffer.from('synthetic-image').toString('base64'), width: 20, height: 20 };
const practice = { topic: '方程', questions: [{ prompt: '1+1=?', answer: '2' }] };
async function fixture(t, initialize = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'student-workspace-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const students = new StudentStore(root), posts = new PostStore(path.join(root, 'posts')), answers = new PostStore(path.join(root, 'answers')), trainings = new TrainingStore(path.join(root, 'trainings'));
  await Promise.all([students.initialize(), posts.initialize(), answers.initialize(), trainings.initialize()]);
  const workspace = new StudentWorkspace(root, students, posts, answers, trainings);
  if (initialize) await workspace.initialize();
  return { root, students, posts, answers, trainings, workspace };
}

test('a current student is persisted and invalid/empty selections are rejected', async t => {
  const f = await fixture(t); const a = f.workspace.activeId;
  const b = await f.students.create('乙'); await f.workspace.select(b.id);
  const reopened = new StudentWorkspace(f.root, f.students, f.posts, f.answers, f.trainings);
  await reopened.initialize(); assert.equal(reopened.activeId, b.id);
  await assert.rejects(reopened.select(null), /有效学生/);
  await assert.rejects(reopened.select('missing'), /有效学生/);
  await reopened.select(a); assert.equal(reopened.activeId, a);
});

test('posts, answers, training, image reads and mutations enforce current ownership', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; const b = await f.students.create('乙');
  const posts = scopedStore(f.posts, () => f.workspace.activeId);
  const answers = scopedStore(f.answers, () => f.workspace.activeId);
  const trainings = scopedStore(f.trainings, () => f.workspace.activeId, 'training');
  const p = (await posts.createPost({ title: '甲试卷', studentId: b.id, images: [image] })).post;
  const r = (await answers.createPost({ recordType: 'answer', title: '甲作答', images: [image] })).post;
  const training = await trainings.create({ ...practice, studentId: b.id });
  assert.equal(p.studentId, a); assert.equal(training.studentId, a);
  await answers.saveReview(r.id, [{ questionNo: '1', result: '错误', errorType: '计算', knowledgePoints: ['甲知识点'] }], true);
  assert.equal(deriveLearningStats(await Promise.all((await answers.listPosts()).map(row => answers.getPost(row.id)))).mistakes.length, 1);
  await f.workspace.select(b.id);
  assert.deepEqual(await posts.listPosts(), []); assert.deepEqual(await answers.listPosts(), []); assert.deepEqual(await trainings.list(), []);
  assert.equal(deriveLearningStats(await answers.listPosts()).questionCount, 0);
  for (const task of [() => posts.getPost(p.id), () => posts.renamePost(p.id, 'changed'), () => posts.deletePost(p.id), () => posts.resolveImage(p.id, p.pageOrder[0]), () => answers.saveReview(r.id, [], true), () => trainings.setStatus(training.id, 'approved')]) await assert.rejects(task(), /不属于当前学生/);
  assert.equal((await f.posts.getPost(p.id)).title, '甲试卷');
  await f.workspace.select(a); assert.equal((await posts.listPosts()).length, 1);
  await assert.rejects(posts.setStudent(p.id, b.id), /切换学生/);
});

test('collection deduplication and titles do not leak between two students', async t => {
  const f = await fixture(t); const b = await f.students.create('乙'); const store = scopedStore(f.posts, () => f.workspace.activeId);
  const payload = { title: '同一份试卷', source: '小红书采集', noteId: 'note123', images: [image] };
  const one = await store.createPost(payload); await f.workspace.select(b.id);
  const two = await store.createPost(payload); assert.equal(two.duplicate, false); assert.notEqual(one.post.id, two.post.id); assert.equal(two.post.title, payload.title);
  assert.equal((await store.createPost(payload)).duplicate, true);
});

test('legacy unassigned data migrates idempotently into a separate historical student', async t => {
  const f = await fixture(t, false);
  const old = (await f.posts.createPost({ title: '旧试卷', images: [image] })).post;
  const training = await f.trainings.create(practice);
  await f.workspace.initialize();
  const historical = (await f.students.list()).find(row => row.legacy);
  assert.ok(historical); assert.equal((await f.posts.getPost(old.id)).studentId, historical.id); assert.equal((await f.trainings.get(training.id)).studentId, historical.id);
  await f.workspace.initialize(); assert.equal((await f.students.list()).length, 1);
  assert.equal((await f.posts.getPost(old.id)).images.length, 1);
});

test('students with records and the final student cannot be removed', async t => {
  const f = await fixture(t); await assert.rejects(f.workspace.remove(f.workspace.activeId), /至少保留/);
  const b = await f.students.create('乙');
  await f.posts.createPost({ title: '资料', studentId: f.workspace.activeId, images: [image] });
  await assert.rejects(f.workspace.remove(f.workspace.activeId), /仍有学习资料/);
  await f.workspace.remove(b.id); assert.equal((await f.students.list()).length, 1);
});

test('backup restores students, active selection, record ownership and learning data together', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; const b = await f.students.create('乙');
  await f.posts.createPost({ title: '甲资料', studentId: a, images: [image] });
  await f.answers.createPost({ title: '乙作答', recordType: 'answer', studentId: b.id, images: [image] });
  await f.workspace.select(b.id);
  const archive = path.join(f.root, 'backup.tar.gz'); await createBackup(f.root, archive);
  await f.students.rename(b.id, '被修改'); await f.workspace.select(a);
  await restoreBackup(archive, f.root); await f.workspace.initialize();
  assert.equal(f.workspace.activeId, b.id); assert.equal((await f.students.list()).find(s => s.id === b.id).name, '乙');
  assert.equal((await scopedStore(f.answers, () => b.id).listPosts()).length, 1);
  assert.equal((await scopedStore(f.posts, () => b.id).listPosts()).length, 0);
});

test('legacy backups without a roster replace stale local contexts and recover ownership', async t => {
  const legacy = await fixture(t, false);
  await legacy.posts.createPost({ title: '旧资料', images: [image] });
  const archive = path.join(legacy.root, 'legacy.tar.gz'); await createBackup(legacy.root, archive);
  const target = await fixture(t); const oldId = target.workspace.activeId;
  await restoreBackup(archive, target.root); await target.workspace.initialize();
  assert.notEqual(target.workspace.activeId, oldId); assert.equal((await target.students.list()).length, 1);
  assert.equal((await scopedStore(target.posts, () => target.workspace.activeId).listPosts()).length, 1);
});

test('an operation already started keeps its owner when the active student changes', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; const b = await f.students.create('乙');
  let release; const original = f.posts.createPost.bind(f.posts);
  f.posts.createPost = async payload => { await new Promise(resolve => { release = resolve; }); return original(payload); };
  const pending = scopedStore(f.posts, () => f.workspace.activeId).createPost({ title: '进行中的导入', images: [image] });
  await f.workspace.select(b.id); release(); const result = await pending;
  assert.equal(result.post.studentId, a);
});

test('a failed selection write keeps the prior current student', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; const b = await f.students.create('乙');
  f.workspace.save = async () => { throw new Error('disk full'); };
  await assert.rejects(f.workspace.select(b.id), /disk full/); assert.equal(f.workspace.activeId, a);
});

test('historical cross-student training links are detached without losing the answer review', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; const b = await f.students.create('乙');
  const training = await f.trainings.create({ ...practice, studentId: b.id });
  const answer = (await f.answers.createPost({ recordType: 'answer', studentId: a, title: '旧关联', images: [image] })).post;
  await f.answers.saveReview(answer.id, [{ questionNo: '1', result: '正确' }], true, training.id);
  await f.workspace.initialize(); const fixed = await f.answers.getPost(answer.id);
  assert.equal(fixed.trainingId, ''); assert.equal(fixed.review[0].result, '正确');
});

test('removing the current empty student cannot implicitly switch the workspace', async t => {
  const f = await fixture(t); const a = f.workspace.activeId; await f.students.create('乙');
  await assert.rejects(f.workspace.remove(a), /先切换/); assert.equal(f.workspace.activeId, a);
});

test('corrupt roster or invalid active student in a backup leaves the existing workspace intact', async t => {
  const source = await fixture(t); const target = await fixture(t);
  const original = await target.students.list(); const active = target.workspace.activeId;
  const rosterPath = path.join(source.root, 'students.json'); const roster = await source.students.list();
  await fs.writeFile(rosterPath, '{broken');
  const archive = path.join(source.root, 'bad-roster.tar.gz'); await createBackup(source.root, archive);
  await assert.rejects(restoreBackup(archive, target.root));
  assert.deepEqual(await target.students.list(), original);
  await fs.writeFile(rosterPath, JSON.stringify(roster));
  await fs.writeFile(source.workspace.file, JSON.stringify({ schemaVersion: 1, activeStudentId: 'missing' }));
  const badActive = path.join(source.root, 'bad-active.tar.gz'); await createBackup(source.root, badActive);
  await assert.rejects(restoreBackup(badActive, target.root), /当前学生无效/);
  await target.workspace.initialize(); assert.equal(target.workspace.activeId, active);
});
