const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, protocol, dialog, safeStorage, Menu, nativeImage } = require("electron");
const { AsyncLocalStorage } = require("node:async_hooks");
const { StudentWorkspace, scopedStore } = require("./student-workspace.cjs");
const studentRequests = new AsyncLocalStorage();
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { PostStore } = require("./post-store.cjs");
const { createPrintHtml, safePdfFileName } = require("./print-document.cjs");
const { compareVersions, RELEASES_PAGE, LATEST_RELEASE_API } = require("./app-update.cjs");
const { deriveLearningStats } = require("./learning-stats.cjs");
const { generatePractice } = require("./training-generator.cjs");
const { generateAiPractice } = require("./ai-practice-service.cjs");
const { createBackup, restoreBackup } = require("./backup-service.cjs");
const { mobileUploadState } = require("./mobile-upload-qr.cjs");
const { startMobileUploadServer } = require("./mobile-upload-server.cjs");
const { TrainingStore } = require("./training-store.cjs");
const { StudentStore } = require("./student-store.cjs");
const { deriveTrainingProgress } = require("./training-progress.cjs");
const { AiSettingsStore } = require("./ai-settings-store.cjs");
const { createAiReview, testAiConnection, parseExternalReview, MAX_INPUT_BYTES: MAX_AI_REVIEW_INPUT_BYTES } = require("./ai-review-service.cjs");
const { importAnswerPdf } = require("./pdf-import.cjs");
const { isXhsUrl, noteIdFromUrl, isXhsImageUrl } = require("./xhs-url.cjs");
const { buildXhsCollectionInput, inferSubject } = require("./xhs-collection.cjs");
const { processPrintImage } = require("./print-image.cjs");
const { loadCollectorScript, tryRunOptionalStartupTask } = require("./startup-assets.cjs");
const { monitorWindowStartup } = require("./window-startup.cjs");
const { createStartupErrorUrl } = require("./startup-error-page.cjs");
const { withStoreLocks } = require("./library-maintenance.cjs");
const {
  buildSearchUrl,
  resolveSearchPanelBounds
} = require("./xhs-search.cjs");

// 显示名「家卷」；数据目录显式钉在 exam2pdf（改名不迁移，老数据无缝延续）
app.setName("家卷");
// Tests and diagnostic launches can supply an isolated absolute profile.
const isolatedProfile = process.env.EXAM2PDF_USER_DATA;
if (isolatedProfile && !path.isAbsolute(isolatedProfile)) throw new Error("EXAM2PDF_USER_DATA must be absolute");
if (isolatedProfile) fsSync.mkdirSync(isolatedProfile, { recursive: true });
app.setPath("userData", isolatedProfile || path.join(app.getPath("appData"), "exam2pdf"));

const startupSmoke = process.env.EXAM2PDF_STARTUP_SMOKE === "1";
// 诊断错误日志：内存环形 + 落盘（userData/logs/error.log），供"导出诊断信息"使用
const errorLogLines = [];
function pushErrorLog(line) {
  const stamped = new Date().toISOString() + " " + String(line).slice(0, 500);
  errorLogLines.push(stamped);
  if (errorLogLines.length > 200) errorLogLines.shift();
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fsSync.mkdirSync(logDir, { recursive: true });
    fsSync.appendFileSync(path.join(logDir, "error.log"), stamped + "\n");
  } catch (e) {}
}
if (startupSmoke) {
  const smokeDataPath = process.env.EXAM2PDF_STARTUP_SMOKE_DATA;
  if (!smokeDataPath || !path.isAbsolute(smokeDataPath)) throw new Error("A temporary absolute user-data path is required for startup smoke mode");
  fsSync.mkdirSync(smokeDataPath, { recursive: true });
  app.setPath("userData", smokeDataPath);
}

