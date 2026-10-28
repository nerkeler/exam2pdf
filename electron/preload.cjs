const { contextBridge, ipcRenderer } = require("electron");

let studentGeneration = 0;
let pendingStudentRequests = 0;
async function invoke(channel, ...args) {
  if (channel === "students:set-active" || channel === "backup:restore" || channel === "students:remove") studentGeneration++;
  const generation = studentGeneration;
  const scoped = /^(posts:|answers:|training:|workspace:|mistakes:|mobile-upload:)/.test(channel);
  if (scoped) pendingStudentRequests++;
  let result;
  try { result = await ipcRenderer.invoke(channel, ...args); }
  finally { if (scoped) pendingStudentRequests--; }
  if (/^(posts:|answers:|training:|workspace:|mistakes:|mobile-upload:)/.test(channel) && generation !== studentGeneration) throw new Error("学生已切换，旧页面结果已丢弃");
  return result;
}
function listen(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("exam2pdfDesktop", {
  isElectron: true,
  isStudentBusy() { return pendingStudentRequests > 0; },
  setXhsBounds(bounds) {
    ipcRenderer.send("desktop:xhs-bounds", bounds);
  },
  goBack() {
    ipcRenderer.send("desktop:xhs-back");
  },
  goForward() {
    ipcRenderer.send("desktop:xhs-forward");
  },
  reload() {
    ipcRenderer.send("desktop:xhs-reload");
  },
  getXhsState() {
    return invoke("desktop:xhs-state");
  },
  onXhsState(callback) {
    return listen("desktop:xhs-state", callback);
  },
  onPostsChanged(callback) {
    return listen("posts:changed", callback);
  },
  onAnswersChanged(callback) {
    return listen("answers:changed", callback);
  },
  onStudentsChanged(callback) {
    return listen("students:changed", callback);
  },
  getStudentContext() { return invoke("students:context"); },
  listStudents() {
    return invoke("students:list");
  },
  pickStudentAvatar() { return invoke("students:pick-avatar"); },
  createStudent(name, gender, avatar) {
    return invoke("students:create", name, gender, avatar);
  },
  renameStudent(id, name, gender, avatar) {
    return invoke("students:rename", id, name, gender, avatar);
  },
  removeStudent(id) {
    return invoke("students:remove", id);
  },
  setActiveStudent(id) {
    return invoke("students:set-active", id);
  },
  listPosts() {
    return invoke("posts:list");
  },
  getPost(id) {
    return invoke("posts:get", id);
  },
  createPost(payload) {
    return invoke("posts:create", payload);
  },
  appendPostImages(id, images) {
    return invoke("posts:append-images", id, images);
  },
  renamePost(id, title) {
    return invoke("posts:rename", id, title);
  },
  renameAnswer(id, title) {
    return invoke("answers:rename", id, title);
  },
  deletePost(id) {
    return invoke("posts:delete", id);
  },
  reorderPost(id, order) {
    return invoke("posts:reorder", id, order);
  },
  resetPostOrder(id) {
    return invoke("posts:reset-order", id);
  },
  setPostSubject(id, subject) {
    return invoke("posts:set-subject", id, subject);
  },
  removePostPage(id, file) {
    return invoke("posts:remove-page", id, file);
  },
  generatePostPdf(id, order, title) {
    return invoke("posts:pdf", id, order, title);
  },
  printPost(id, order, title) {
    return invoke("posts:print", id, order, title);
  },
  listAnswers() {
    return invoke("answers:list");
  },
  getLearningStats() {
    return invoke("answers:learning-stats");
  },
  getAnswer(id) {
    return invoke("answers:get", id);
  },
  createAnswer(payload) {
    return invoke("answers:create", payload);
  },
  importAnswerPdf(input) {
    return invoke("answers:import-pdf", input);
  },
  saveAnswerReview(id, questions, confirmed, trainingId) {
    return invoke("answers:save-review", id, questions, confirmed, trainingId);
  },
  exportAnswerPdf(id, order, title) {
    return invoke("answers:export-pdf", id, order, title);
  },
  parseExternalReview(text) {
    return invoke("answers:parse-external-review", text);
  },
  requestAiAnswerReview(id) {
    return invoke("answers:ai-review", id);
  },
  reorderAnswer(id, order) {
    return invoke("answers:reorder", id, order);
  },
  resetAnswerOrder(id) {
    return invoke("answers:reset-order", id);
  },
  setAnswerSubject(id, subject) {
    return invoke("answers:set-subject", id, subject);
  },
  exportMistakePdf(title) {
    return invoke("mistakes:export-pdf", title);
  },
  exportDiagnostics() {
    return invoke("diagnostics:export");
  },
  exportWorkspacePdf(title) {
    return invoke("workspace:export-pdf", title);
  },
  removeAnswerPage(id, file) {
    return invoke("answers:remove-page", id, file);
  },
  deleteAnswer(id) {
    return invoke("answers:delete", id);
  },
  generateTraining(topic) {
    return invoke("training:generate", topic);
  },
  generateAiTraining(topic) {
    return invoke("training:generate-ai", topic);
  },
  listTrainings() {
    return invoke("training:list");
  },
  saveTraining(practice) {
    return invoke("training:save", practice);
  },
  setTrainingStatus(id, status) {
    return invoke("training:set-status", id, status);
  },
  getAiSettings() {
    return invoke("ai:get-settings");
  },
  saveAiSettings(settings) {
    return invoke("ai:save-settings", settings);
  },
  testAiConnection() {
    return invoke("ai:test-connection");
  },
  startMobileUpload() {
    return invoke("mobile-upload:start");
  },
  getMobileUploadState() {
    return invoke("mobile-upload:state");
  },
  stopMobileUpload() {
    return invoke("mobile-upload:stop");
  },
  createBackup() {
    return invoke("backup:create");
  },
  restoreBackup() {
    return invoke("backup:restore");
  }
});
