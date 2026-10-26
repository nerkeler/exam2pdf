const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exam2pdfCollector", {
  fetchImage(url) {
    return ipcRenderer.invoke("xhs:fetch-image", url);
  },
  collectPost(payload) {
    return ipcRenderer.invoke("xhs:collect-post", payload);
  }
});
