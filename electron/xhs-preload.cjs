const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("exam2pdfCollector", {
  beginCollection() { return ipcRenderer.invoke("xhs:begin-collection"); },
  fetchImage(url) {
    return ipcRenderer.invoke("xhs:fetch-image", url);
  },
  collectPost(payload) {
    return ipcRenderer.invoke("xhs:collect-post", payload);
  }
});
