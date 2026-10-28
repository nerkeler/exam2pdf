const { contextBridge, ipcRenderer } = require("electron");

function listen(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("exam2pdfXhsOverlay", {
  togglePanel() {
    ipcRenderer.send("xhs-search-overlay:toggle");
  },
  search(query) {
    ipcRenderer.send("xhs-search-overlay:search", String(query || "").slice(0, 300));
  },
  onStudentContext(callback) { return listen("xhs-search-overlay:student", callback); },
  onLayout(callback) {
    return listen("xhs-search-overlay:layout", callback);
  }
});
