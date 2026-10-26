const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, maxLength, fallback = "") {
  return String(value == null ? "" : value).trim().slice(0, maxLength) || fallback;
}

class TrainingStore {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.historyPath = path.join(rootPath, "history.json");
    this.writeTail = Promise.resolve();
    this.initialized = false;
    this.initializing = null;
  }

  serialize(task) {
    const current = this.writeTail.then(task, task);
    this.writeTail = current.catch(() => {});
    return current;
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await fs.mkdir(this.rootPath, { recursive: true });
      const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
      await Promise.all(entries.filter((entry) => entry.isFile() && /^\.history-[0-9a-f-]+\.tmp$/i.test(entry.name)).map((entry) => fs.rm(path.join(this.rootPath, entry.name), { force: true })));
      try {
        const records = JSON.parse(await fs.readFile(this.historyPath, "utf8"));
        if (!Array.isArray(records)) throw new Error("训练历史格式无效");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await fs.writeFile(this.historyPath, "[]\n", { flag: "wx" });
      }
      this.initialized = true;
    })();
    try { await this.initializing; }
    finally { if (!this.initialized) this.initializing = null; }
  }

  async readAll() {
    await this.initialize();
    return JSON.parse(await fs.readFile(this.historyPath, "utf8"));
  }

  async list() {
    return (await this.readAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id) {
    if (!UUID_PATTERN.test(String(id || ""))) throw new Error("练习编号无效");
    const record = (await this.readAll()).find((item) => item.id === id);
    if (!record) throw new Error("找不到这份练习");
    return record;
  }

  async create(input) {
    return this.serialize(async () => {
      if (!input || typeof input !== "object") throw new Error("练习内容无效");
      if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 20) throw new Error("练习题数量无效");
      const questions = input.questions.map((question, index) => {
        const prompt = cleanText(question && question.prompt, 1000);
        const answer = cleanText(question && question.answer, 2000);
        if (!prompt || !answer) throw new Error("第 " + (index + 1) + " 道练习题内容不完整");
        return { prompt, answer };
      });
      const record = {
        schemaVersion: 1,
        id: randomUUID(),
        topic: cleanText(input.topic, 120, "基础练习"),
        source: cleanText(input.source, 80, "本地基础题型模板"),
        createdAt: new Date().toISOString(),
        status: "draft",
        questions
      };
      const records = await this.readAll();
      records.push(record);
      await this.writeAll(records);
      return record;
    });
  }

  async setStatus(id, status) {
    return this.serialize(async () => {
      if (!UUID_PATTERN.test(String(id || ""))) throw new Error("练习编号无效");
      if (!["draft", "approved"].includes(status)) throw new Error("练习状态无效");
      const records = await this.readAll();
      const record = records.find((item) => item.id === id);
      if (!record) throw new Error("找不到这份练习");
      record.status = status;
      record.updatedAt = new Date().toISOString();
      await this.writeAll(records);
      return record;
    });
  }

  async writeAll(records) {
    await fs.mkdir(this.rootPath, { recursive: true });
    const temporary = path.join(this.rootPath, ".history-" + randomUUID() + ".tmp");
    await fs.writeFile(temporary, JSON.stringify(records, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporary, this.historyPath);
  }
}

module.exports = { TrainingStore, UUID_PATTERN };