protocol.registerSchemesAsPrivileged([{
  scheme: "exam2pdf-media",
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

const appPage = path.join(__dirname, "..", "docs", "原型图.html");
const collectorAsset = loadCollectorScript(path.join(__dirname, "..", "frontend", "exam2pdf.user.js"), fsSync.readFileSync.bind(fsSync));
const collectorScript = collectorAsset.source;
if (collectorAsset.error) console.error("Unable to load the XHS collector script:", collectorAsset.error.message);
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;
let xhsView;
let xhsSearchOverlayView;
let postStore;
let answerStore;
let trainingStore;
let studentStore;
// 当前选中的学生：采集/手机上传时自动归属，渲染层切换学生时同步过来
let activeStudentId = null;
let studentWorkspace;
let rawAnswerStore;
let workspaceRevision = 0;
const collectionContexts = new Map();
const requestStudentId = () => studentRequests.getStore()?.studentId || activeStudentId;
let aiSettingsStore;
let mobileUploadServer;
let mobileUploadStarting = null;
let xhsSession;
let xhsViewAttached = false;
let xhsSearchOverlayAttached = false;
let xhsSearchOverlayReady = false;
let xhsSearchPositionReady = false;
let xhsSearchPanelOpen = false;
let xhsReady = false;
let requestedXhsBounds = null;
let currentXhsState = { status: "loading", message: "正在打开小红书…" };
let startupFailureShown = false;
let libraryMaintenance = Promise.resolve();

function syncSearchStudent() {
  xhsSearchPanelOpen = false;
  if (xhsSearchOverlayView && !xhsSearchOverlayView.webContents.isDestroyed() && xhsSearchOverlayReady) {
    xhsSearchOverlayView.webContents.send("xhs-search-overlay:student", activeStudentId);
    applyXhsSearchOverlayBounds();
  }
}

function maintainLibrary(task) {
  const current = libraryMaintenance.then(() => withStoreLocks([postStore, answerStore, trainingStore, studentStore], task));
  libraryMaintenance = current.catch(() => {});
  return current;
}

// 在小红书页面内读取当前登录账号；页面结构与 __INITIAL_STATE__ 均做防御式解析。
// 在小红书页面内读取当前登录账号：优先在 __INITIAL_STATE__.user 子树中扫描
//（页面结构改名时仍能匹配"昵称/头像"形状的对象），再退回侧边栏头像链接。

async function responseBytesLimited(response, limit) {
  const advertisedLength = Number(response.headers.get("content-length") || 0);
  if (advertisedLength > limit) throw new Error("图片超过 16 MB");
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error("图片超过 16 MB");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("图片超过 16 MB");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function isAppWindow(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  return typeof event.senderFrame?.url === "string" && event.senderFrame.url.startsWith("file:");
}

function sendXhsState(status, message) {
  currentXhsState = { status, message };
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("desktop:xhs-state", currentXhsState);
}

function hideXhsView() {
  if (!mainWindow) return;
  if (xhsSearchOverlayView && xhsSearchOverlayAttached) {
    mainWindow.contentView.removeChildView(xhsSearchOverlayView);
    xhsSearchOverlayAttached = false;
  }
  if (xhsView && xhsViewAttached) {
    mainWindow.contentView.removeChildView(xhsView);
    xhsViewAttached = false;
  }
}

function applyXhsSearchOverlayBounds() {
  if (!mainWindow || !xhsView || !xhsSearchOverlayView || !xhsSearchOverlayReady || !xhsSearchPositionReady || !xhsReady || !requestedXhsBounds?.visible) {
    if (mainWindow && xhsSearchOverlayView && xhsSearchOverlayAttached) {
      mainWindow.contentView.removeChildView(xhsSearchOverlayView);
      xhsSearchOverlayAttached = false;
    }
    return;
  }

  const base = requestedXhsBounds;
  const panel = resolveSearchPanelBounds(base, xhsSearchPanelOpen);
  const panelWidth = Math.min(350, Math.max(1,base.width-24)), panelHeight = Math.max(1, Math.min(500,base.height-64));
  const overlayBounds = { x:Math.round(base.x + panel.left), y:Math.round(base.y + panel.top), width:panel.width, height:panel.height };
  const buttonWidth = 80, buttonHeight = 32;

  if (!xhsViewAttached) {
    mainWindow.contentView.addChildView(xhsView);
    xhsViewAttached = true;
    xhsView.setBounds({
      x: Math.round(base.x), y: Math.round(base.y),
      width: Math.round(base.width), height: Math.max(1, Math.round(base.height))
    });
  }
  if (!xhsSearchOverlayAttached) {
    mainWindow.contentView.addChildView(xhsSearchOverlayView);
    xhsSearchOverlayAttached = true;
  }
  xhsSearchOverlayView.setBounds(overlayBounds);
  xhsSearchOverlayView.webContents.send("xhs-search-overlay:layout", {
    open: xhsSearchPanelOpen,
    buttonWidth: Math.round(buttonWidth),
    buttonHeight: Math.round(buttonHeight),
    panelWidth: Math.round(panelWidth),
    panelHeight: Math.max(1, Math.round(panelHeight))
  });
}

function scheduleXhsSearchPosition() {
  if (!xhsReady || !requestedXhsBounds?.visible) return;
  xhsSearchPositionReady = true;
  applyXhsSearchOverlayBounds();
}

// 能拿到任何 HTTP 状态码都说明 TCP/TLS 通；超时/连接错误才视为不可达。
async function checkXhsReachable() {
  try {
    const response = await xhsSession.fetch("https://www.xiaohongshu.com/favicon.ico", {
      signal: AbortSignal.timeout(6000)
    });
    response.body?.cancel?.()?.catch?.(() => {});
    return true;
  } catch {
    return false;
  }
}

function applyXhsBounds() {
  if (!mainWindow || !xhsView || !xhsReady || !requestedXhsBounds?.visible) {
    hideXhsView();
    return;
  }
  const content = mainWindow.getContentBounds();
  const { x, y, width, height } = requestedXhsBounds;
  const bounds = {
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.min(Math.round(width), content.width - Math.max(0, Math.round(x))),
    height: Math.min(Math.round(height), content.height - Math.max(0, Math.round(y)))
  };
  if (!Object.values(bounds).every(Number.isFinite) || bounds.width < 1 || bounds.height < 1) {
    hideXhsView();
    return;
  }
  if (!xhsViewAttached) {
    mainWindow.contentView.addChildView(xhsView);
    xhsViewAttached = true;
  }
  xhsView.setBounds(bounds);
  applyXhsSearchOverlayBounds();
}

function updateXhsView(event, requested) {
  if (!isAppWindow(event)) return;
  if (!requested || requested.visible !== true) {
    requestedXhsBounds = null;
    xhsSearchPanelOpen = false;
    xhsSearchPositionReady = false;
    hideXhsView();
    return;
  }
  const bounds = [requested.x, requested.y, requested.width, requested.height].map(Number);
  if (!bounds.every(Number.isFinite) || bounds[2] < 1 || bounds[3] < 1) {
    requestedXhsBounds = null;
    xhsSearchPanelOpen = false;
    xhsSearchPositionReady = false;
    hideXhsView();
    return;
  }
  requestedXhsBounds = { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3], visible: true };
  applyXhsBounds();
  scheduleXhsSearchPosition();

}

function createXhsView() {
  xhsSession = session.fromPartition("persist:xhs");
  // 以普通 Chrome 身份访问小红书：UA 里的 Electron 标识属于常见风控特征
  const uaPlatform = process.platform === "win32" ? "Windows NT 10.0; Win64; x64" : "Macintosh; Intel Mac OS X 10_15_7";
  xhsSession.setUserAgent("Mozilla/5.0 (" + uaPlatform + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + process.versions.chrome + " Safari/537.36");
  xhsView = new WebContentsView({
    webPreferences: {
      session: xhsSession,
      preload: path.join(__dirname, "xhs-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  xhsSearchOverlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "xhs-search-overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  xhsSearchOverlayView.setBackgroundColor("#00000000");
  xhsSearchOverlayView.webContents.on("did-finish-load", () => {
    xhsSearchOverlayReady = true;
    syncSearchStudent();
    applyXhsSearchOverlayBounds();
  });
  xhsSearchOverlayView.webContents.loadFile(path.join(__dirname, "xhs-search-overlay.html")).catch((error) => {
    console.warn("Unable to load the Electron Xiaohongshu search control:", error.message);
  });

  xhsView.webContents.setWindowOpenHandler(({ url }) => {
    if (isXhsUrl(url)) xhsView.webContents.loadURL(url).catch(() => {});
    else if (url.startsWith("https://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  xhsView.webContents.on("will-navigate", (event, url) => {
    if (isXhsUrl(url)) return;
    event.preventDefault();
    if (url.startsWith("https://")) shell.openExternal(url).catch(() => {});
  });

  // 只在主框架跨文档导航开始时进入加载态；子框架瞬时加载和 SPA 同文档路由
  // 也会触发 did-start-loading，但没有对应的 did-finish-load，会把已渲染页面
  // 盖进"正在加载"遮罩里反复闪现。
  let xhsNavOverlayTimer = null;
  xhsView.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    if (isInPlace) return;
    xhsReady = false;
    xhsSearchPanelOpen = false;
    xhsSearchPositionReady = false;
    // 保留已渲染画面（浏览器行为），超过 1.2s 才切换加载遮罩，减少"感觉慢"
    if (xhsNavOverlayTimer) clearTimeout(xhsNavOverlayTimer);
    xhsNavOverlayTimer = setTimeout(() => {
      if (xhsReady) return;
      hideXhsView();
      sendXhsState("loading", "小红书页面正在加载…");
    }, 1200);
  });

  xhsView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    if (xhsNavOverlayTimer) { clearTimeout(xhsNavOverlayTimer); xhsNavOverlayTimer = null; }
    xhsReady = false;
    hideXhsView();
    sendXhsState("error", "小红书加载失败：" + String(errorDescription || "网络暂不可用") + "；若持续失败，可切换网络（如手机热点）后点重试");
  });

  xhsView.webContents.on("did-finish-load", () => {
    if (!isXhsUrl(xhsView.webContents.getURL())) return;
    if (xhsNavOverlayTimer) { clearTimeout(xhsNavOverlayTimer); xhsNavOverlayTimer = null; }
    xhsReady = true;
    applyXhsBounds();
    scheduleXhsSearchPosition();

    if (collectorAsset.error) {
      sendXhsState("ready", "小红书已连接 · 采集脚本不可用");
      return;
    }
    sendXhsState("ready", "小红书已连接 · 登录状态保存在本机");
    xhsView.webContents.executeJavaScript(collectorScript, true).catch((error) => {
      sendXhsState("ready", "小红书已连接 · 采集按钮暂不可用");
      console.warn("Unable to inject exam2pdf collector:", error.message);
    });
  });
  xhsView.webContents.on("did-navigate-in-page", () => scheduleXhsSearchPosition());
  // 顶栏已移除：触摸板双指轻扫补回前进/后退（与浏览器手势一致：右扫=后退，左扫=前进）
  xhsView.webContents.on("swipe", (_event, direction) => {
    const history = xhsView.webContents.navigationHistory;
    if (direction === "right" && history.canGoBack()) history.goBack();
    if (direction === "left" && history.canGoForward()) history.goForward();
  });

  sendXhsState("loading", "正在打开小红书…");
  xhsView.webContents.loadURL("https://www.xiaohongshu.com/explore").catch((error) => {
    sendXhsState("error", "小红书加载失败：" + String(error.message || error));
  });
}

function createWindow() {
  startupFailureShown = false;
  const appIconPath = path.join(__dirname, "..", "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
    icon: appIconPath,
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (startupSmoke) {
    currentXhsState = { status: "unavailable", message: "启动检查跳过小红书网页" };
  } else {
    tryRunOptionalStartupTask(createXhsView, (error) => {
      console.error("Unable to initialize the Xiaohongshu view:", error.message);
      sendXhsState("unavailable", "小红书网页视图初始化失败，请重启应用后重试");
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 工作台内的外部链接（如各 AI 网页）交给系统浏览器打开
    if (/^https:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("file:")) event.preventDefault();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      const error = new Error("加载工作台失败（" + errorCode + "）：" + String(errorDescription || failedUrl || "未知错误"));
      console.error("exam2pdf workspace navigation failed:", error.message);
      showWindowLoadFailure(error);
    }
  });
  mainWindow.webContents.on("console-message", (details) => {
    const severity = details && details.level;
    if (severity === "error" || severity === 3) {
      pushErrorLog("renderer: " + String(details.message || "").slice(0, 300) + " @" + String(details.sourceId || "").split("/").pop() + ":" + details.lineNumber);
      console.error("exam2pdf renderer error:", details.sourceId || "", details.lineNumber || "", details.message || "");
    }
  });
  const windowBeingStarted = mainWindow;
  let smokeFirstFrame = false;
  let smokeRendererBooted = false;
  let smokeFinished = false;
  let smokeTimer;
  const finishStartupSmoke = (error) => {
    if (!startupSmoke || smokeFinished) return;
    smokeFinished = true;
    if (smokeTimer) clearTimeout(smokeTimer);
    if (error) {
      console.error("Electron startup smoke failed:", error.message || error);
      app.exit(1);
      return;
    }
    console.log("Electron startup smoke passed: renderer booted and produced its first frame.");
    app.exit(0);
  };
  const completeStartupSmokeIfReady = () => {
    if (smokeFirstFrame && smokeRendererBooted) finishStartupSmoke();
  };
  if (startupSmoke) {
    smokeTimer = setTimeout(() => finishStartupSmoke(new Error("Timed out waiting for the workbench first frame")), 20000);
    smokeTimer.unref?.();
    windowBeingStarted.once("ready-to-show", () => {
      smokeFirstFrame = true;
      completeStartupSmokeIfReady();
    });
    windowBeingStarted.webContents.once("did-finish-load", async () => {
      try {
        if (!windowBeingStarted.webContents.getURL().startsWith("file:")) throw new Error("Workbench loaded the startup fallback instead of the project page");
        const booted = await windowBeingStarted.webContents.executeJavaScript("window.__exam2pdfBootComplete === true");
        if (!booted) throw new Error("Workbench renderer did not complete its initialization script");
        smokeRendererBooted = true;
        completeStartupSmokeIfReady();
      } catch (error) {
        finishStartupSmoke(error);
      }
    });
  }
  let pageLoad;
  try { pageLoad = windowBeingStarted.loadFile(appPage); }
  catch (error) { pageLoad = Promise.reject(error); }
  monitorWindowStartup(windowBeingStarted, pageLoad, showWindowLoadFailure, { showWindow: !startupSmoke });
  if (process.platform === "darwin" && app.dock && fsSync.existsSync(appIconPath)) {
    try { app.dock.setIcon(appIconPath); } catch (e) {}
  }
  mainWindow.on("resize", () => {
    applyXhsBounds();
    scheduleXhsSearchPosition();
  });
  mainWindow.on("closed", () => {
      if (xhsView && !xhsView.webContents.isDestroyed()) xhsView.webContents.close();
    if (xhsSearchOverlayView && !xhsSearchOverlayView.webContents.isDestroyed()) xhsSearchOverlayView.webContents.close();
    xhsView = null;
    xhsSearchOverlayView = null;
    xhsViewAttached = false;
    xhsSearchOverlayAttached = false;
    xhsSearchOverlayReady = false;
    xhsSearchPositionReady = false;
    xhsReady = false;
    requestedXhsBounds = null;
    mainWindow = null;
  });
}

function showWindowLoadFailure(error) {
  if (startupFailureShown || !mainWindow || mainWindow.isDestroyed()) return;
  startupFailureShown = true;
  const message = String(error && error.message ? error.message : error);
  console.error("Unable to load the exam2pdf workspace:", message);
  if (startupSmoke) {
    app.exit(1);
    return;
  }
  mainWindow.setTitle("家卷 · 启动失败");
  mainWindow.show();
  mainWindow.webContents.loadURL(createStartupErrorUrl(message)).catch((fallbackError) => {
    dialog.showErrorBox("家卷 启动失败", message + "\n\n诊断页面加载失败：" + String(fallbackError.message || fallbackError));
  });
}

function showInitializationFailure(error) {
  pushErrorLog("init failure: " + (error && error.message ? error.message : error));
  console.error("Unable to initialize exam2pdf:", error && error.message ? error.message : error);
  if (startupSmoke) {
    app.exit(1);
    return;
  }
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    startupFailureShown = false;
    const failureWindow = new BrowserWindow({
      width: 900,
      height: 640,
      minWidth: 600,
      minHeight: 420,
      show: false,
      backgroundColor: "#f6f7f9",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    mainWindow = failureWindow;
    failureWindow.on("closed", () => {
      if (mainWindow === failureWindow) mainWindow = null;
      app.quit();
    });
    app.on("activate", () => {
      if (failureWindow.isDestroyed()) return;
      failureWindow.show();
      failureWindow.focus();
    });
    showWindowLoadFailure(error);
  } catch (windowError) {
    dialog.showErrorBox(
      "家卷 启动失败",
      String(error && error.message ? error.message : error) + "\n\n无法打开诊断窗口：" + String(windowError.message || windowError)
    );
    app.quit();
  }
}

function appHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isAppWindow(event)) throw new Error("此操作只能从 exam2pdf 工作台发起");
    const studentId = activeStudentId;
    await libraryMaintenance;
    const scoped = /^(posts:|answers:|training:|workspace:|mistakes:|mobile-upload:)/.test(channel);
    if (scoped && studentId !== activeStudentId) throw new Error("学生已切换，请重试当前操作");
    return studentRequests.run({ studentId }, () => handler(...args));
  });
}

function notifyPostsChanged(id) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("posts:changed", { id });
  }
}

function notifyStudentsChanged(value = {}) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("students:changed", value);
  }
}

