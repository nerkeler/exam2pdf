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
  assert.doesNotMatch(main, /appHandle\("posts:set-student"/);
  // 采集与手机上传归属到当前选中的学生
  assert.match(main, /input\.studentId = activeStudentId/);
  assert.match(main, /getStudentId: \(\) => studentId/);
  // 移除学生后清空激活引用，避免悬空归属
  assert.match(main, /studentWorkspace\.remove\(id\)/);
  assert.match(preload, /listStudents\(\)[\s\S]*?students:list/);
  assert.match(preload, /setActiveStudent\(id\)[\s\S]*?students:set-active/);
  assert.match(preload, /onStudentsChanged\(callback\)[\s\S]*?students:changed/);
  assert.doesNotMatch(preload, /setPostStudent\(/);
});

test("workspace wires the roster UI to the desktop bridge", () => {
  const html = read("docs", "原型图.html");
  assert.match(html, /id="studentDialog"/);
  assert.match(html, /data-action="manage-students"/);
  assert.match(html, /data-action="add-student"/);
  assert.match(html, /data-action="rename-student"/);
  assert.match(html, /data-action="remove-student"/);
  assert.match(html, /desktop\.getStudentContext\(\)/);
  assert.match(html, /desktop\.setActiveStudent\(id\)/);
  assert.doesNotMatch(html, /id="postStudent"|id="gradeStudentSelect"|id="gradeStudent"/);
  assert.match(html, /frontend\/student-focus\.js/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.build.files.includes("frontend/student-focus.js"));
});

test("posts and trainings persist studentId on create and reassignment", () => {
  const postStore = read("electron", "post-store.cjs");
  const trainingStore = read("electron", "training-store.cjs");
  assert.match(postStore, /studentId: typeof input\.studentId === "string" && UUID_PATTERN\.test\(input\.studentId\) \? input\.studentId : null/);
  assert.match(postStore, /async setStudent\(id, studentId\)/);
  assert.match(postStore, /studentId: post\.studentId \|\| null/);
  assert.match(trainingStore, /const studentId = typeof input\.studentId === "string" && UUID_PATTERN\.test\(input\.studentId\) \? input\.studentId : null/);
});
