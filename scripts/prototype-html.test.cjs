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
  for (const selector of ["dialog", "dialog::backdrop", "[popover]", ".toast", ".boot-fatal"]) {
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
  for (const selector of ["html", "body", ".app", ".surface", "#mistakePrintArea", ".training-result"]) {
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

  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
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
});
