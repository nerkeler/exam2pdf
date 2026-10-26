const { app, BrowserWindow, session, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
// Boot the real application with a separate local profile and a synthetic XHS page.
// No real account, platform request or student data is used by this acceptance run.
const projectRoot = path.resolve(__dirname, '../..');
const testData = fs.mkdtempSync(path.join(os.tmpdir(), 'exam2pdf-desktop-acceptance-'));
const outputPath = path.join(testData, 'result.json');
const pdfPath = path.join(testData, 'report.pdf');
const darkPdfPath = path.join(testData, 'report-dark.pdf');
const screenshotPath = path.join(testData, 'search-panel.png');
const userData = path.join(testData, 'user-data');
fs.mkdirSync(userData);
app.setPath('userData', userData);
let destinationPdf = pdfPath;
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destinationPdf });
const report = { checks: [], fixture: 'isolated local HTTPS protocol fixture; no real account or user data', status: 'running' };
let done = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function finish(error) {
  if (done) return;
  done = true;
  report.status = error ? 'failed' : 'passed';
  report.resultPath = outputPath;
  if (error) report.error = error.stack || String(error);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(error ? 1 : 0);
}
async function waitFor(getter, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await getter();
    if (result) return result;
    await sleep(75);
  }
  throw new Error('Timed out: ' + label);
}
function pass(name, details) { report.checks.push({ name, status: 'passed', details }); }
function findViews(win) {
  const children = win.contentView.children.filter((view) => view.webContents);
  return {
    children,
    xhs: children.find((view) => view.webContents.getURL().startsWith('https://www.xiaohongshu.com')),
    overlay: children.find((view) => view.webContents.getURL().includes('xhs-search-overlay.html'))
  };
}
const fixture = '<!doctype html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:#fafafa}.search-row{position:absolute;left:240px;top:20px;height:48px;display:flex;gap:8px;align-items:center;width:max-content}input{width:400px;height:48px;border:1px solid #ddd;border-radius:24px;padding:0 18px}button{width:64px;height:48px;border:1px solid #ddd;border-radius:24px;background:white}</style></head><body><div class="search-row"><input id="search-input-in-feeds" placeholder="搜索试卷" value="本地验收样例"><button id="native-search">搜索</button></div><p style="position:absolute;top:100px;left:30px">本地测试页面：无真实平台内容、无登录账号。</p></body></html>';
app.whenReady().then(async () => {
  session.fromPartition('persist:xhs').protocol.handle('https', () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  await sleep(20);
  run().catch(finish);
});
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
setTimeout(() => finish(new Error('Overall Electron review timeout')), 55000).unref();

async function run() {
  const win = await waitFor(() => BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()), 'workbench window');
  await waitFor(async () => win.webContents.getURL().includes('原型图') || win.webContents.getURL().includes('%E5%8E%9F'), 'workbench URL');
  await waitFor(() => win.webContents.executeJavaScript('window.__exam2pdfBootComplete === true'), 'renderer boot');
  pass('Electron workbench boot', { electron: process.versions.electron });
  const views = await waitFor(() => {
    const current = findViews(win);
    return current.xhs && current.overlay ? current : null;
  }, 'embedded view and native overlay');
  await sleep(400);
  const input = await views.xhs.webContents.executeJavaScript('(() => {const r=document.querySelector(".search-row").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()');
  const xhsBounds = views.xhs.getBounds();
  const overlayBounds = views.overlay.getBounds();
  assert.ok(overlayBounds.x >= xhsBounds.x + input.right + 7, 'Electron search button must stay to the right of native search controls');
  assert.equal(overlayBounds.height, 32);
  assert.equal(views.children[views.children.length - 1], views.overlay, 'overlay is topmost child view');
  assert.equal(await views.xhs.webContents.executeJavaScript('document.getElementById("e2p-search-btn") === null'), true);
  pass('Native Electron overlay geometry and page separation', { xhsBounds, overlayBounds, nativeSearchRow: input });
  await views.overlay.webContents.executeJavaScript('document.getElementById("toggle").click()');
  await waitFor(() => views.overlay.webContents.executeJavaScript('!document.getElementById("panel").hidden'), 'search panel open');
  assert.equal(views.overlay.getBounds().width, 350);
  await views.overlay.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await sleep(300);
  const openGeometry = await views.overlay.webContents.executeJavaScript('(() => {const toggle=document.getElementById("toggle").getBoundingClientRect(),panel=document.getElementById("panel").getBoundingClientRect();return {toggle:{width:toggle.width,height:toggle.height},panel:{top:panel.top,width:panel.width,height:panel.height}}})()');
  assert.equal(openGeometry.toggle.width, 80);
  assert.equal(openGeometry.toggle.height, 32);
  assert.equal(openGeometry.panel.width, 350);
  assert.equal(openGeometry.panel.top, 40);
  pass('Expanded search control and panel geometry after stable frames', openGeometry);
  const screenshot = await views.overlay.webContents.capturePage();
  fs.writeFileSync(screenshotPath, screenshot.toPNG());
  pass('Native search panel opens and renders', { bounds: views.overlay.getBounds(), screenshot: screenshotPath });
  const selectedQuery = await views.overlay.webContents.executeJavaScript('(() => {document.querySelector("[data-key=grade][data-value=八年级]").click();document.querySelector("[data-key=subject][data-value=数学]").click();return document.getElementById("query").value})()');
  assert.equal(selectedQuery, '八年级 数学');
  await views.overlay.webContents.executeJavaScript('document.getElementById("search").click()');
  await waitFor(() => views.xhs.webContents.getURL().includes('search_result?'), 'search URL navigation');
  assert.equal(new URL(views.xhs.webContents.getURL()).searchParams.get('keyword'), selectedQuery);
  await waitFor(() => findViews(win).overlay, 'overlay reattaches after navigation');
  pass('Search filters and IPC navigation', { keyword: selectedQuery });
  await win.webContents.executeJavaScript('document.querySelector(".nav-item[data-screen=\\"s1b\\"]").click()');
  await waitFor(() => !findViews(win).xhs && !findViews(win).overlay, 'views hide on navigation');
  await win.webContents.executeJavaScript('document.querySelector(".nav-item[data-screen=\\"s0\\"]").click()');
  await waitFor(() => findViews(win).xhs && findViews(win).overlay, 'views restore on navigation');
  pass('Navigation hides and restores both Electron child views');
  win.setSize(980, 760);
  await sleep(900);
  const narrow = findViews(win);
  assert.ok(narrow.overlay);
  const narrowBounds = narrow.overlay.getBounds();
  const narrowXhs = narrow.xhs.getBounds();
  assert.ok(narrowBounds.x >= narrowXhs.x && narrowBounds.x + narrowBounds.width <= narrowXhs.x + narrowXhs.width, 'overlay remains horizontally within the XHS view');
  assert.ok(narrowBounds.y >= narrowXhs.y && narrowBounds.y + narrowBounds.height <= narrowXhs.y + narrowXhs.height, 'overlay remains vertically within the XHS view');
  pass('Minimum desktop width keeps overlay in bounds', { narrowBounds, narrowXhs });
  const pagination = await win.webContents.executeJavaScript('(() => {const review=Array.from({length:18},(_,index)=>({questionNo:String(index+1),result:["正确","错误","部分正确","未作答"][index%4],knowledgePoints:["测试知识点"],solutionSummary:"本地验收公式：$x^2+1$【重点：复核】"}));renderReport({id:"local-review",title:"本地18题验收",review,reviewStatus:"confirmed",collectedAt:new Date().toISOString()});switchScreen("s4");const first=document.querySelectorAll("#reportQuestions .report-question-row").length;document.querySelector("#reportPager [data-page=\\"2\\"]").click();return {first,second:document.querySelectorAll("#reportQuestions .report-question-row").length,page:state.reportPage}})()');
  assert.deepEqual(pagination, { first: 10, second: 8, page: 2 });
  pass('Report pagination renders 18 questions as 10 and 8', pagination);
  const badges = await win.webContents.executeJavaScript('Array.from(document.querySelectorAll("#reportQuestions .report-question-status"), badge=>({text:badge.textContent,width:badge.getBoundingClientRect().width,height:badge.getBoundingClientRect().height,overflow:badge.scrollWidth>badge.clientWidth||badge.scrollHeight>badge.clientHeight}))');
  assert.ok(badges.every((badge) => !badge.overflow), 'all result backgrounds contain their labels');
  pass('Report status badges fit all four result labels', badges);
  assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("#reportQuestions .katex").length'), 8);
  pass('Report formulas render through bundled KaTeX');
  const guideBefore = await win.webContents.executeJavaScript('document.getElementById("guideDialog").open');
  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
    const overlays = await win.webContents.executeJavaScript('Array.from(document.querySelectorAll("dialog, .toast, .boot-fatal"), el => ({id:el.id,display:getComputedStyle(el).display}))');
    assert.ok(overlays.every((overlay) => overlay.display === 'none'), 'print media must hide non-content overlays');
    pass('Print media excludes guide dialogs and interface overlays', overlays);
    const darkPrint = await win.webContents.executeJavaScript('(() => {const previous=document.body.dataset.theme;document.body.dataset.theme="dark";document.body.classList.add("printing-report");try{return {app:getComputedStyle(document.querySelector(".app")).backgroundColor,surface:getComputedStyle(document.querySelector("#s4 .surface")).backgroundColor}}finally{document.body.classList.remove("printing-report");if(previous===undefined)delete document.body.dataset.theme;else document.body.dataset.theme=previous}})()');
    assert.equal(darkPrint.app, 'rgb(255, 255, 255)', 'dark screen theme must not put dark paper backgrounds in reports');
    assert.equal(darkPrint.surface, 'rgb(255, 255, 255)', 'report surface must use a light print palette');
    pass('Dark screen theme produces a light report print palette', darkPrint);
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: '' });
    win.webContents.debugger.detach();
  }
  let exportQuestions = 0;
  const originalPrintToPDF = win.webContents.printToPDF.bind(win.webContents);
  win.webContents.printToPDF = async (options) => {
    exportQuestions = await win.webContents.executeJavaScript('document.querySelectorAll("#reportQuestions .report-question-row").length');
    return originalPrintToPDF(options);
  };
  const restored = await win.webContents.executeJavaScript('(async () => {await exportReportPdf();return {restored:document.querySelectorAll("#reportQuestions .report-question-row").length,page:state.reportPage,printing:document.body.classList.contains("printing-report")}})()');
  assert.equal(exportQuestions, 18);
  assert.deepEqual(restored, { restored: 8, page: 2, printing: false });
  assert.ok(fs.existsSync(pdfPath), 'real report PDF was saved');
  const pdf = fs.readFileSync(pdfPath);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await win.webContents.executeJavaScript('document.getElementById("guideDialog").open'), guideBefore, 'export preserves the existing guide state');
  pass('Native PDF export includes all 18 questions and restores current report page', { exportQuestions, ...restored, bytes: pdf.length, pdf: pdfPath });
  destinationPdf = darkPdfPath;
  const darkExport = await win.webContents.executeJavaScript('(async () => {const previous=document.body.dataset.theme;document.body.dataset.theme="dark";try{await exportReportPdf();return {theme:document.body.dataset.theme,page:state.reportPage,restored:document.querySelectorAll("#reportQuestions .report-question-row").length}}finally{if(previous===undefined)delete document.body.dataset.theme;else document.body.dataset.theme=previous}})()');
  assert.deepEqual(darkExport, { theme: 'dark', page: 2, restored: 8 });
  const darkPdf = fs.readFileSync(darkPdfPath);
  assert.equal(darkPdf.subarray(0, 5).toString(), '%PDF-');
  pass('Native PDF export works from dark theme and retains UI theme and page', { ...darkExport, bytes: darkPdf.length, pdf: darkPdfPath });
  assert.equal(await win.webContents.executeJavaScript('Boolean(window.__exam2pdfBootComplete)'), true);
  finish();
}
require(path.join(projectRoot, 'electron', 'main.cjs'));
