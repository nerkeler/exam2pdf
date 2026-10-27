const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("student roster is exposed over IPC and feeds collection attribution", () => {
  const main = read("electron", "main.cjs");
  const preload = read("electron", "preload.cjs");
  assert.match(main, /appHandle\("students:list"/);
  assert.match(main, /appHandle\("students:create"/);
  assert.match(main, /appHandle\("students:rename"/);
  assert.match(main, /appHandle\("students:remove"/);
  assert.match(main, /appHandle\("students:set-active"/);
  assert.match(main, /appHandle\("posts:set-student"/);
  // 采集与手机上传归属到当前选中的学生
  assert.match(main, /input\.studentId = activeStudentId/);
  assert.match(main, /getStudentId: \(\) => activeStudentId/);
  // 移除学生后清空激活引用，避免悬空归属
  assert.match(main, /if \(activeStudentId === id\) activeStudentId = null;/);
  assert.match(preload, /listStudents\(\)[\s\S]*?students:list/);
  assert.match(preload, /setActiveStudent\(id\)[\s\S]*?students:set-active/);
  assert.match(preload, /onStudentsChanged\(callback\)[\s\S]*?students:changed/);
  assert.match(preload, /setPostStudent\(id, studentId\)[\s\S]*?posts:set-student/);
});

test("workspace wires the roster UI to the desktop bridge", () => {
  const html = read("docs", "原型图.html");
  assert.match(html, /id="studentDialog"/);
  assert.match(html, /data-action="manage-students"/);
  assert.match(html, /data-action="add-student"/);
  assert.match(html, /data-action="rename-student"/);
  assert.match(html, /data-action="remove-student"/);
  // 当前学生持久化并在启动时恢复
  assert.match(html, /localStorage\.setItem\("exam2pdf-active-student"/);
  assert.match(html, /localStorage\.getItem\("exam2pdf-active-student"\)/);
  // 采集归属依赖渲染层同步的当前学生；作答保存携带 studentId
  assert.match(html, /generated\.studentId = state\.activeStudentId/);
  assert.match(html, /desktop\.createAnswer\(\{ title, studentName, studentId, subject, images: state\.gradePages \}\)/);
  // 名册变化后刷新列表中学生标签
  assert.match(html, /desktop\.onStudentsChanged\(\(\) => \{ void loadStudents\(\); \}\)/);
});

test("posts and trainings persist studentId on create and reassignment", () => {
  const postStore = read("electron", "post-store.cjs");
  const trainingStore = read("electron", "training-store.cjs");
  assert.match(postStore, /studentId: typeof input\.studentId === "string" && UUID_PATTERN\.test\(input\.studentId\) \? input\.studentId : null/);
  assert.match(postStore, /async setStudent\(id, studentId\)/);
  assert.match(postStore, /studentId: post\.studentId \|\| null/);
  assert.match(trainingStore, /const studentId = typeof input\.studentId === "string" && UUID_PATTERN\.test\(input\.studentId\) \? input\.studentId : null/);
});
