const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const NAME_MAX = 40;

function cleanName(value) {
  return String(value ?? "").trim().slice(0, NAME_MAX);
}

const MAX_ROSTER_BYTES = 16 * 1024 * 1024;
function validateAvatar(avatar) {
  if (avatar == null) return;
  if (typeof avatar !== "string" || avatar.length > 90000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(avatar)) throw new Error("自定义头像格式无效，请重新选择图片");
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
      validateRoster(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await fs.writeFile(this.filePath, "[]\n", { flag: "wx" });
    }
  }

  async readAll() {
    try {
      const roster = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      return validateRoster(roster);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async list() {
    await this.initialize();
    return (await this.readAll()).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }

  async create(name, gender = "male", avatar = null) {
    validateAvatar(avatar);
    if (!["male", "female"].includes(gender)) throw new Error("请选择男生或女生头像");
    const clean = cleanName(name);
    if (!clean) throw new Error("请填写学生姓名");
    return this.serialize(async () => {
      const roster = await this.readAll();
      if (roster.length >= 1000) throw new Error("学生名册已达上限");
      if (roster.some((student) => student.name === clean)) throw new Error("已有同名学生");
      const record = { id: randomUUID(), name: clean, gender, avatar, createdAt: new Date().toISOString() };
      roster.push(record);
      await this.writeAll(roster);
      return record;
    });
  }

  async rename(id, name, gender, avatar) {
    validateAvatar(avatar);
    if (gender !== undefined && !["male", "female"].includes(gender)) throw new Error("请选择男生或女生头像");
    const clean = cleanName(name);
    if (!clean) throw new Error("请填写学生姓名");
    return this.serialize(async () => {
      const roster = await this.readAll();
      const record = roster.find((student) => student.id === id);
      if (!record) throw new Error("找不到这个学生");
      if (roster.some((student) => student.id !== id && student.name === clean)) throw new Error("已有同名学生");
      record.name = clean;
      if (avatar !== undefined) record.avatar = avatar;
      if (gender !== undefined) record.gender = gender;
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
    validateRoster(roster);
    const temporary = path.join(this.rootPath, ".students-" + randomUUID() + ".tmp");
    await fs.writeFile(temporary, JSON.stringify(roster, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporary, this.filePath);
  }
}

function validateRoster(roster) {
  if (Buffer.byteLength(JSON.stringify(roster)) > MAX_ROSTER_BYTES) throw new Error("学生头像资料过大，请减少自定义头像");
  const ids = new Set();
  if (!Array.isArray(roster) || roster.length > 1000) throw new Error("学生名册格式无效");
  for (const row of roster) {
    if (!row || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id || "") || ids.has(row.id) || typeof row.name !== "string" || !row.name.trim() || row.name.length > NAME_MAX) throw new Error("学生名册格式无效");
    if (row.gender !== undefined && !["male", "female"].includes(row.gender)) throw new Error("学生头像格式无效");
    validateAvatar(row.avatar);
    ids.add(row.id);
  }
  return roster;
}
module.exports = { StudentStore, NAME_MAX, validateRoster };