function notifyAnswersChanged(id, detail = {}) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("answers:changed", { id, ...detail });
  }
}

// 手机上传的照片不落库，原样移交渲染层进「待保存页面」暂存区，确认后才保存
function notifyMobileUploadReceived(payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("mobile-upload:received", payload);
  }
}

async function preparePrintWindow(store, postId, order, requestedTitle) {
  const post = await store.getPost(postId);
  if (!post.pageOrder.length) throw new Error("这份试卷没有可打印的图片");
  const pageOrder = Array.isArray(order) ? order : post.pageOrder;
  if (pageOrder.length !== post.pageOrder.length || new Set(pageOrder).size !== pageOrder.length || pageOrder.some((file) => !post.pageOrder.includes(file))) {
    throw new Error("页面顺序已发生变化，请重新打开试卷详情");
  }
  const title = String(requestedTitle || post.title).trim().slice(0, 160) || post.title;
  const printDirectory = path.join(app.getPath("temp"), "exam2pdf-print-" + randomUUID());
  await fs.mkdir(printDirectory, { recursive: true });
  try {
    const pages = [];
    for (const [pageIndex, file] of pageOrder.entries()) {
      const image = post.images.find((item) => item.file === file);
      if (!image) throw new Error("试卷图片不完整，请检查帖子池");
      let url = pathToFileURL(path.join(store.postDirectory(post.id), image.file)).href;
      // 导出前自动整理并压缩（裁边/纠偏/EXIF 方向/缩放/JPEG），原始文件不受影响
      try {
        const processed = processPrintImage(await fs.readFile(path.join(store.postDirectory(post.id), image.file)), image.mime);
        if (processed) {
          const processedPath = path.join(printDirectory, "p-" + String(pageIndex + 1).padStart(3, "0") + ".jpg");
          await fs.writeFile(processedPath, processed.data);
          url = pathToFileURL(processedPath).href;
          image.width = processed.width;
          image.height = processed.height;
        }
      } catch { /* 整理失败时回退原始文件 */ }
      pages.push({ ...image, url });
    }
    const printFile = path.join(printDirectory, "print.html");
    const html = createPrintHtml(title, pages);
    await fs.writeFile(printFile, html, "utf8");
    const printWindow = new BrowserWindow({
      width: 920,
      height: 760,
      title: title + " · 打印预览",
      show: false,
      // 隐藏窗口必须保持渲染活动，否则系统打印在部分平台会输出空白页
      paintWhenInitiallyHidden: true,
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      await printWindow.loadFile(printFile);
      const imagesReady = await printWindow.webContents.executeJavaScript(
        'Promise.all(Array.from(document.images, image => image.decode().then(() => true).catch(() => false)))'
      );
      if (!imagesReady.every(Boolean)) throw new Error("有图片未能载入，尚未生成打印文件");
    } catch (error) {
      if (!printWindow.isDestroyed()) printWindow.destroy();
      await fs.rm(printDirectory, { recursive: true, force: true });
      throw error;
    }
    return { printWindow, printDirectory, title };
  } catch (error) {
    // Preparation can fail before a print window exists (disk writes, HTML
    // creation, or native window creation). Those paths also contain student images.
    await fs.rm(printDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function exportPdfViaDialog(store, id, order, title, dialogTitle) {
  const prepared = await preparePrintWindow(store, id, order, title);
  try {
    const target = await dialog.showSaveDialog(mainWindow, {
      title: dialogTitle,
      defaultPath: path.join(app.getPath("documents"), safePdfFileName(prepared.title)),
      filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
    });
    if (target.canceled || !target.filePath) return { canceled: true };
    const destination = /\.pdf$/i.test(target.filePath) ? target.filePath : target.filePath + ".pdf";
    const pdf = await prepared.printWindow.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });
    await fs.writeFile(destination, pdf);
    return { canceled: false, filePath: destination };
  } finally {
    if (!prepared.printWindow.isDestroyed()) prepared.printWindow.destroy();
    await fs.rm(prepared.printDirectory, { recursive: true, force: true });
  }
}

async function generatePostPdf(postId, order, title) {
  return exportPdfViaDialog(postStore, postId, order, title, "保存试卷 PDF");
}

async function generateAnswerPdf(answerId, order, title) {
  return exportPdfViaDialog(answerStore, answerId, order, title, "保存作答 PDF");
}

// 试卷直接打印与错题本同机制：主窗口 window.print() 唤起系统打印界面。
// 整理后的页面以内存数据直出（不落盘、无临时文件），渲染层在打印结束后自行释放。
async function preparePrintPages(store, postId, order, requestedTitle) {
  const post = await store.getPost(postId);
  if (!post.pageOrder.length) throw new Error("这份试卷没有可打印的图片");
  const pageOrder = Array.isArray(order) ? order : post.pageOrder;
  if (pageOrder.length !== post.pageOrder.length || new Set(pageOrder).size !== pageOrder.length || pageOrder.some((file) => !post.pageOrder.includes(file))) {
    throw new Error("页面顺序已发生变化，请重新打开试卷详情");
  }
  const title = String(requestedTitle || post.title).trim().slice(0, 160) || post.title;
  const pages = [];
  for (const file of pageOrder) {
    const image = post.images.find((item) => item.file === file);
    if (!image) throw new Error("试卷图片不完整，请检查帖子池");
    const original = await fs.readFile(path.join(store.postDirectory(post.id), image.file));
    let dataUrl = "data:" + (image.mime || "image/jpeg") + ";base64," + original.toString("base64");
    let width = image.width;
    let height = image.height;
    // 打印前自动整理（裁边/纠偏/EXIF 方向/缩放/JPEG），失败时回退原始文件
    try {
      const processed = processPrintImage(original, image.mime);
      if (processed) {
        dataUrl = "data:image/jpeg;base64," + processed.data.toString("base64");
        width = processed.width;
        height = processed.height;
      }
    } catch { /* 回退原始文件 */ }
    pages.push({ dataUrl, width, height });
  }
  return { title, pages };
}

ipcMain.on("desktop:xhs-bounds", updateXhsView);
appHandle("desktop:xhs-state", () => currentXhsState);
ipcMain.on("xhs-search-overlay:toggle", (event) => {
  if (!xhsSearchOverlayView || event.sender !== xhsSearchOverlayView.webContents || !xhsSearchOverlayAttached) return;
  xhsSearchPanelOpen = !xhsSearchPanelOpen;
  applyXhsSearchOverlayBounds();
});
ipcMain.on("xhs-search-overlay:search", (event, query) => {
  if (!xhsSearchOverlayView || event.sender !== xhsSearchOverlayView.webContents || !xhsView || !xhsReady) return;
  const url = buildSearchUrl(query);
  if (!url) return;
  xhsSearchPanelOpen = false;
  applyXhsSearchOverlayBounds();
  xhsView.webContents.loadURL(url).catch((error) => {
    sendXhsState("ready", "搜索失败：" + String(error.message || error));
  });
});
ipcMain.on("desktop:xhs-back", (event) => {
  if (isAppWindow(event) && xhsView && xhsView.webContents.navigationHistory.canGoBack()) xhsView.webContents.navigationHistory.goBack();
});
ipcMain.on("desktop:xhs-forward", (event) => {
  if (isAppWindow(event) && xhsView && xhsView.webContents.navigationHistory.canGoForward()) xhsView.webContents.navigationHistory.goForward();
});
ipcMain.on("desktop:xhs-reload", async (event) => {
  if (!isAppWindow(event) || !xhsView) return;
  sendXhsState("loading", "正在检查到小红书的网络连接…");
  const reachable = await checkXhsReachable();
  if (!xhsView || xhsView.webContents.isDestroyed()) return;
  if (!reachable) {
    sendXhsState("error", "本机当前连不上小红书服务器（图片 CDN 与其他网站正常，多为 IP 被临时风控或代理分流问题）：可切换网络（如手机热点）后点重试，或稍后再试");
    return;
  }
  xhsView.webContents.reload();
});

appHandle("posts:list", () => postStore.listPosts());
appHandle("students:list", () => studentStore.list());
appHandle("students:pick-avatar", async () => {
  const choice = await dialog.showOpenDialog(mainWindow, { title: "选择学生头像", properties: ["openFile"], filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp"] }] });
  if (choice.canceled || !choice.filePaths[0]) return null;
  const file = choice.filePaths[0];
  if ((await fs.stat(file)).size > 10 * 1024 * 1024) throw new Error("请选择小于 10 MB 的图片");
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error("无法读取这张图片，请选择 JPG、PNG 或 WebP");
  const size = image.getSize();
  const edge = Math.min(size.width, size.height);
  const square = image.crop({ x: Math.floor((size.width-edge)/2), y: Math.floor((size.height-edge)/2), width: edge, height: edge }).resize({ width:256, height:256 });
  return "data:image/jpeg;base64," + square.toJPEG(85).toString("base64");
});
appHandle("students:create", async (name, gender, avatar) => {
  const student = await studentStore.create(name, gender, avatar);
  notifyStudentsChanged();
  return student;
});
appHandle("students:rename", async (id, name, gender, avatar) => {
  const student = await studentStore.rename(id, name, gender, avatar);
  notifyStudentsChanged();
  return student;
});
async function stopPhoneUpload() {
  if (mobileUploadStarting) await mobileUploadStarting.catch(() => {});
  if (mobileUploadServer) { const server = mobileUploadServer; mobileUploadServer = null; await server.close(); }
}
appHandle("students:remove", async (id) => {
  return maintainLibrary(async () => {
    const context = await studentWorkspace.remove(id);
    notifyStudentsChanged(); return context;
  });
});
appHandle("students:context", () => studentWorkspace.context());
appHandle("students:set-active", async (id) => {
  await stopPhoneUpload();
  return maintainLibrary(async () => {
    const context = await studentWorkspace.select(id);
    activeStudentId = context.studentId; workspaceRevision++; collectionContexts.clear();
    syncSearchStudent();
    return context;
  });
});
appHandle("posts:get", (id) => postStore.getPost(id));
appHandle("posts:create", async (payload) => {
  const result = await postStore.createPost({
    ...payload,
    source: "本地导入",
    noteId: null,
    sourceUrl: "",
    subject: payload?.subject || inferSubject(payload?.title)
  });
  notifyPostsChanged(result.post.id);
  return result;
});
appHandle("posts:set-subject", (id, subject) => {
  return postStore.setSubject(id, subject).then((post) => {
    notifyPostsChanged(id);
    return post;
  });
});
appHandle("posts:append-images", async (id, images) => {
  const post = await postStore.appendPostImages(id, images);
  notifyPostsChanged(id);
  return post;
});
appHandle("posts:rename", async (id, title) => {
  const post = await postStore.renamePost(id, title);
  notifyPostsChanged(id);
  return post;
});
appHandle("posts:delete", async (id) => {
  const result = await postStore.deletePost(id);
  notifyPostsChanged(id);
  return result;
});
appHandle("posts:reorder", async (id, order) => {
  const post = await postStore.reorderPost(id, order);
  notifyPostsChanged(id);
  return post;
});
appHandle("posts:reset-order", async (id) => {
  const post = await postStore.resetPostOrder(id);
  notifyPostsChanged(id);
  return post;
});
appHandle("posts:remove-page", async (id, file) => {
  const post = await postStore.removePostPage(id, file);
  notifyPostsChanged(id);
  return post;
});
appHandle("posts:pdf", (id, order, title) => generatePostPdf(id, order, title));
appHandle("posts:prepare-print", (id, order, title) => preparePrintPages(postStore, id, order, title));
appHandle("answers:export-pdf", (id, order, title) => generateAnswerPdf(id, order, title));
appHandle("answers:parse-external-review", (text) => parseExternalReview(typeof text === "string" ? text : ""));
appHandle("mistakes:export-pdf", async (title) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const target = await dialog.showSaveDialog(mainWindow, {
    title: "保存错题集 PDF",
    defaultPath: path.join(app.getPath("documents"), safePdfFileName(String(title || "错题集"))),
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
  });
  if (target.canceled || !target.filePath) return { canceled: true };
  const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  await fs.writeFile(target.filePath, pdf);
  return { canceled: false, filePath: target.filePath };
});

// 递归统计目录占用；读不到的条目按 0 处理
async function measurePathSize(target) {
  let bytes = 0;
  let entries = [];
  try { entries = await fs.readdir(target, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) bytes += await measurePathSize(full);
    else { try { bytes += (await fs.stat(full)).size; } catch {} }
  }
  return bytes;
}
const XHS_CACHE_DIRS = ["Cache", "Code Cache", "GPUCache", "DawnWebGPUCache", "DawnGraphiteCache", "ShaderCache", "GrShaderCache"];
const XHS_RESET_DIRS = [...XHS_CACHE_DIRS, "Local Storage", "Session Storage", "IndexedDB", "Service Worker", "WebStorage", "Trust Tokens", "Shared Dictionary", "blob_storage"];
function xhsSessionPartition() {
  return path.join(app.getPath("userData"), "Partitions", "xhs");
}
function xhsSessionInstance() {
  return xhsSession || session.fromPartition("persist:xhs");
}
// 小红书网页数据占用：分区总量、可清理的缓存部分与登录 Cookie 数
appHandle("xhs:cache-stats", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const partitionDir = xhsSessionPartition();
  const items = [];
  let total = 0;
  let cacheBytes = 0;
  let entries = [];
  try { entries = await fs.readdir(partitionDir, { withFileTypes: true }); } catch {}
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const bytes = await measurePathSize(path.join(partitionDir, entry.name));
    total += bytes;
    if (XHS_CACHE_DIRS.includes(entry.name)) cacheBytes += bytes;
    items.push({ name: entry.name, bytes });
  }
  items.sort((a, b) => b.bytes - a.bytes);
  let cookieCount = 0;
  try { cookieCount = (await xhsSessionInstance().getCookies({})).length; } catch {}
  return { totalBytes: total, cacheBytes, items, cookieCount };
});
// 清理浏览缓存：HTTP 缓存与着色器缓存，保留登录 Cookie 和本地资料
appHandle("xhs:clear-cache", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const ses = xhsSessionInstance();
  const partitionDir = xhsSessionPartition();
  let freed = 0;
  for (const name of XHS_CACHE_DIRS) {
    const dir = path.join(partitionDir, name);
    freed += await measurePathSize(dir);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  await ses.clearCache().catch(() => {});
  await ses.clearStorageData({ storages: ["shadercache", "cachestorage"] }).catch(() => {});
  const totalBytes = await measurePathSize(partitionDir);
  return { freedBytes: freed, totalBytes };
});
// 重置小红书网页数据：退出登录并清空全部网页数据，学生资料不受影响
appHandle("xhs:reset-data", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const ses = xhsSessionInstance();
  const partitionDir = xhsSessionPartition();
  const freedBytes = await measurePathSize(partitionDir);
  await ses.clearStorageData().catch(() => {});
  await ses.clearCache().catch(() => {});
  for (const name of XHS_RESET_DIRS) {
    await fs.rm(path.join(partitionDir, name), { recursive: true, force: true }).catch(() => {});
  }
  sendXhsState("loading", "小红书数据已重置，正在重新打开…");
  if (xhsView && !xhsView.webContents.isDestroyed()) {
    xhsView.webContents.loadURL("https://www.xiaohongshu.com/explore").catch(() => {});
  }
  return { freedBytes };
});

