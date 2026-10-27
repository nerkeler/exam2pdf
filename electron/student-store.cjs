const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const NAME_MAX = 40;

function cleanName(value) {
  return String(value ?? "").trim().slice(0, NAME_MAX);
}

// 学生名册：多学生家庭的学生实体（作答/训练通过 studentId 关联）。
// JSON 存储 + 串行写 + 原子替换，与 TrainingStore 同构。
class StudentStore {
  constructor(rootPath) {
    this.rootPath = rootPath;
    this.filePath = path.join(rootPath, "students.json");
    this.writeTail = Promise.resolve();
  }

  serialize(task) {
    const current = this.writeTail.then(task, task);
    this.writeTail = current.catch(() => {});
    return current;
  }

  async initialize() {
    await fs.mkdir(this.rootPath, { recursive: true });
    try {
      const roster = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!Array.isArray(roster)) throw new Error("学生名册格式无效");
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (String(error.message || "").includes("学生名册")) throw error;
      }
      try { await fs.access(this.filePath); } catch { await fs.writeFile(this.filePath, "[]\n", { flag: "wx" }); }
    }
  }

  async readAll() {
    try {
      const roster = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return Array.isArray(roster) ? roster : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async list() {
    await this.initialize();
    return (await this.readAll()).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  async create(name) {
    const clean = cleanName(name);
    if (!clean) throw new Error("请填写学生姓名");
    return this.serialize(async () => {
      const roster = await this.readAll();
      if (roster.some((student) => student.name === clean)) throw new Error("已有同名学生");
      const record = { id: randomUUID(), name: clean, createdAt: new Date().toISOString() };
      roster.push(record);
      await this.writeAll(roster);
      return record;
    });
  }

  async rename(id, name) {
    const clean = cleanName(name);
    if (!clean) throw new Error("请填写学生姓名");
    return this.serialize(async () => {
      const roster = await this.readAll();
      const record = roster.find((student) => student.id === id);
      if (!record) throw new Error("找不到这个学生");
      if (roster.some((student) => student.id !== id && student.name === clean)) throw new Error("已有同名学生");
      record.name = clean;
      await this.writeAll(roster);
      return record;
    });
  }

  async remove(id) {
    return this.serialize(async () => {
      const roster = await this.readAll();
      const next = roster.filter((student) => student.id !== id);
      if (next.length === roster.length) throw new Error("找不到这个学生");
      await this.writeAll(next);
      return true;
    });
  }

  async writeAll(roster) {
    const temporary = path.join(this.rootPath, ".students-" + randomUUID() + ".tmp");
    await fs.writeFile(temporary, JSON.stringify(roster, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporary, this.filePath);
  }
}

module.exports = { StudentStore, NAME_MAX };
