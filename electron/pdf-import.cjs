const path = require("node:path");
const { randomUUID } = require("node:crypto");
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 24;
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

async function renderPdfWithElectron(encoded, options = {}) {
  const { BrowserWindow, session } = options.electron || require("electron");
  const isolatedSession = session.fromPartition("pdf-import-" + randomUUID());
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolatedSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (_details, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({ show: false, width: 800, height: 600,
    webPreferences: { session: isolatedSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        await window.loadFile(path.join(__dirname, "pdf-renderer.html"));
        return window.webContents.executeJavaScript("window.renderLocalPdf(" + JSON.stringify(encoded) + ")");
      })(),
      new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("PDF 转换超时，请拆分文件后重试")), options.timeoutMs || 90000); })
    ]);
  } finally {
    clearTimeout(timeout);
    if (!window.isDestroyed()) window.destroy();
  }
}

async function importAnswerPdf(input, options = {}) {
  const encoded = input && typeof input.base64 === "string" ? input.base64 : "";
  if (!encoded || encoded.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("PDF 文件无效或超过 50 MB");
  const pdf = Buffer.from(encoded, "base64");
  if (!pdf.length || pdf.length > MAX_PDF_BYTES || pdf.toString("base64") !== encoded || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("请选择有效的 PDF 作答文件（最大 50 MB）");
  let pages;
  try {
    pages = await (options.renderPdfImpl || renderPdfWithElectron)(encoded, options);
  } catch (error) {
    throw new Error("PDF 转换失败：" + String(error?.message || "请确认文件未加密且内容完整").slice(0, 240));
  }
  if (!Array.isArray(pages) || !pages.length) throw new Error("PDF 中没有可导入的页面");
  if (pages.length > MAX_PAGES) throw new Error("一份作答记录最多 24 页，请拆分 PDF 后再导入");
  let totalBytes = 0;
  pages.forEach((page, index) => {
    if (page?.mime !== "image/jpeg" || typeof page.base64 !== "string") throw new Error("PDF 页面转换结果无效");
    const bytes = Buffer.from(page.base64, "base64");
    if (!bytes.length || bytes.length > MAX_PAGE_BYTES) throw new Error("PDF 第 " + (index + 1) + " 页转换后超过 16 MB");
    if (bytes.toString("base64") !== page.base64 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || !Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1 || page.width > 2201 || page.height > 2201) throw new Error("PDF 页面转换结果无效");
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("转换后的 PDF 页面合计超过 80 MB");
    page.name = "PDF 第 " + (index + 1) + " 页";
  });
  return { pages, sourceName: String(input.name || "作答 PDF").slice(0, 160) };
}
module.exports = { importAnswerPdf, renderPdfWithElectron, MAX_PDF_BYTES, MAX_PAGES, MAX_PAGE_BYTES, MAX_TOTAL_BYTES };
