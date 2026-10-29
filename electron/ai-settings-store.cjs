const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AI_PROVIDERS, DEFAULT_PROVIDER, providerPreset } = require("./ai-providers.cjs");

const PROVIDERS = new Set(AI_PROVIDERS.map((provider) => provider.id));

function clean(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || "")); }
  catch { throw new Error("接口地址格式无效"); }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("接口地址必须使用 HTTPS，且不能包含账号、密码、查询参数或片段");
  }
  return url.href.replace(/\/$/, "");
}

class AiSettingsStore {
  constructor(filePath, safeStorage) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
    this.writeTail = Promise.resolve();
  }

  serialize(task) {
    const current = this.writeTail.then(task, task);
    this.writeTail = current.catch(() => {});
    return current;
  }

  async read() {
    try {
      const settings = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("AI 设置文件格式无效");
      return settings;
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  // 未显式保存过的字段回落到当前服务商自己的预设（而不是固定 DeepSeek 的端点）
  defaultsFor(provider, model, baseUrl) {
    const preset = providerPreset(provider) || providerPreset(DEFAULT_PROVIDER);
    return {
      provider: preset.id,
      model: model || preset.model,
      baseUrl: baseUrl || preset.baseUrl
    };
  }

  async getStatus() {
    const settings = await this.read();
    const defaults = this.defaultsFor(settings.provider, settings.model, settings.baseUrl);
    return {
      ...defaults,
      providers: AI_PROVIDERS,
      hasKey: typeof settings.encryptedKey === "string" && settings.encryptedKey.length > 0
    };
  }

  async getBackupProfile() {
    const settings = await this.read();
    if (!Object.keys(settings).length) return null;
    const defaults = this.defaultsFor(settings.provider, settings.model, settings.baseUrl);
    return {
      schemaVersion: 1,
      provider: defaults.provider,
      model: defaults.model,
      baseUrl: defaults.baseUrl
    };
  }

  // 优先用同步 safeStorage API（久经考验）；async 变体在部分 Electron 44 构建上
  // 存在"解密恒返回首次明文"的问题（2026-10-29 实测：换存任何新 key 发出去的都是旧 key）
  async encryptKey(apiKey) {
    if (typeof this.safeStorage.encryptString === "function") {
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error("系统安全密钥存储暂不可用");
      return this.safeStorage.encryptString(apiKey);
    }
    if (typeof this.safeStorage.encryptStringAsync !== "function") throw new Error("当前系统没有可用的安全密钥存储");
    if (typeof this.safeStorage.isAsyncEncryptionAvailable === "function" && !await this.safeStorage.isAsyncEncryptionAvailable()) throw new Error("系统安全密钥存储暂不可用");
    return this.safeStorage.encryptStringAsync(apiKey);
  }

  async decryptKey(encrypted) {
    if (typeof this.safeStorage.decryptString === "function") {
      return this.safeStorage.decryptString(encrypted);
    }
    if (typeof this.safeStorage.decryptStringAsync !== "function") throw new Error("当前系统没有可用的安全密钥存储");
    if (typeof this.safeStorage.isAsyncEncryptionAvailable === "function" && !await this.safeStorage.isAsyncEncryptionAvailable()) throw new Error("系统安全密钥存储暂不可用");
    return this.safeStorage.decryptStringAsync(encrypted);
  }

  async getCredentials() {
    const settings = await this.read();
    if (!settings.encryptedKey) throw new Error("请先在应用设置中保存 AI API Key");
    if (!this.safeStorage || typeof this.safeStorage.decryptString !== "function" && typeof this.safeStorage.decryptStringAsync !== "function") {
      throw new Error("当前系统没有可用的安全密钥存储");
    }
    let apiKey;
    try { apiKey = await this.decryptKey(Buffer.from(settings.encryptedKey, "base64")); }
    catch { throw new Error("无法解密已保存的 API Key，请重新保存密钥"); }
    if (!apiKey) throw new Error("请先在应用设置中保存 AI API Key");
    const defaults = this.defaultsFor(settings.provider, settings.model, settings.baseUrl);
    return { ...defaults, apiKey };
  }

  async save(input) {
    return this.serialize(async () => {
      if (!input || typeof input !== "object") throw new Error("AI 配置无效");
      const provider = clean(input.provider, 40);
      if (!PROVIDERS.has(provider)) throw new Error("AI 服务商无效");
      const model = clean(input.model, 120);
      if (!model) throw new Error("请填写模型名称");
      const baseUrl = normalizeBaseUrl(clean(input.baseUrl, 500));
      const previous = await this.read();
      let encryptedKey = input.clearApiKey === true ? "" : previous.encryptedKey || "";
      const apiKey = clean(input.apiKey, 4096);
      if (apiKey) {
        encryptedKey = (await this.encryptKey(apiKey)).toString("base64");
      }
      const settings = { schemaVersion: 1, provider, model, baseUrl, encryptedKey };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = path.join(path.dirname(this.filePath), ".ai-settings-" + randomUUID() + ".tmp");
      try {
        await fs.writeFile(temporary, JSON.stringify(settings, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, this.filePath);
      } catch (error) {
        await fs.rm(temporary, { force: true });
        throw error;
      }
      return this.getStatus();
    });
  }
}

module.exports = { AiSettingsStore, PROVIDERS, normalizeBaseUrl };
