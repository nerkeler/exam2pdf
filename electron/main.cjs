const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, protocol, dialog, safeStorage } = require("electron");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const { PostStore } = require("./post-store.cjs");
const { createPrintHtml, safePdfFileName } = require("./print-document.cjs");
const { printAndCleanup } = require("./print-job.cjs");
const { deriveLearningStats } = require("./learning-stats.cjs");
const { generatePractice } = require("./training-generator.cjs");
const { generateAiPractice } = require("./ai-practice-service.cjs");
const { createBackup, restoreBackup } = require("./backup-service.cjs");
const { startMobileUploadServer } = require("./mobile-upload-server.cjs");
const { TrainingStore } = require("./training-store.cjs");
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
  resolveSearchGuidePosition,
  SEARCH_BUTTON_WIDTH,
  SEARCH_BUTTON_HEIGHT
} = require("./xhs-search.cjs");

const startupSmoke = process.env.EXAM2PDF_STARTUP_SMOKE === "1";
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
let aiSettingsStore;
let mobileUploadServer;
let xhsSession;
let xhsViewAttached = false;
let xhsSearchOverlayAttached = false;
let xhsSearchOverlayReady = false;
let xhsSearchPositionReady = false;
let xhsSearchPanelOpen = false;
let xhsSearchPosition = { left: 12, top: 12, width: SEARCH_BUTTON_WIDTH, height: SEARCH_BUTTON_HEIGHT };
let xhsSearchMeasureTimer;
let xhsSearchMeasureAttempts = 0;
let xhsSearchSyncTimer = null;
let xhsSearchMeasuring = false;
let xhsSearchAppliedWidth = 0;
let xhsPageRevision = 0;
let xhsReady = false;
let requestedXhsBounds = null;
let currentXhsState = { status: "loading", message: "正在打开小红书…" };
let startupFailureShown = false;
let libraryMaintenance = Promise.resolve();

