const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "frontend", "i18n.js"), "utf8");

function createContext({ stored } = {}) {
  const store = new Map(Object.entries(stored || {}));
  const elements = [];
  return {
    store,
    elements,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value))
    },
    location: { reload() { this.reloaded = true; } },
    document: {
      documentElement: { lang: "zh-CN" },
      querySelectorAll() { return elements; }
    },
    register(element) { elements.push(element); }
  };
}

function loadI18n(context) {
  context.window = {};
  const vm = require("node:vm");
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "i18n.js" });
  return context.window.exam2pdfI18n;
}

test("t() falls back to the Chinese source key and applies parameter slots", () => {
  const i18n = loadI18n(createContext());
  assert.equal(i18n.currentLanguage(), "zh-CN");
  assert.equal(i18n.t("试卷库"), "试卷库");
  assert.equal(i18n.t("{n} 页", { n: 3 }), "3 页");
  assert.equal(i18n.t("来源：{x}", { x: "小红书" }), "来源：小红书");
});

test("english dictionary translates known keys and keeps unknown keys Chinese", () => {
  const i18n = loadI18n(createContext({ stored: { "exam2pdf-lang": "en" } }));
  assert.equal(i18n.currentLanguage(), "en");
  assert.ok(i18n.isEnglish());
  assert.equal(i18n.t("试卷库"), "Paper Library");
  assert.equal(i18n.t("{n} 张图", { n: 6 }), "6 photos");
  // 未覆盖键回退中文原文，绝不显示键名占位符
  assert.equal(i18n.t("绝不存在的键"), "绝不存在的键");
});

test("setLanguage persists the choice and reloads for a full re-render", () => {
  const context = createContext();
  const i18n = loadI18n(context);
  i18n.setLanguage("en");
  assert.equal(context.store.get("exam2pdf-lang"), "en");
  assert.equal(context.location.reloaded, true);
  i18n.setLanguage("en");
  assert.equal(context.location.reloaded, true, "same-language switch must not reload again");
  i18n.setLanguage("zh-CN");
  assert.equal(context.store.get("exam2pdf-lang"), "zh-CN");
});

test("applyStatic translates tagged elements and accepts missing nodes", () => {
  const context = createContext({ stored: { "exam2pdf-lang": "en" } });
  const i18n = loadI18n(context);
  context.register({
    getAttribute: (name) => (name === "data-i18n" ? "试卷库" : null),
    textContent: "",
    setAttribute() {}
  });
  context.register({
    getAttribute: (name) => (name === "data-i18n-placeholder" ? "试卷名称" : null),
    textContent: "",
    setAttribute(name, value) { this[name] = value; },
    placeholder: ""
  });
  context.register({
    getAttribute: () => null,
    textContent: ""
  });
  i18n.applyStatic();
  assert.equal(context.elements[0].textContent, "Paper Library");
  assert.equal(context.elements[1].placeholder, "Paper Title");
  assert.equal(context.document.documentElement.lang, "en");
});

test("every data-i18n key used by the workspace exists in every dictionary", () => {
  const html = fs.readFileSync(path.join(root, "docs", "原型图.html"), "utf8");
  const keys = [...html.matchAll(/data-i18n(?:-placeholder|-aria)?="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(new Set(keys).size >= 40, "workspace must tag a meaningful set of static strings");
  for (const [lang, dict] of Object.entries(loadI18n(createContext()).DICTS)) {
    const missing = [...new Set(keys)].filter((key) => !(typeof dict[key] === "string" && dict[key].length));
    assert.deepEqual(missing, [], lang + " dictionary must cover every tagged key");
  }
  // 译文不能与中文原文相同（防止假翻译占位）
  const en = loadI18n(createContext()).DICTS.en;
  const untranslated = Object.entries(en).filter(([key, value]) => key !== "家卷" && value === key).map(([key]) => key);
  assert.deepEqual(untranslated, [], "english values must actually translate their keys");
});

test("the workspace wires the language toggle and ships the dictionary", () => {
  const html = fs.readFileSync(path.join(root, "docs", "原型图.html"), "utf8");
  assert.match(html, /<script src="\.\.\/frontend\/i18n.js"><\/script>/, "workspace must load the i18n module");
  assert.match(html, /id="langToggle"/, "sidebar must expose the language toggle");
  assert.match(html, /action === "toggle-language"/, "language toggle must be dispatched");
  assert.match(html, /window\.exam2pdfI18n\.applyStatic\(\)/, "static translations must apply at boot");
  assert.match(html, /const tt = \(key, params\)/, "renderers must translate through tt()");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.ok(pkg.build.files.includes("frontend/i18n.js"), "i18n dictionary must ship in the desktop build");
});