appHandle("diagnostics:export", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  let libraryCounts = {};
  try {
    const libraryPath = path.join(app.getPath("userData"), "library");
    for (const category of ["posts", "answers"]) {
      const dir = path.join(libraryPath, category);
      libraryCounts[category] = fsSync.existsSync(dir) ? fsSync.readdirSync(dir).filter((e) => fsSync.statSync(path.join(dir, e)).isDirectory()).length : 0;
    }
    const historyPath = path.join(libraryPath, "trainings", "history.json");
    libraryCounts.trainings = fsSync.existsSync(historyPath) ? JSON.parse(fsSync.readFileSync(historyPath, "utf8")).length : 0;
  } catch (e) { libraryCounts = { error: String(e.message || e) }; }
  const payload = {
    generatedAt: new Date().toISOString(),
    versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    platform: { os: process.platform, release: require("node:os").release(), arch: process.arch },
    library: libraryCounts,
    xhsState: currentXhsState,
    recentErrors: errorLogLines.slice(-100)
  };
  const target = await dialog.showSaveDialog(mainWindow, {
    title: "导出诊断信息",
    defaultPath: path.join(app.getPath("documents"), "exam2pdf-diagnostics-" + new Date().toISOString().slice(0, 10) + ".json"),
    filters: [{ name: "诊断信息", extensions: ["json"] }]
  });
  if (target.canceled || !target.filePath) return { canceled: true };
  await fs.writeFile(target.filePath, JSON.stringify(payload, null, 2));
  return { canceled: false, filePath: target.filePath };
});
// 应用内更新：Windows / Linux 用 electron-updater 手动下载并确认安装；
// macOS 安装包未签名，Squirrel 自动更新不可用，只查询最新版本并引导到下载页
let updateState = { stage: "idle" };
function pushUpdateState(patch) {
  updateState = { current: app.getVersion(), ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updates:state", updateState);
  }
}
function setupUpdateService() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on("update-available", (info) => pushUpdateState({ stage: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => pushUpdateState({ stage: "not-available" }));
  autoUpdater.on("download-progress", (progress) => pushUpdateState({ stage: "downloading", percent: Math.round(progress.percent || 0) }));
  autoUpdater.on("update-downloaded", (info) => pushUpdateState({ stage: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => pushUpdateState({ stage: "error", error: String((error && error.message) || error) }));
  setTimeout(() => { void checkForAppUpdate(); }, 5000);
}
async function fetchLatestReleaseVersion() {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { "User-Agent": "exam2pdf" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("GitHub API " + response.status);
  const data = await response.json();
  return String(data.tag_name || "").replace(/^v/i, "");
}
async function checkForAppUpdate() {
  if (!app.isPackaged) { pushUpdateState({ stage: "not-available", reason: "开发模式" }); return updateState; }
  if (process.platform === "darwin") {
    try {
      const latest = await fetchLatestReleaseVersion();
      pushUpdateState(compareVersions(latest, app.getVersion()) > 0
        ? { stage: "available", version: latest, manualDownload: true }
        : { stage: "not-available" });
    } catch (error) {
      pushUpdateState({ stage: "error", error: String(error.message || error) });
    }
    return updateState;
  }
  pushUpdateState({ stage: "checking" });
  try {
    const result = await require("electron-updater").autoUpdater.checkForUpdates();
    const version = result && result.updateInfo ? result.updateInfo.version : "";
    pushUpdateState(compareVersions(version, app.getVersion()) > 0
      ? { stage: "available", version }
      : { stage: "not-available" });
  } catch (error) {
    pushUpdateState({ stage: "error", error: String(error.message || error) });
  }
  return updateState;
}
appHandle("updates:state", () => updateState);
appHandle("updates:check", async () => { await checkForAppUpdate(); return updateState; });
appHandle("updates:download", async () => {
  if (process.platform === "darwin") { await shell.openExternal(RELEASES_PAGE); return updateState; }
  const { autoUpdater } = require("electron-updater");
  await autoUpdater.downloadUpdate();
  return updateState;
});
appHandle("updates:install", () => {
  if (process.platform === "darwin") throw new Error("macOS 未签名包请在下载页手动安装");
  require("electron-updater").autoUpdater.quitAndInstall();
});
appHandle("updates:open-page", async () => {
  await shell.openExternal(RELEASES_PAGE);
  return { ok: true };
});
// 运行时信息：带 --remote-debugging-port 启动时，本机任意进程都能通过调试端口
// 读取页面与登录态；渲染层据此显示常驻提醒，避免调试参数被当作日常用法
appHandle("app:runtime-info", () => ({
  remoteDebugging: app.commandLine.hasSwitch("remote-debugging-port") ||
    process.argv.some((arg) => String(arg).includes("remote-debugging-port"))
}));
// 将当前工作台页面按打印样式导出为 PDF（批阅报告等纯 HTML 页面），不弹系统打印面板
appHandle("workspace:export-pdf", async (title) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const target = await dialog.showSaveDialog(mainWindow, {
    title: "导出 PDF",
    defaultPath: path.join(app.getPath("documents"), safePdfFileName(String(title || "家卷错题集"))),
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }]
  });
  if (target.canceled || !target.filePath) return { canceled: true };
  const destination = /\.pdf$/i.test(target.filePath) ? target.filePath : target.filePath + ".pdf";
  const pdf = await mainWindow.webContents.printToPDF({
    pageSize: "A4",
    printBackground: true,
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
  });
  await fs.writeFile(destination, pdf);
  return { canceled: false, filePath: destination };
});

appHandle("answers:list", async () => {
  const answers = await answerStore.listPosts("answer");
  return Promise.all(answers.map((answer) => answerStore.getPost(answer.id)));
});
appHandle("answers:learning-stats", async () => {
  const answers = await answerStore.listPosts("answer");
  const completeAnswers = await Promise.all(answers.map((answer) => answerStore.getPost(answer.id)));
  return deriveLearningStats(completeAnswers);
});
appHandle("training:generate", (topic) => generatePractice(topic));
appHandle("training:generate-ai", async (topic) => {
  const credentials = await aiSettingsStore.getCredentials();
  return generateAiPractice({ ...credentials, topic });
});
appHandle("training:list", async () => {
  const [trainings, answers] = await Promise.all([trainingStore.list(), answerStore.listPosts("answer")]);
  return deriveTrainingProgress(trainings, answers).trainings;
});
appHandle("training:save", (practice) => trainingStore.create(practice));
appHandle("training:set-status", async (id, status) => {
  await trainingStore.get(id);
  if (status === "draft" && (await answerStore.listPosts()).some(answer => answer.trainingId === id)) throw new Error("已有作答关联这份练习，不能撤回审核");
  return trainingStore.setStatus(id, status);
});
appHandle("ai:get-settings", () => aiSettingsStore.getStatus());
appHandle("ai:save-settings", (settings) => aiSettingsStore.save(settings));
appHandle("ai:test-connection", async () => testAiConnection(await aiSettingsStore.getCredentials()));
appHandle("mobile-upload:start", async () => {
  if (mobileUploadStarting) return mobileUploadStarting;
  const studentId = requestStudentId();
  const revision = workspaceRevision;
  mobileUploadStarting = (async () => {
    if (mobileUploadServer) return mobileUploadState(mobileUploadServer);
    const studentName = (await studentStore.list()).find(student => student.id === studentId)?.name || "当前学生";
    const server = await startMobileUploadServer({
      getStudentId: () => studentId,
      studentName,
      onUploadReceived: notifyMobileUploadReceived
    });
    if (activeStudentId !== studentId || revision !== workspaceRevision) { await server.close(); throw new Error("学生已切换，请重新开启上传"); }
    mobileUploadServer = server;
    return mobileUploadState(server);
  })();
  const starting = mobileUploadStarting;
  try { return await starting; } finally { if (mobileUploadStarting === starting) mobileUploadStarting = null; }
});
appHandle("mobile-upload:state", () => mobileUploadServer
  ? mobileUploadState(mobileUploadServer)
  : { enabled: false, urls: [] });
appHandle("mobile-upload:stop", async () => {
  if (mobileUploadServer) {
    const server = mobileUploadServer;
    mobileUploadServer = null;
    await server.close();
  }
  return { enabled: false, urls: [] };
});
appHandle("backup:create", async () => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const selection = await dialog.showSaveDialog(mainWindow, {
    title: "导出 exam2pdf 数据备份",
    defaultPath: path.join(app.getPath("documents"), "exam2pdf-backup-" + timestamp + ".tar.gz"),
    filters: [{ name: "exam2pdf 备份", extensions: ["tar.gz"] }]
  });
  if (selection.canceled || !selection.filePath) return { canceled: true };
  const settingsProfile = await aiSettingsStore.getBackupProfile();
  return maintainLibrary(async () => ({ canceled: false, ...await createBackup(path.join(app.getPath("userData"), "library"), selection.filePath, settingsProfile, { overwrite: true }) }));
});
appHandle("backup:restore", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "选择 exam2pdf 数据备份",
    properties: ["openFile"],
    filters: [{ name: "exam2pdf 备份", extensions: ["tar.gz"] }]
  });
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "确认恢复本地备份",
    message: "恢复将替换所有学生的名册、试卷、作答和训练历史。",
    detail: "新备份还会恢复非敏感的 AI 服务商、模型和接口地址设置。备份不包含 API Key；恢复了 AI 设置时需要重新输入密钥。本操作不会更改小红书登录会话。",
    buttons: ["取消", "恢复并替换"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { canceled: true };
  await stopPhoneUpload();
  return maintainLibrary(async () => {
    const libraryPath = path.join(app.getPath("userData"), "library");
    const result = await restoreBackup(selection.filePaths[0], libraryPath);
    const settingsRestored = Boolean(result.settingsProfile);
    if (settingsRestored) await aiSettingsStore.save({ ...result.settingsProfile, apiKey: "", clearApiKey: true });
    await postStore.initialize();
    await answerStore.initialize();
    await trainingStore.initialize();
    const context = await studentWorkspace.initialize();
    activeStudentId = context.studentId; workspaceRevision++; collectionContexts.clear();
    syncSearchStudent();
    notifyStudentsChanged({ reset: true });
    notifyPostsChanged(null);
    notifyAnswersChanged(null);
    return { canceled: false, restoredRecords: result.restoredRecords, settingsRestored };
  });
});
appHandle("answers:get", (id) => answerStore.getPost(id));
appHandle("answers:create", async (payload) => {
  // 关联原卷的存在性与学生归属由带防护的试卷库校验（跨目录，仓库层无法自检）
  if (payload && payload.linkedPostId) await postStore.getPost(String(payload.linkedPostId));
  const result = await answerStore.createPost({
    ...payload,
    recordType: "answer",
    source: "本地导入",
    noteId: null,
    sourceUrl: "",
    subject: payload?.subject || inferSubject(payload?.title)
  });
  notifyAnswersChanged(result.post.id);
  return result;
});
appHandle("answers:set-subject", (id, subject) => {
  return answerStore.setSubject(id, subject).then((post) => {
    notifyAnswersChanged(id);
    return post;
  });
});
appHandle("answers:link-post", async (id, postId) => {
  if (postId) await postStore.getPost(String(postId)); // 确认原卷存在且属于当前学生
  return answerStore.setLinkedPost(id, postId).then((post) => {
    notifyAnswersChanged(id);
    return post;
  });
});
appHandle("answers:rename", async (id, title) => {
  const answer = await answerStore.renamePost(id, title);
  notifyAnswersChanged(id);
  return answer;
});
appHandle("answers:import-pdf", (input) => importAnswerPdf(input));
appHandle("answers:save-review", async (id, questions, confirmed, trainingId) => {
  await answerStore.getPost(id);
  if (trainingId) {
    const training = await trainingStore.get(trainingId);
    if (training.status !== "approved") throw new Error("只能关联已审核的练习");
  }
  const post = await answerStore.saveReview(id, questions, confirmed, trainingId);
  notifyAnswersChanged(id);
  return post;
});
appHandle("answers:ai-review", async (id) => {
  const answer = await answerStore.getPost(id);
  if (answer.recordType !== "answer") throw new Error("只有学生作答记录可以请求 AI 批阅");
  if (!Array.isArray(answer.pageOrder) || !answer.pageOrder.length || answer.pageOrder.length > 24) throw new Error("作答图片数量无效");
  const imagesByFile = new Map((answer.images || []).map((image) => [image.file, image]));
  const images = [];
  let totalBytes = 0;
  for (const file of answer.pageOrder) {
    if (typeof file !== "string") throw new Error("作答图片清单不完整，请检查本地记录");
    const image = imagesByFile.get(file);
    if (!image || path.basename(file) !== file || !/^page-\d{3}\.(?:jpe?g|png|webp)$/i.test(file)) throw new Error("作答图片清单不完整，请检查本地记录");
    if (!["image/jpeg", "image/png", "image/webp"].includes(image.mime)) throw new Error("作答图片格式不支持 AI 批阅");
    const imagePath = path.join(answerStore.postDirectory(id), file);
    const fileInfo = await fs.stat(imagePath);
    if (!fileInfo.isFile() || fileInfo.size > MAX_AI_REVIEW_INPUT_BYTES - totalBytes) throw new Error("作答图片合计超过 20 MB；请压缩图片后再尝试 AI 批阅");
    const bytes = await fs.readFile(imagePath);
    totalBytes += bytes.length;
    if (totalBytes > MAX_AI_REVIEW_INPUT_BYTES) throw new Error("作答图片合计超过 20 MB；请压缩图片后再尝试 AI 批阅");
    images.push({ mime: image.mime, bytes });
  }
  const credentials = await aiSettingsStore.getCredentials();
  return createAiReview({ ...credentials, images });
});
appHandle("answers:reorder", async (id, order) => {
  const post = await answerStore.reorderPost(id, order);
  notifyAnswersChanged(id);
  return post;
});
appHandle("answers:reset-order", async (id) => {
  const post = await answerStore.resetPostOrder(id);
  notifyAnswersChanged(id);
  return post;
});
appHandle("answers:remove-page", async (id, file) => {
  const post = await answerStore.removePostPage(id, file);
  notifyAnswersChanged(id);
  return post;
});
appHandle("answers:delete", async (id) => {
  const result = await answerStore.deletePost(id);
  notifyAnswersChanged(id);
  return result;
});