function maintainLibrary(task) {
  const current = libraryMaintenance.then(() => withStoreLocks([postStore, answerStore, trainingStore], task));
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
  stopXhsSearchSync();
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
  // 侧栏折叠/展开时内嵌视图宽度会逐帧变化。按钮贴着搜索框右端，位置随视图宽度平移；
  // 这里先按宽度差保持“距右边缘的距离”不变，让按钮跟着一起滑，过渡结束后再由实测校正。
  if (xhsSearchAppliedWidth > 0 && Math.abs(base.width - xhsSearchAppliedWidth) > 0.5) {
    xhsSearchPosition = {
      ...xhsSearchPosition,
      left: Math.max(8, xhsSearchPosition.left + (base.width - xhsSearchAppliedWidth))
    };
  }
  xhsSearchAppliedWidth = base.width;
  const position = xhsSearchPosition;
  const buttonWidth = Math.min(position.width, Math.max(1, base.width - 16));
  const buttonHeight = Math.min(position.height, Math.max(1, base.height - 16));
  let overlayBounds;
  let panelWidth = Math.min(350, Math.max(180, base.width - 16));
  let panelHeight = Math.max(1, Math.min(500, base.height - position.top - buttonHeight - 24));

  if (xhsSearchPanelOpen) {
    const left = Math.max(8, Math.min(position.left + buttonWidth - panelWidth, base.width - panelWidth - 8));
    const top = Math.max(8, Math.min(position.top, base.height - buttonHeight - panelHeight - 16));
    overlayBounds = {
      x: Math.round(base.x + left),
      y: Math.round(base.y + top),
      width: Math.round(panelWidth),
      height: Math.round(buttonHeight + 8 + panelHeight)
    };
  } else {
    overlayBounds = {
      x: Math.round(base.x + position.left),
      y: Math.round(base.y + position.top),
      width: Math.round(buttonWidth),
      height: Math.round(buttonHeight)
    };
    panelWidth = Math.min(350, Math.max(180, base.width - 16));
  }

  if (!xhsViewAttached) {
    mainWindow.contentView.addChildView(xhsView);
    xhsViewAttached = true;
    xhsView.setBounds({
      x: Math.round(base.x), y: Math.round(base.y),
      width: Math.round(base.width), height: Math.round(base.height)
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

async function measureXhsSearchPosition(options = {}) {
  const quiet = options.quiet === true;
  if (!xhsView || xhsView.webContents.isDestroyed() || !xhsReady || !requestedXhsBounds?.visible) return;
  const measuredView = xhsView;
  const measuredBounds = requestedXhsBounds;
  const measuredRevision = xhsPageRevision;
  let measured = null;
  try {
    measured = await measuredView.webContents.executeJavaScript(`(() => {
      const visibleRect = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 160 || rect.height < 20) return null;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") return null;
        return rect;
      };
      // 小红书页面上的 #search-input 是 0×0 的隐藏节点，真正可见的输入框是 textarea/可编辑节点，
      // 因此按可见性挑选候选，而不是取 DOM 里第一个匹配。
      const selectors = [
        "#search-input-in-feeds",
        "#search-input",
        "[class*='search'] textarea",
        "[class*='search'] input",
        "textarea[placeholder*='搜索']",
        "input[placeholder*='搜索']",
        "textarea[placeholder*='小红书']",
        "input[placeholder*='小红书']"
      ];
      let input = null;
      let inputBounds = null;
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const rect = visibleRect(el);
          if (rect) { input = el; inputBounds = rect; break; }
        }
        if (input) break;
      }
      if (!input) return null;
      // 输入框外侧的可视圆角容器才是按钮需要让开的边界。
      let row = inputBounds;
      let ancestor = input.parentElement;
      for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parentElement) {
        const rect = ancestor.getBoundingClientRect();
        if (rect.width < inputBounds.width || rect.height <= 0 || rect.height > Math.max(inputBounds.height * 3, 96)) continue;
        if (!/search|input-box|textarea-container|wrapper/i.test(String(ancestor.className || ""))) continue;
        row = rect;
      }
      const box = (rect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      return { input: box(inputBounds), row: box(row), viewport: { width: window.innerWidth, height: window.innerHeight } };
    })()`, true);
  } catch (error) {
    if (!quiet) console.warn("Unable to measure the Xiaohongshu search box:", error.message);
  }

  // A page navigation, screen switch, resize, or window close may finish while the
  // renderer is measuring. Discard that result rather than reopening an obsolete view.
  if (xhsView !== measuredView || measuredView.webContents.isDestroyed() ||
      requestedXhsBounds !== measuredBounds || !xhsReady || !requestedXhsBounds?.visible ||
      xhsPageRevision !== measuredRevision) return;

  if (!measured && !quiet && xhsSearchMeasureAttempts < 8) {
    xhsSearchMeasureAttempts++;
    xhsSearchMeasureTimer = setTimeout(() => { void measureXhsSearchPosition(); }, 500);
    return;
  }
  if (!measured && quiet && xhsSearchPositionReady) return;

  const viewport = measured ? measured.viewport : { width: requestedXhsBounds.width, height: requestedXhsBounds.height };
  const next = resolveSearchGuidePosition(measured ? measured.input : null, measured ? measured.row : null, viewport, {
    width: SEARCH_BUTTON_WIDTH,
    height: SEARCH_BUTTON_HEIGHT
  });
  const changed = !xhsSearchPositionReady || !sameXhsSearchPosition(next, xhsSearchPosition);
  xhsSearchPosition = next;
  xhsSearchPositionReady = true;
  xhsSearchMeasureAttempts = 0;
  if (changed) applyXhsSearchOverlayBounds();
}

function sameXhsSearchPosition(a, b) {
  return ["left", "top", "width", "height"].every((key) => a[key] === b[key]);
}

function scheduleXhsSearchPosition() {
  clearTimeout(xhsSearchMeasureTimer);
  xhsSearchMeasureAttempts = 0;
  xhsSearchMeasureTimer = setTimeout(() => { void measureXhsSearchPosition(); }, 180);
}

// 小红书的搜索区会随页面状态变化尺寸（大卡片 / 吸顶窄条），
// 低频复测一次即可让按钮始终贴着搜索框，避免布局切换后压住输入框。
function startXhsSearchSync() {
  if (xhsSearchSyncTimer) return;
  xhsSearchSyncTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !requestedXhsBounds?.visible || xhsSearchMeasuring) return;
    xhsSearchMeasuring = true;
    measureXhsSearchPosition({ quiet: true }).finally(() => { xhsSearchMeasuring = false; });
  }, 2000);
  xhsSearchSyncTimer.unref?.();
}

function stopXhsSearchSync() {
  clearTimeout(xhsSearchMeasureTimer);
  clearInterval(xhsSearchSyncTimer);
  xhsSearchSyncTimer = null;
  xhsSearchMeasuring = false;
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
    xhsSearchAppliedWidth = 0;
    hideXhsView();
    return;
  }
  const bounds = [requested.x, requested.y, requested.width, requested.height].map(Number);
  if (!bounds.every(Number.isFinite) || bounds[2] < 1 || bounds[3] < 1) {
    requestedXhsBounds = null;
    xhsSearchPanelOpen = false;
    xhsSearchPositionReady = false;
    xhsSearchAppliedWidth = 0;
    hideXhsView();
    return;
  }
  requestedXhsBounds = { x: bounds[0], y: bounds[1], width: bounds[2], height: bounds[3], visible: true };
  applyXhsBounds();
  scheduleXhsSearchPosition();
  startXhsSearchSync();
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
  xhsView.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    xhsPageRevision++;
    if (isInPlace) return;
    xhsReady = false;
    xhsSearchPanelOpen = false;
    xhsSearchPositionReady = false;
    xhsSearchAppliedWidth = 0;
    xhsSearchMeasureAttempts = 0;
    hideXhsView();
    sendXhsState("loading", "小红书页面正在加载…");
  });

  xhsView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    xhsReady = false;
    hideXhsView();
    sendXhsState("error", "小红书加载失败：" + String(errorDescription || "网络暂不可用") + "；若持续失败，可切换网络（如手机热点）后点重试");
  });

  xhsView.webContents.on("did-finish-load", () => {
    if (!isXhsUrl(xhsView.webContents.getURL())) return;
    xhsReady = true;
    applyXhsBounds();
    scheduleXhsSearchPosition();
    startXhsSearchSync();
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

  sendXhsState("loading", "正在打开小红书…");
  xhsView.webContents.loadURL("https://www.xiaohongshu.com/explore").catch((error) => {
    sendXhsState("error", "小红书加载失败：" + String(error.message || error));
  });
}

function createWindow() {
  startupFailureShown = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    show: false,
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
  mainWindow.on("resize", () => {
    applyXhsBounds();
    scheduleXhsSearchPosition();
  });
  mainWindow.on("closed", () => {
    stopXhsSearchSync();
    if (xhsView && !xhsView.webContents.isDestroyed()) xhsView.webContents.close();
    if (xhsSearchOverlayView && !xhsSearchOverlayView.webContents.isDestroyed()) xhsSearchOverlayView.webContents.close();
    xhsView = null;
    xhsSearchOverlayView = null;
    xhsViewAttached = false;
    xhsSearchOverlayAttached = false;
    xhsSearchOverlayReady = false;
    xhsSearchPositionReady = false;
    xhsSearchAppliedWidth = 0;
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
  mainWindow.setTitle("exam2pdf · 启动失败");
  mainWindow.show();
  mainWindow.webContents.loadURL(createStartupErrorUrl(message)).catch((fallbackError) => {
    dialog.showErrorBox("exam2pdf 启动失败", message + "\n\n诊断页面加载失败：" + String(fallbackError.message || fallbackError));
  });
}

function showInitializationFailure(error) {
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
      "exam2pdf 启动失败",
      String(error && error.message ? error.message : error) + "\n\n无法打开诊断窗口：" + String(windowError.message || windowError)
    );
    app.quit();
  }
}

function appHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isAppWindow(event)) throw new Error("此操作只能从 exam2pdf 工作台发起");
    await libraryMaintenance;
    return handler(...args);
  });
}

