const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function getPrintBlocks(html) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]).join("\n");
  const printBlocks = [];
  for (const match of css.matchAll(/@media\s+print\s*\{/g)) {
    let depth = 1;
    let end = match.index + match[0].length;
    const start = end;
    while (end < css.length && depth) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    printBlocks.push(css.slice(start, end - 1));
  }
  return printBlocks;
}

test("all print modes suppress transient UI overlays through media CSS", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  const printBlocks = getPrintBlocks(html);
  const hiddenSelectors = new Set();
  for (const block of printBlocks) {
    for (const rule of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/display\s*:\s*none\s*!important/.test(rule[2])) continue;
      rule[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").forEach((selector) => hiddenSelectors.add(selector.trim()));
    }
  }
  for (const selector of ["dialog", "dialog::backdrop", "[popover]", ".toast", ".boot-fatal", ".theme-menu"]) {
    assert.ok(hiddenSelectors.has(selector), selector + " must be hidden in every print mode without closing its interactive UI state");
  }
  assert.ok(hiddenSelectors.has("body.printing-report #s4 > .toolbar"));
});

test("print palette explicitly overrides dark body variables and paper backgrounds", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  const rules = getPrintBlocks(html).flatMap((block) => [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)])
    .map((rule) => ({ selectors: rule[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((selector) => selector.trim()), declarations: rule[2] }));
  const palette = rules.find((rule) => rule.selectors.includes('body[data-theme="dark"]'));
  assert.ok(palette, "paper colors must override body-local dark variables, not only :root");
  for (const [property, value] of [["--surface", "#fff"], ["--text", "#20242b"], ["--muted", "#526073"], ["color-scheme", "light"]]) {
    assert.ok(palette.declarations.includes(property + ": " + value + " !important;"), property + " must retain its light print value");
  }
  for (const selector of ["html", "body", ".app", ".surface", "#mistakePrintArea", "#postPrintArea", ".training-result"]) {
    assert.ok(rules.some((rule) => rule.selectors.includes(selector) && /background:\s*#fff\s*!important/.test(rule.declarations)), selector + " must have white paper in every print mode");
  }
  assert.ok(rules.some((rule) => rule.selectors.includes("mark.key-point") && /color:\s*#584000\s*!important/.test(rule.declarations)));
});

test("workspace HTML has valid inline JavaScript and unique static IDs", () => {
  const htmlPath = path.join(__dirname, "..", "docs", "原型图.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]));
  assert.ok(scripts.length > 0, "workspace must include its application script");
  scripts.forEach((match, index) => new vm.Script(match[2], { filename: htmlPath + " inline script " + (index + 1) }));

  const externalScripts = [...html.matchAll(/<script\b([^>]*)\bsrc=["']([^"']+)["'][^>]*>\s*<\/script\s*>/gi)];
  for (const match of externalScripts) {
    const scriptPath = path.resolve(path.dirname(htmlPath), match[2]);
    assert.ok(fs.existsSync(scriptPath), "referenced script must exist: " + match[2]);
    new vm.Script(fs.readFileSync(scriptPath, "utf8"), { filename: scriptPath });
  }
  const packageConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(packageConfig.build.files.includes("frontend/page-reorder.js"), "touch reordering helper must be included in the desktop build");

  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const ids = [...markup.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, "static DOM IDs must be unique");
  assert.match(html, /id="renderFatal"/, "workspace must expose a visible runtime failure panel");
  assert.match(html, /window\.addEventListener\("error"/);
  assert.match(html, /window\.__exam2pdfBootComplete = true/);
  assert.match(html, /data-action="generate-ai-training"/, "AI practice generation must be available from the learning screen");
  assert.match(html, /生成结果需检查题目和答案后才能打印/, "AI generated practice must retain the parent review gate");
  assert.match(html, /data-action="pick-post-detail-files"/, "post details must allow adding local pages");
  assert.match(html, /desktop\.appendPostImages\(post\.id, images\)/, "supplemental pages must be persisted to the active post");
  const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8");
  assert.match(preload, /generateAiTraining\(topic\)[\s\S]*training:generate-ai/);
  assert.match(preload, /appendPostImages\(id, images\)[\s\S]*posts:append-images/);
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /appHandle\("posts:append-images"/);
  // 小红书原生置顶视图会盖住所有 HTML：dialog 与浮动菜单（主题选择）打开期间必须隐藏
  assert.match(html, /function hasOpenOverlay\(\)/);
  assert.match(html, /dialog\[open\], \.theme-menu:not\(\[hidden\]\)/);
  assert.match(html, /visible: active && !hasOpenOverlay\(\) && right > left && bottom > top/);
  // attributeFilter 必须是数组——写成字符串会抛 TypeError 并炸掉整个 electron-shell 初始化块
  assert.match(html, /attributeFilter: \["open", "hidden"\]/);
  // 外观模式三态：跟随系统 / 浅色 / 深色（localStorage 存模式，system 实时跟随系统变化）
  assert.match(html, /function resolveTheme\(mode\)/);
  assert.match(html, /data-theme-mode="system"/);
  assert.match(html, /data-theme-mode="light"/);
  assert.match(html, /data-theme-mode="dark"/);
  assert.match(html, /localStorage\.setItem\("exam2pdf-theme", mode\)/);
  assert.match(html, /onSystemThemeChange/);
});

test("grading screen hosts the mobile upload tab and the old settings entry is gone", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  assert.match(html, /id="gradeTabLocal"/, "grading import must offer a local tab");
  assert.match(html, /id="gradeTabMobile"/, "grading import must offer a mobile upload tab");
  assert.match(html, /id="gradePaneMobile" role="tabpanel" hidden/, "mobile pane starts hidden behind its tab");
  // 手机上传面板整体迁入批阅页：开关与二维码容器必须位于手机标签页内
  const mobilePaneIndex = html.indexOf('id="gradePaneMobile"');
  const lanSwitchIndex = html.indexOf('id="lanSwitch"');
  const qrIndex = html.indexOf('id="uploadQrCodes"');
  assert.ok(mobilePaneIndex >= 0 && mobilePaneIndex < lanSwitchIndex && lanSwitchIndex < qrIndex, "mobile upload controls must live inside the grading mobile pane");
  assert.ok(!html.includes('data-action="show-upload-link"'), "old settings QR entry must be removed with the panel");
  // 手机上传不直接落库：主进程移交渲染层进暂存区，确认后才保存（与本地导入同流水线）
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /onUploadReceived: async \(payload\) => \{[\s\S]*?await writeUploadInbox\(payload\)/, "upload server must hand photos to the renderer, not save them");
  assert.match(main, /send\("mobile-upload:received", payload\)/);
  assert.doesNotMatch(main, /source: "mobile-upload" \}\)/, "direct-save notifications must be retired");
  assert.match(html, /function receiveMobileUpload/, "uploaded photos must be staged through the renderer");
  assert.match(html, /desktop\.onMobileUploadReceived\(/, "renderer must subscribe to upload payloads");
  assert.match(html, /importImage\(blob, \{ kind: "answer" \}\)/, "uploaded photos must reuse the local-import compression");
  assert.match(html, /state\.gradePages\.push\(\.\.\.staged\)/, "uploaded photos must land in the editable staging area");
  // 局域网上传默认开启：必须等当前学生上下文加载完再自动拉起服务
  assert.match(html, /function autoStartMobileUpload/, "LAN upload must auto-start as the default state");
  assert.match(html, /loadStudents\(\)\.then\(async \(\) => \{ await restoreGradeStaging\(\)/, "auto-start must wait for the active student context");
  // 收到上传必须是弹窗引导核对保存，而非"已保存"轻提示
  assert.match(html, /id="mobileUploadDoneDialog"/, "upload receipt must surface a dialog");
  assert.match(html, /function showMobileUploadReceived/, "receipt dialog must be wired to the upload event");
  assert.match(html, /请核对页序后点「保存作答记录」入库/, "dialog must instruct confirming before save");
});

test("post library offers one-click direct printing with preparation feedback", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  assert.match(html, /data-action="print-post"/, "post library cards must offer direct printing");
  assert.match(html, /action === "print-post"\) await runPostExport\("print", post\)/, "card print must reuse the shared export runner");
  assert.match(html, /正在准备打印/, "printing must show preparation feedback before the dialog appears");
  assert.match(html, /postExportBusy/, "print and PDF exports must be re-entrancy guarded");
  assert.match(html, /id="postPrintArea"/, "direct print must render through the main-window print area like the mistake book");
  assert.match(html, /body\.printing-post \.app { display: none !important; }/, "post print mode must hide the app shell");
  assert.match(html, /desktop\.preparePostPrint\(/, "renderer must request in-memory print pages");
  assert.doesNotMatch(html, /desktop\.printPost\(/, "the hidden-window print bridge must be retired");
  assert.match(html, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => area\.replaceChildren\(\)\)\)/, "print cleanup must release page data a frame after the dialog closes to avoid flicker");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /appHandle\("posts:prepare-print"/, "main must serve in-memory print pages");
  assert.ok(!/"posts:print"/.test(main), "the hidden-window print IPC must be retired");
  assert.match(main, /paintWhenInitiallyHidden: true/, "PDF export host window must keep rendering while hidden");
  assert.ok(!/printWindow\.show(?:Inactive)?\(/.test(main), "no print path may surface a host window");
});

test("mobile upload staging survives reloads, restarts and partial failures", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  // 单张失败只跳过该张，不再整批丢弃；手机端已显示成功时电脑端绝不能静默丢内容
  assert.ok(html.includes("let failed = 0;"), "receiveMobileUpload must be resilient per image");
  assert.ok(html.includes("会超出 24 页上限"), "overflow batches must be rejected with a clear message, never silently truncated");
  assert.ok(html.includes("state.gradePages.push(...staged);") && html.includes("const saveOk = await saveGradeStagingNow();"), "successfully staged pages must land in the editor and persist before the inbox is dropped");
  assert.match(html, /desktop\.discardMobileUploadInbox\(payload\.inboxFile\)/, "inbox file must be discarded only after successful staging");
  assert.match(html, /function persistGradeStaging\(\)/, "staged pages must persist per student");
  assert.match(html, /if \(kind === "grade"\) \{ updateGradeImportVisibility\(\); persistGradeStaging\(\); \}/, "every grade grid re-render must persist staging");
  assert.match(html, /await restoreGradeStaging\(\); await recoverPendingUploads\(\); await autoStartMobileUpload\(\)/, "boot must restore staging, replay the upload inbox, then auto-start upload");
  assert.match(html, /await clearGradeStaging\(\);/, "saving an answer must clear the staging file");
  const preload = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.cjs"), "utf8");
  assert.match(preload, /saveGradeStaging\(pages\)[\s\S]*?grade-staging:save/, "staging save must be bridged");
  assert.match(preload, /grade-staging:\)/, "staging channels must be student-generation scoped");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /appHandle\("grade-staging:save"/, "main must expose staging persistence");
  assert.match(main, /await writeUploadInbox\(payload\);\n        notifyMobileUploadReceived/, "uploads must land in the inbox before the renderer processes them");
  assert.match(main, /appHandle\("mobile-upload:pending"/, "main must expose the pending inbox for boot recovery");
  const store = fs.readFileSync(path.join(__dirname, "..", "electron", "grade-staging.cjs"), "utf8");
  assert.match(store, /class GradeStagingStore/, "staging store module must exist");
  assert.match(store, /MAX_PAGES = 24/, "staging must keep the 24-page cap");
});

test("image preview supports rotation with write-back across print paths", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  assert.match(html, /data-action="preview-rotate"/, "viewer must expose rotate controls");
  assert.match(html, /previewState\.rotation/, "viewer zoom fit must account for preview rotation");
  assert.match(html, /function postRotateContext/, "post pages must persist rotation via the desktop bridge");
  assert.match(html, /function gradeRotateContext/, "staged pages must keep rotation in memory until save");
  assert.match(html, /function bakePageRotation/, "staged rotation must be baked into saved answer images");
  assert.match(html, /state\.gradePages\.map\(bakePageRotation\)/, "answer save must bake staged rotations");
  assert.match(html, /desktop\.rotatePostPage\(/, "renderer must call the rotation bridge");
  assert.match(html, /rotation: postImageRotation\(post, file\)/, "post page items must carry rotation into the viewer");
  assert.match(html, /transform:rotate/, "print sheets must honor rotation");
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(main, /appHandle\("posts:rotate-page"/, "main must expose the rotation IPC");
  assert.match(main, /rotation: image\.rotation \|\| 0/, "direct-print pages must carry rotation");
  const store = fs.readFileSync(path.join(__dirname, "..", "electron", "post-store.cjs"), "utf8");
  assert.match(store, /async setPageRotation/, "post store must persist rotation metadata");
  // 作答照片导出必须跳过裁边：裁边按背景色判定会裁掉浅色题目内容（实测丢题）
  assert.match(main, /answerMode \? \{ trim: false \} : undefined/, "answer PDF export must skip auto-trim");
  assert.match(main, /exportPdfViaDialog\(answerStore, answerId, order, title, "保存作答 PDF", true\)/, "answer PDFs must run in answer mode");
});