ipcMain.handle("xhs:begin-collection", (event) => {
  const url = xhsView?.webContents.getURL();
  if (!xhsView || event.sender !== xhsView.webContents || event.senderFrame?.url !== url || !noteIdFromUrl(url)) throw new Error("请打开笔记详情页");
  const token = randomUUID();
  collectionContexts.clear();
  collectionContexts.set(token, { studentId: activeStudentId, revision: workspaceRevision, url });
  return token;
});
ipcMain.handle("xhs:collect-post", async (event, payload) => {
  await libraryMaintenance;
  if (!xhsView || event.sender !== xhsView.webContents) throw new Error("采集请求来源无效");
  const sourceUrl = xhsView.webContents.getURL();
  const noteId = noteIdFromUrl(sourceUrl);
  if (event.senderFrame?.url !== sourceUrl) throw new Error("采集请求必须来自当前小红书笔记页面");
  if (!noteId) throw new Error("请打开小红书笔记详情页后再采集");
  const context = collectionContexts.get(payload?.scopeToken);
  if (!context || context.studentId !== activeStudentId || context.revision !== workspaceRevision || context.url !== sourceUrl) throw new Error("采集期间学生或笔记已切换，请重新采集");
  collectionContexts.delete(payload.scopeToken);
  const input = buildXhsCollectionInput(payload, sourceUrl, noteId);
  input.subject = input.subject || inferSubject(input.title);
  input.studentId = activeStudentId;
  const result = await postStore.createPost(input);  notifyPostsChanged(result.post.id);
  return result;
});