function notifyPostsChanged(id) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("posts:changed", { id });
  }
}

function notifyAnswersChanged(id) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("answers:changed", { id });
  }
}

async function preparePrintWindow(store, postId, order, requestedTitle, showWindow) {
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
      parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    try {
      await printWindow.loadFile(printFile);
      const imagesReady = await printWindow.webContents.executeJavaScript(
        'Promise.all(Array.from(document.images, image => image.decode().then(() => true).catch(() => false)))'
      );
      if (!imagesReady.every(Boolean)) throw new Error("有图片未能载入，尚未生成打印文件");
      if (showWindow) printWindow.show();
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
  const prepared = await preparePrintWindow(store, id, order, title, false);
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

async function printPost(postId, order, title) {
  const prepared = await preparePrintWindow(postStore, postId, order, title, true);
  return printAndCleanup(prepared.printWindow, prepared.printDirectory);
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
appHandle("posts:print", (id, order, title) => printPost(id, order, title));
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
// 将当前工作台页面按打印样式导出为 PDF（批阅报告等纯 HTML 页面），不弹系统打印面板
appHandle("workspace:export-pdf", async (title) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("窗口不可用");
  const target = await dialog.showSaveDialog(mainWindow, {
    title: "导出 PDF",
    defaultPath: path.join(app.getPath("documents"), safePdfFileName(String(title || "exam2pdf"))),
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
appHandle("training:set-status", (id, status) => trainingStore.setStatus(id, status));
appHandle("ai:get-settings", () => aiSettingsStore.getStatus());
appHandle("ai:save-settings", (settings) => aiSettingsStore.save(settings));
appHandle("ai:test-connection", async () => testAiConnection(await aiSettingsStore.getCredentials()));
appHandle("mobile-upload:start", async () => {
  if (mobileUploadServer) return { enabled: true, urls: mobileUploadServer.urls };
  mobileUploadServer = await startMobileUploadServer({
    answerStore,
    onUploaded: (answer) => notifyAnswersChanged(answer.id)
  });
  return { enabled: true, urls: mobileUploadServer.urls };
});
appHandle("mobile-upload:state", () => mobileUploadServer
  ? { enabled: true, urls: mobileUploadServer.urls }
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
    message: "恢复将替换当前帖子池、学生作答记录和训练历史。",
    detail: "新备份还会恢复非敏感的 AI 服务商、模型和接口地址设置。备份不包含 API Key；恢复了 AI 设置时需要重新输入密钥。本操作不会更改小红书登录会话。",
    buttons: ["取消", "恢复并替换"],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
  if (confirmation.response !== 1) return { canceled: true };
  return maintainLibrary(async () => {
    const libraryPath = path.join(app.getPath("userData"), "library");
    const result = await restoreBackup(selection.filePaths[0], libraryPath);
    const settingsRestored = Boolean(result.settingsProfile);
    if (settingsRestored) await aiSettingsStore.save({ ...result.settingsProfile, apiKey: "", clearApiKey: true });
    await postStore.initialize();
    await answerStore.initialize();
    await trainingStore.initialize();
    notifyPostsChanged(null);
    notifyAnswersChanged(null);
    return { canceled: false, restoredRecords: result.restoredRecords, settingsRestored };
  });
});
appHandle("answers:get", (id) => answerStore.getPost(id));
appHandle("answers:create", async (payload) => {
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
appHandle("answers:rename", async (id, title) => {
  const answer = await answerStore.renamePost(id, title);
  notifyAnswersChanged(id);
  return answer;
});
appHandle("answers:import-pdf", (input) => importAnswerPdf(input));
appHandle("answers:save-review", async (id, questions, confirmed, trainingId) => {
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

ipcMain.handle("xhs:collect-post", async (event, payload) => {
  if (!xhsView || event.sender !== xhsView.webContents) throw new Error("采集请求来源无效");
  const sourceUrl = xhsView.webContents.getURL();
  const noteId = noteIdFromUrl(sourceUrl);
  if (event.senderFrame?.url !== sourceUrl) throw new Error("采集请求必须来自当前小红书笔记页面");
  if (!noteId) throw new Error("请打开小红书笔记详情页后再采集");
  const input = buildXhsCollectionInput(payload, sourceUrl, noteId);
  input.subject = input.subject || inferSubject(input.title);
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
    aiSettingsStore = new AiSettingsStore(path.join(app.getPath("userData"), "config", "ai-settings.json"), safeStorage);
    await postStore.initialize();
    await answerStore.initialize();
    await trainingStore.initialize();
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
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error) => {
    showInitializationFailure(error);
  });

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
