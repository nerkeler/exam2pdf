const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("exam2pdfDesktop", {
  isElectron: true,
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
    return ipcRenderer.invoke("desktop:xhs-state");
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
  listStudents() {
    return ipcRenderer.invoke("students:list");
  },
  createStudent(name) {
    return ipcRenderer.invoke("students:create", name);
  },
  renameStudent(id, name) {
    return ipcRenderer.invoke("students:rename", id, name);
  },
  removeStudent(id) {
    return ipcRenderer.invoke("students:remove", id);
  },
  setActiveStudent(id) {
    return ipcRenderer.invoke("students:set-active", id);
  },
  listPosts() {
    return ipcRenderer.invoke("posts:list");
  },
  getPost(id) {
    return ipcRenderer.invoke("posts:get", id);
  },
  createPost(payload) {
    return ipcRenderer.invoke("posts:create", payload);
  },
  appendPostImages(id, images) {
    return ipcRenderer.invoke("posts:append-images", id, images);
  },
  renamePost(id, title) {
    return ipcRenderer.invoke("posts:rename", id, title);
  },
  renameAnswer(id, title) {
    return ipcRenderer.invoke("answers:rename", id, title);
  },
  deletePost(id) {
    return ipcRenderer.invoke("posts:delete", id);
  },
  reorderPost(id, order) {
    return ipcRenderer.invoke("posts:reorder", id, order);
  },
  resetPostOrder(id) {
    return ipcRenderer.invoke("posts:reset-order", id);
  },
  setPostSubject(id, subject) {
    return ipcRenderer.invoke("posts:set-subject", id, subject);
  },
  setPostStudent(id, studentId) {
    return ipcRenderer.invoke("posts:set-student", id, studentId);
  },
  removePostPage(id, file) {
    return ipcRenderer.invoke("posts:remove-page", id, file);
  },
  generatePostPdf(id, order, title) {
    return ipcRenderer.invoke("posts:pdf", id, order, title);
  },
  printPost(id, order, title) {
    return ipcRenderer.invoke("posts:print", id, order, title);
  },
  listAnswers() {
    return ipcRenderer.invoke("answers:list");
  },
  getLearningStats() {
    return ipcRenderer.invoke("answers:learning-stats");
  },
  getAnswer(id) {
    return ipcRenderer.invoke("answers:get", id);
  },
  createAnswer(payload) {
    return ipcRenderer.invoke("answers:create", payload);
  },
  importAnswerPdf(input) {
    return ipcRenderer.invoke("answers:import-pdf", input);
  },
  saveAnswerReview(id, questions, confirmed, trainingId) {
    return ipcRenderer.invoke("answers:save-review", id, questions, confirmed, trainingId);
  },
  exportAnswerPdf(id, order, title) {
    return ipcRenderer.invoke("answers:export-pdf", id, order, title);
  },
  parseExternalReview(text) {
    return ipcRenderer.invoke("answers:parse-external-review", text);
  },
  requestAiAnswerReview(id) {
    return ipcRenderer.invoke("answers:ai-review", id);
  },
  reorderAnswer(id, order) {
    return ipcRenderer.invoke("answers:reorder", id, order);
  },
  resetAnswerOrder(id) {
    return ipcRenderer.invoke("answers:reset-order", id);
  },
  setAnswerSubject(id, subject) {
    return ipcRenderer.invoke("answers:set-subject", id, subject);
  },
  exportMistakePdf(title) {
    return ipcRenderer.invoke("mistakes:export-pdf", title);
  },
  exportDiagnostics() {
    return ipcRenderer.invoke("diagnostics:export");
  },
  exportWorkspacePdf(title) {
    return ipcRenderer.invoke("workspace:export-pdf", title);
  },
  removeAnswerPage(id, file) {
    return ipcRenderer.invoke("answers:remove-page", id, file);
  },
  deleteAnswer(id) {
    return ipcRenderer.invoke("answers:delete", id);
  },
  generateTraining(topic) {
    return ipcRenderer.invoke("training:generate", topic);
  },
  generateAiTraining(topic) {
    return ipcRenderer.invoke("training:generate-ai", topic);
  },
  listTrainings() {
    return ipcRenderer.invoke("training:list");
  },
  saveTraining(practice) {
    return ipcRenderer.invoke("training:save", practice);
  },
  setTrainingStatus(id, status) {
    return ipcRenderer.invoke("training:set-status", id, status);
  },
  getAiSettings() {
    return ipcRenderer.invoke("ai:get-settings");
  },
  saveAiSettings(settings) {
    return ipcRenderer.invoke("ai:save-settings", settings);
  },
  testAiConnection() {
    return ipcRenderer.invoke("ai:test-connection");
  },
  startMobileUpload() {
    return ipcRenderer.invoke("mobile-upload:start");
  },
  getMobileUploadState() {
    return ipcRenderer.invoke("mobile-upload:state");
  },
  stopMobileUpload() {
    return ipcRenderer.invoke("mobile-upload:stop");
  },
  createBackup() {
    return ipcRenderer.invoke("backup:create");
  },
  restoreBackup() {
    return ipcRenderer.invoke("backup:restore");
  }
});
