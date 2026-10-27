const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AI_PROVIDERS, providerPreset } = require("./ai-providers.cjs");
const { AiSettingsStore } = require("./ai-settings-store.cjs");

test("provider presets are complete, distinct, and use HTTPS endpoints", () => {
  const ids = AI_PROVIDERS.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length, "provider ids must be unique");
  for (const provider of AI_PROVIDERS) {
    assert.ok(provider.label, provider.id + " needs a label");
    if (provider.id === "openai-compatible") {
      // OpenAI 兼容接口由用户按第三方文档填写，不预设端点/模型
      assert.equal(provider.baseUrl, "");
      assert.equal(provider.model, "");
      continue;
    }
    assert.match(provider.baseUrl, /^https:\/\//, provider.id + " endpoint must be HTTPS");
    assert.ok(provider.model, provider.id + " needs a default model");
  }
  assert.equal(providerPreset("nope"), null);
});

function fakeSafeStorage() {
  return {
    async isAsyncEncryptionAvailable() { return true; },
    async encryptStringAsync(value) { return Buffer.from("encrypted:" + value); },
    async decryptStringAsync(value) { return value.toString("utf8").replace(/^encrypted:/, ""); }
  };
}

test("unset endpoint/model fall back to the selected provider's own preset", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-ai-providers-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore(path.join(root, "ai-settings.json"), fakeSafeStorage());
  // 只有服务商被设置过（例如外部备份/手改配置缺字段）时，端点与模型跟随该服务商预设
  await fs.writeFile(path.join(root, "ai-settings.json"), JSON.stringify({ provider: "zhipu", encryptedKey: "" }));
  const status = await store.getStatus();
  assert.equal(status.provider, "zhipu");
  assert.equal(status.baseUrl, providerPreset("zhipu").baseUrl);
  assert.equal(status.model, providerPreset("zhipu").model);
  // 状态里携带全量预设，渲染层切换服务商时据此自动带出
  assert.deepEqual(status.providers, AI_PROVIDERS);
  // 读取凭据时同样按服务商预设补全缺失的端点/模型
  const encrypted = Buffer.from("encrypted:k2").toString("base64");
  await fs.writeFile(path.join(root, "ai-settings.json"), JSON.stringify({ provider: "kimi", encryptedKey: encrypted }));
  const credentials = await store.getCredentials();
  assert.equal(credentials.provider, "kimi");
  assert.equal(credentials.baseUrl, providerPreset("kimi").baseUrl);
  assert.equal(credentials.model, providerPreset("kimi").model);
  assert.equal(credentials.apiKey, "k2");
});

test("workspace auto-fills endpoint and model when the provider changes", () => {
  const html = fsSync.readFileSync(path.join(__dirname, "..", "docs", "原型图.html"), "utf8");
  assert.match(html, /function onAiProviderChange\(\)/);
  assert.match(html, /aiProviderPreset\(id\)/);
  // 仅当字段为空或仍是其他服务商预设时才覆盖，手动自定义值保留
  assert.match(html, /presetBaseUrls\.includes\(baseInput\.value\.trim\(\)\)/);
  assert.match(html, /presetModels\.includes\(modelInput\.value\.trim\(\)\)/);
  // 预设来自主进程 getStatus 的 providers 字段（单一事实来源）
  assert.match(html, /state\.aiSettings\?\.providers \|\| \[\]/);
  assert.match(html, /aiProvider"\)\.addEventListener\("change", onAiProviderChange\)/);
});