ipcMain.handle("xhs:fetch-image", async (event, imageUrl) => {
  if (!xhsView || event.sender !== xhsView.webContents || event.senderFrame?.url !== xhsView.webContents.getURL() || !noteIdFromUrl(xhsView.webContents.getURL())) {
    throw new Error("请先打开小红书笔记详情页");
  }
  if (typeof imageUrl !== "string" || imageUrl.length > 4096 || !isXhsImageUrl(imageUrl)) {
    throw new Error("图片链接不是小红书图片地址");
  }
  const headers = { referer: xhsView.webContents.getURL() };
  // 部分图床对自动化框架 UA 有限制；用页面 UA 但去掉 Electron 标识，与浏览器图片加载一致
  const pageUserAgent = xhsView.webContents.getUserAgent();
  if (pageUserAgent) headers["user-agent"] = pageUserAgent.replace(/\s*Electron\/[\d.]+/, "");
  let response;
  try {
    response = await xhsSession.fetch(imageUrl, {
      headers,
      signal: AbortSignal.timeout(20000)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.cause?.name === "TimeoutError") {
      throw new Error("下载超时（20 秒）");
    }
    throw new Error("网络请求失败：" + String(error?.message || error).slice(0, 160));
  }
  if (!response.ok) throw new Error("图片服务器返回 HTTP " + response.status);
  const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("image/")) throw new Error("链接返回的内容不是图片");
  const bytes = await responseBytesLimited(response, 16 * 1024 * 1024);
  return { mime, base64: bytes.toString("base64") };
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const libraryPath = path.join(app.getPath("userData"), "library");
    postStore = new PostStore(path.join(libraryPath, "posts"), { defaultSubject: "数学" });
    answerStore = new PostStore(path.join(libraryPath, "answers"), { defaultSubject: "数学" });
    trainingStore = new TrainingStore(path.join(libraryPath, "trainings"));
    studentStore = new StudentStore(libraryPath);
    aiSettingsStore = new AiSettingsStore(path.join(app.getPath("userData"), "config", "ai-settings.json"), safeStorage);
    await postStore.initialize();
    await answerStore.initialize();
    await trainingStore.initialize();
    await studentStore.initialize();
    rawAnswerStore = answerStore;
    studentWorkspace = new StudentWorkspace(libraryPath, studentStore, postStore, answerStore, trainingStore);
    const context = await studentWorkspace.initialize(); activeStudentId = context.studentId;
    postStore = scopedStore(postStore, requestStudentId);
    answerStore = scopedStore(answerStore, requestStudentId);
    trainingStore = scopedStore(trainingStore, requestStudentId, "training");
    setupUpdateService();
    protocol.handle("exam2pdf-media", async (request) => {
      try {
        const url = new URL(request.url);
        const file = decodeURIComponent(url.pathname.slice(1));
        let image;
        try { image = await postStore.resolveImage(url.hostname, file); }
        catch { image = await answerStore.resolveImage(url.hostname, file); }
        const { path: imagePath, mime } = image;
        const data = await fs.readFile(imagePath);
        return new Response(data, { headers: { "Content-Type": mime, "Cache-Control": "no-store" } });
      } catch {
        return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      }
    });
    setupApplicationMenu();
    createWindow();
    if (app.isPackaged) {
      try {
        const { autoUpdater } = require("electron-updater");
        autoUpdater.autoDownload = true;
        autoUpdater.on("update-downloaded", () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "家卷 更新",
            message: "新版本已下载完成",
            detail: "重启应用即可完成安装。",
            buttons: ["稍后", "重启安装"],
            defaultId: 1
          }).then(({ response }) => { if (response === 1) autoUpdater.quitAndInstall(); });
        });
        autoUpdater.on("error", (error) => { try { pushErrorLog("updater: " + String(error.message || error).slice(0, 300)); } catch (e) {} });
        autoUpdater.checkForUpdates().catch(() => {});
      } catch (e) { pushErrorLog("updater init: " + e.message); }
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    showInitializationFailure(error);
  });

  process.on("uncaughtException", (error) => {
  try { pushErrorLog("uncaughtException: " + String(error && error.stack ? error.stack.split("\n").slice(0, 2).join(" | ") : error)); } catch (e) {}
});
process.on("unhandledRejection", (reason) => {
  try { pushErrorLog("unhandledRejection: " + String(reason && reason.message ? reason.message : reason).slice(0, 300)); } catch (e) {}
});

// 顶部菜单栏：Windows/Linux 不需要（彻底移除，窗口释放空间）；
// macOS 系统级菜单栏无法移除，仅保留应用/编辑/窗口必需项（编辑菜单承载 Cmd+C/V 快捷键）
function setupApplicationMenu() {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { role: "windowMenu" }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

app.on("before-quit", () => {
    if (mobileUploadServer) {
      const server = mobileUploadServer;
      mobileUploadServer = null;
      server.close().catch(() => {});
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
