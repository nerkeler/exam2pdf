const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async function studentChecks(win, pass, options) {
  const { waitFor, dialog, directory, overlay, setDestination } = options;
  const js = code => win.webContents.executeJavaScript(code);
  const idle = () => waitFor(() => js('state.studentReady && !studentFocus.pending && !studentFocus.changing && !desktop.isStudentBusy()'), 'student context is idle');
  await idle();
  const avatarOriginal = await js('studentById(state.activeStudentId)');
  await js(`desktop.renameStudent(${JSON.stringify(avatarOriginal.id)}, "头像验收学生", "female")`);
  await js('loadStudents()');
  assert.equal(await js('document.getElementById("studentProfileName").textContent'), '头像验收学生');
  await js('document.querySelector("#studentAvatar img").decode()');
  assert.equal(await js('document.querySelector("#studentAvatar img").getAttribute("src")'), '../frontend/assets/avatars/student-girl.jpg');
  assert.equal(await js('document.querySelector("#studentAvatar img").naturalWidth'), 256);
  await js('document.getElementById("studentAvatarButton").click()');
  assert.equal(await js('document.getElementById("studentSwitchDialog").open'), true);
  await js('document.querySelector("#studentSwitchDialog [data-action=manage-students]").click()');
  assert.equal(await js('document.getElementById("studentDialog").open && !document.getElementById("studentSwitchDialog").open'), true);
  const originalPicker = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({canceled:false, filePaths:[path.resolve(__dirname, '../../frontend/assets/avatars/student-boy.jpg')]});
  await js('document.querySelector("#studentRoster [data-action=rename-student]").click()');
  await js('document.querySelector("[data-action=pick-student-avatar]").click()');
  await waitFor(() => js('Boolean(editingStudentAvatar)'), 'custom avatar selected');
  await js('document.querySelector("#studentAvatarPreview img").decode()');
  const customAvatar = await js('editingStudentAvatar');
  await js('addStudent()');
  assert.equal(await js('studentById(state.activeStudentId).avatar'), customAvatar);
  await js('document.querySelector("#studentAvatar img").decode()');
  assert.equal(await js('document.querySelector("#studentAvatar img").naturalWidth'), 256);
  await js('document.querySelector("#studentRoster [data-action=rename-student]").click()');
  dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]});
  await js('document.querySelector("[data-action=pick-student-avatar]").click()');
  await idle();
  assert.equal(await js('editingStudentAvatar'), customAvatar);
  await js('document.querySelector("[data-action=reset-student-avatar]").click(); addStudent()');
  assert.equal(await js('studentById(state.activeStudentId).avatar'), null);
  dialog.showOpenDialog = originalPicker;
  pass('Custom avatar picker, preview, persistence, cancellation and preset reset work');
  await js('document.getElementById("studentDialog").close()');
  await js(`desktop.renameStudent(${JSON.stringify(avatarOriginal.id)}, ${JSON.stringify(avatarOriginal.name)}, ${JSON.stringify(avatarOriginal.gender || "male")})`);
  await js('loadStudents()');
  pass('Student avatar, name, switch dialog and settings navigation update in Electron');
  await js('clearStudentWorkspace(); switchScreen("s0b");');
  const a = (await js('desktop.getStudentContext()')).studentId;
  const b = await js('desktop.createStudent("隔离验收乙")');
  await idle();
  const seed = await js(`(async () => {
    const image = {mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',width:1,height:1};
    const post = (await desktop.createPost({title:'甲专属试卷',studentId:${JSON.stringify(b.id)},images:[image]})).post;
    const answer = (await desktop.createAnswer({title:'甲专属作答',images:[image]})).post;
    await desktop.saveAnswerReview(answer.id,[{questionNo:'1',result:'错误',errorType:'计算',knowledgePoints:['甲的方程']}],true);
    const training = await desktop.saveTraining({topic:'甲专属练习',studentId:${JSON.stringify(b.id)},questions:[{prompt:'1+1=?',answer:'2'}]});
    return {post,answer,training};
  })()`);
  assert.equal(seed.post.studentId, a); assert.equal(seed.training.studentId, a);
  pass('New records force the current owner instead of trusting payload studentId');
  await idle();
  await js(`setActiveStudentSelection(${JSON.stringify(b.id)})`);
  await waitFor(() => js(`state.activeStudentId === ${JSON.stringify(b.id)} && state.posts.length === 0 && state.answers.length === 0`), 'switch to empty student B');
  const empty = await js('({posts:state.posts.length,answers:state.answers.length,mistakes:state.mistakes.length,trainings:state.trainingHistory.length,questions:state.learningStats.questionCount})');
  assert.deepEqual(empty, { posts: 0, answers: 0, mistakes: 0, trainings: 0, questions: 0 });
  pass('Student switching isolates all lists, mistakes, training and statistics', empty);
  await waitFor(() => overlay.webContents.executeJavaScript('document.getElementById(\"query\").value === \"\"'), 'B has separate search preferences');
  for (const expression of [
    `desktop.getPost(${JSON.stringify(seed.post.id)})`,
    `desktop.renamePost(${JSON.stringify(seed.post.id)},'不应修改')`,
    `desktop.deletePost(${JSON.stringify(seed.post.id)})`,
    `desktop.requestAiAnswerReview(${JSON.stringify(seed.answer.id)})`,
    `desktop.setTrainingStatus(${JSON.stringify(seed.training.id)},'approved')`
  ]) await assert.rejects(js(expression), /不属于当前学生/);
  const status = await js(`fetch('exam2pdf-media://${seed.post.id}/${seed.post.pageOrder[0]}').then(response=>response.status)`);
  assert.equal(status, 404);
  pass('Native IPC and media protocol deny cross-student reads, edits, AI requests and images');
  const bStats = await js(`(async () => {
    const images = [{mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',width:1,height:1}];
    await desktop.createPost({title:'乙专属试卷',studentId:${JSON.stringify(a)},images});
    const answer = (await desktop.createAnswer({title:'乙专属作答',images})).post;
    await desktop.saveAnswerReview(answer.id,[{questionNo:'1',result:'正确',knowledgePoints:['乙的几何']}],true);
    const stats = await desktop.getLearningStats();
    return {accuracy:stats.accuracy,questions:stats.questionCount,mistakes:stats.mistakes.length};
  })()`);
  assert.deepEqual(bStats, {accuracy:100,questions:1,mistakes:0});
  await idle();
  assert.equal(await js('document.getElementById("postList").textContent.includes("甲专属试卷")'), false);
  pass('Two populated students keep distinct records and different learning results', bStats);


  await js(`state.gradePages=[{name:'尚未保存'}]; state.currentAnswer=null; state.reviewDraft=[];`);
  const canceled = await js(`(async () => { const original=confirmAction; confirmAction=async()=>false; try { await setActiveStudentSelection(${JSON.stringify(a)}); return {id:state.activeStudentId,draft:state.gradePages.length}; } finally {confirmAction=original;} })()`);
  assert.equal(canceled.id, b.id); assert.equal(canceled.draft, 1);
  await js(`(async () => { const original=confirmAction; confirmAction=async()=>true; try { await setActiveStudentSelection(${JSON.stringify(a)}); } finally {confirmAction=original;} })()`);
  assert.equal(await js('state.gradePages.length'), 0);
  await waitFor(() => js('state.posts.length === 1 && state.learningStats.mistakes.length === 1'), 'restored student A data');
  pass('Unsaved draft switching supports cancel and confirmed clearing without deleting saved data');
  await js('switchScreen("s6")');
  assert.equal(await js('document.getElementById("statMistakes").textContent'), '1 道');
  assert.equal(await js('document.querySelector("#postStudent, #gradeStudentSelect, #gradeStudent") === null'), true);
  pass('Current-student statistics are correct and per-record student selectors are removed');
  await waitFor(() => overlay.webContents.executeJavaScript('document.getElementById(\"query\").value === \"八年级 数学\"'), 'A search preferences restored');
  pass('Search helper preferences follow each student instead of sharing a global grade');

  await idle();
  const uploadSessions = await js('Promise.all([desktop.startMobileUpload(), desktop.startMobileUpload()])');
  assert.deepEqual(uploadSessions[0], uploadSessions[1]);
  await js('(async () => renderMobileUpload(await desktop.getMobileUploadState()))()');
  const qr = await js(`(async () => {
    const images = [...document.querySelectorAll('#uploadQrCodes img')];
    await Promise.all(images.map(image => image.decode()));
    return { count: images.length, widths: images.map(image => image.naturalWidth), visible: !document.querySelector('#uploadQrCodes').hidden };
  })()`);
  assert.equal(qr.count, uploadSessions[0].urls.length);
  if (qr.count) { assert.equal(qr.visible, true); assert.ok(qr.widths.every(width => width >= 128), JSON.stringify(qr)); }
  pass('Phone upload QR images render locally for the session URLs');
  await idle();
  await js(`setActiveStudentSelection(${JSON.stringify(b.id)})`);
  assert.equal((await js('desktop.getMobileUploadState()')).enabled, false);
  assert.equal(await js('document.querySelector("#uploadQrCodes").hidden && document.querySelector("#uploadQrCodes").children.length === 0'), true);
  pass('Switching student closes the old phone upload session');
  await assert.rejects(js(`desktop.removeStudent(${JSON.stringify(a)})`), /仍有学习资料/);
  pass('Removing a student with learning records is rejected');
  const emptyStudent = await js('desktop.createStudent(\"可移除空学生\")');
  await idle();
  await js(`desktop.removeStudent(${JSON.stringify(emptyStudent.id)})`);
  await idle();
  assert.equal((await js('desktop.listStudents()')).some(student => student.id === emptyStudent.id), false);
  pass('Empty-student deletion completes under maintenance locks without deadlock');

  await idle();
  await js(`desktop.renameStudent(${JSON.stringify(b.id)}, '隔离验收乙', 'female', ${JSON.stringify(customAvatar)})`);
  const backup = path.join(directory, 'students-backup.tar.gz');
  setDestination(backup);
  await js('desktop.createBackup()');
  await js(`desktop.renameStudent(${JSON.stringify(b.id)},'临时改名', 'male', null)`);
  await idle();
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [backup] });
  dialog.showMessageBox = async () => ({ response: 1 });
  await js('desktop.restoreBackup()');
  await waitFor(() => js(`state.students.some(student=>student.id===${JSON.stringify(b.id)} && student.name==='隔离验收乙') && state.activeStudentId===${JSON.stringify(b.id)}`), 'roster and active student restored together');
  await idle();
  assert.equal(await js('studentById(state.activeStudentId).avatar'), customAvatar);
  await js('document.querySelector("#studentAvatar img").decode()');
  assert.equal((await js('desktop.listPosts()')).length, 1);
  await js(`setActiveStudentSelection(${JSON.stringify(a)})`);
  assert.equal((await js('desktop.listPosts()')).length, 1);
  assert.equal((await js('desktop.getLearningStats()')).mistakes.length, 1);
  pass('Native backup restore preserves the roster, selected student, ownership and statistics');
};
