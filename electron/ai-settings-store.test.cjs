const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AiSettingsStore, normalizeBaseUrl } = require("./ai-settings-store.cjs");

function settings(overrides = {}) {
  return { provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "", ...overrides };
}

test("stores only encrypted API key bytes and exposes a redacted status", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-ai-settings-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "config", "ai-settings.json");
  const safeStorage = {
    async isAsyncEncryptionAvailable() { return true; },
    async encryptStringAsync(value) { return Buffer.from("encrypted:" + value); },
    async decryptStringAsync(value) { return value.toString("utf8").replace(/^encrypted:/, ""); }
  };
  const store = new AiSettingsStore(filePath, safeStorage);
  const saved = await store.save(settings({ apiKey: "secret-test-key" }));
  assert.equal(saved.hasKey, true);
  assert.equal(saved.provider, "deepseek");
  assert.equal(Object.hasOwn(saved, "apiKey"), false);
  const raw = await fs.readFile(filePath, "utf8");
  assert.equal(raw.includes("secret-test-key"), false);
  assert.equal(JSON.parse(raw).encryptedKey, Buffer.from("encrypted:secret-test-key").toString("base64"));
  assert.equal((await store.getCredentials()).apiKey, "secret-test-key");
  assert.equal(Object.hasOwn(await store.getStatus(), "apiKey"), false);
  assert.deepEqual(await store.getBackupProfile(), {
    schemaVersion: 1, provider: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1"
  });
  assert.equal(JSON.stringify(await store.getBackupProfile()).includes("secret-test-key"), false);

  const updated = await store.save(settings({ provider: "qwen", model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" }));
  assert.equal(updated.hasKey, true);
  assert.equal(updated.provider, "qwen");
  assert.equal((await fs.readFile(filePath, "utf8")).includes("secret-test-key"), false);

  const cleared = await store.save(settings({ provider: "qwen", model: "qwen-plus", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", clearApiKey: true }));
  assert.equal(cleared.hasKey, false);
});

test("rejects unsupported providers, insecure URLs, and missing OS encryption", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "exam2pdf-ai-settings-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new AiSettingsStore(path.join(root, "settings.json"), {
    async isAsyncEncryptionAvailable() { return false; },
    async encryptStringAsync(value) { return Buffer.from(value); }
  });
  await assert.rejects(store.save(settings({ provider: "unknown" })), /服务商无效/);
  await assert.rejects(store.save(settings({ baseUrl: "http://api.example.com" })), /必须使用 HTTPS/);
  await assert.rejects(store.save(settings({ apiKey: "secret" })), /安全密钥存储暂不可用/);
  assert.equal(normalizeBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.throws(() => normalizeBaseUrl("https://user:pass@api.example.com/v1"), /必须使用 HTTPS/);
});
