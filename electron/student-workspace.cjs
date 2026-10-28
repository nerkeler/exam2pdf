const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { UUID_PATTERN } = require('./training-store.cjs');

// All record ownership is enforced here, independently of renderer filtering.
function scopedStore(store, getStudentId, kind = 'post') {
  const get = kind === 'training' ? 'get' : 'getPost';
  const list = kind === 'training' ? 'list' : 'listPosts';
  const create = kind === 'training' ? 'create' : 'createPost';
  const guarded = new Set(kind === 'training' ? ['get', 'setStatus'] : [
    'getPost', 'readPost', 'renamePost', 'reorderPost', 'appendPostImages', 'removePostPage',
    'setSubject', 'setStudent', 'resetPostOrder', 'deletePost', 'saveReview', 'resolveImage'
  ]);
  const owner = () => {
    const id = getStudentId();
    if (!id) throw new Error('请先选择当前学生');
    return id;
  };
  return new Proxy(store, { get(target, key) {
    if (key === list) return async (...args) => {
      const id = owner();
      return (await target[list](...args)).filter(record => record.studentId === id);
    };
    if (key === create) return input => {
      const id = owner();
      return target[create]({ ...input, studentId: id });
    };
    if (guarded.has(key)) return async (id, ...args) => {
      const studentId = owner();
      const record = await target[get](id);
      if (record.studentId !== studentId) throw new Error('这份资料不属于当前学生，请切换学生后查看');
      if (key === 'setStudent' && args[0] !== studentId) throw new Error('请通过侧边栏切换学生，不能在资料页面更改归属');
      return target[key](id, ...args);
    };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

class StudentWorkspace {
  constructor(root, students, posts, answers, trainings) {
    Object.assign(this, { root, students, posts, answers, trainings });
    this.file = path.join(root, 'workspace.json');
    this.activeId = null;
  }
  async records() {
    const [posts, answers, trainings] = await Promise.all([this.posts.listPosts(), this.answers.listPosts(), this.trainings.list()]);
    return { posts, answers, trainings };
  }
  // Called before opening the window, or while all store write queues are reserved.
  // Old unassigned records are preserved under a separate historical student.
  async initialize() {
    let roster = await this.students.list();
    const records = await this.records();
    const all = [...records.posts, ...records.answers, ...records.trainings];
    const ids = new Set(roster.map(student => student.id));
    let changed = false;
    for (const record of all) {
      if (UUID_PATTERN.test(record.studentId || '') && !ids.has(record.studentId)) {
        roster.push({ id: record.studentId, name: '历史学生 ' + (roster.length + 1), createdAt: new Date().toISOString() });
        ids.add(record.studentId); changed = true;
      }
    }
    const unassigned = all.filter(record => !UUID_PATTERN.test(record.studentId || ''));
    let historical;
    if (unassigned.length) {
      historical = roster.find(student => student.legacy === true);
      if (!historical) {
        historical = { id: randomUUID(), name: '历史资料', legacy: true, createdAt: new Date().toISOString() };
        while (roster.some(student => student.name === historical.name)) historical.name += '（导入）';
        roster.push(historical); changed = true;
      }
    }
    if (!roster.length) { roster.push({ id: randomUUID(), name: '我的学生', createdAt: new Date().toISOString() }); changed = true; }
    // Save the roster first. Interrupted migration can resume without losing ownership.
    if (changed) await this.students.writeAll(roster);
    if (historical) {
      for (const [store, rows] of [[this.posts, records.posts], [this.answers, records.answers]]) {
        for (const row of rows.filter(record => !UUID_PATTERN.test(record.studentId || ''))) {
          const record = await store.getPost(row.id); record.studentId = historical.id; await store.writePost(record);
        }
      }
      if (records.trainings.some(record => !UUID_PATTERN.test(record.studentId || ''))) {
        await this.trainings.writeAll(records.trainings.map(record => !UUID_PATTERN.test(record.studentId || '') ? { ...record, studentId: historical.id } : record));
      }
    }
    const trainingOwners = new Map((await this.trainings.list()).map(record => [record.id, record]));
    for (const row of await this.answers.listPosts()) {
      const training = trainingOwners.get(row.trainingId);
      if (row.trainingId && (!training || training.studentId !== row.studentId)) {
        const record = await this.answers.getPost(row.id);
        record.trainingId = null; await this.answers.writePost(record);
      }
    }
    let saved;
    try { saved = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.activeId = roster.some(student => student.id === saved?.activeStudentId) ? saved.activeStudentId : (historical?.id || roster[0].id);
    await this.save();
    return this.context();
  }
  async save() {
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporary, JSON.stringify({ schemaVersion: 1, activeStudentId: this.activeId }) + '\n', { flag: 'wx' });
    await fs.rename(temporary, this.file);
  }
  async context() { return { studentId: this.activeId, students: await this.students.list() }; }
  async select(id) {
    if (!(await this.students.list()).some(student => student.id === id)) throw new Error('请选择有效学生');
    const previous = this.activeId; this.activeId = id;
    try { await this.save(); } catch (error) { this.activeId = previous; throw error; }
    return this.context();
  }
  async remove(id) {
    const roster = await this.students.list();
    if (roster.length <= 1) throw new Error('至少保留一位学生，可直接修改姓名');
    const rows = await this.records();
    if (Object.values(rows).flat().some(record => record.studentId === id)) throw new Error('该学生仍有学习资料，请先切换到该学生处理资料，不能直接移除');
    if (this.activeId === id) throw new Error('请先切换到另一位学生，再移除当前学生');
    // Main reserves the roster write queue; do not enqueue another write inside it.
    const next = roster.filter(student => student.id !== id);
    if (next.length === roster.length) throw new Error('找不到这个学生');
    await this.students.writeAll(next);
    return this.context();
  }
}
module.exports = { StudentWorkspace, scopedStore };
