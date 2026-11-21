// 批阅暂存持久化：手机上传/本地导入的待保存页面按学生落盘。
// 应用重启、语言切换重载、切换学生往返都不会丢——保存成功或用户清空后才删除。
const fs = require("node:fs/promises");
const path = require("node:path");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGES = 24;

function sanitizePages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .filter((page) => page && typeof page.base64 === "string" && page.base64.length > 0)
    .slice(0, MAX_PAGES)
    .map((page) => ({
      mime: typeof page.mime === "string" && page.mime ? page.mime : "image/jpeg",
      base64: page.base64,
      width: Number.isFinite(Number(page.width)) ? Math.max(1, Math.round(Number(page.width))) : 0,
      height: Number.isFinite(Number(page.height)) ? Math.max(1, Math.round(Number(page.height))) : 0,
      rotation: [0, 90, 180, 270].includes(Number(page.rotation)) ? Number(page.rotation) : 0
    }));
}

class GradeStagingStore {
  constructor(rootPath) { this.rootPath = rootPath; }

  fileFor(studentId) { return path.join(this.rootPath, studentId + ".json"); }

  assertStudent(studentId) {
    if (!UUID_PATTERN.test(String(studentId || ""))) throw new Error("学生标识无效");
  }

  async save(studentId, pages) {
    this.assertStudent(studentId);
    const safe = sanitizePages(pages);
    if (!safe.length) { await this.clear(studentId); return { pages: 0 }; }
    await fs.mkdir(this.rootPath, { recursive: true });
    const payload = { updatedAt: new Date().toISOString(), pages: safe };
    // 原子写：先写临时文件再改名，进程被杀/磁盘满不会留下截断的 JSON
    const target = this.fileFor(studentId);
    const tmp = target + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(payload));
    await fs.rename(tmp, target);
    return { pages: safe.length };
  }

  async load(studentId) {
    this.assertStudent(studentId);
    try {
      const payload = JSON.parse(await fs.readFile(this.fileFor(studentId), "utf8"));
      return sanitizePages(payload && payload.pages);
    } catch (error) {
      // 损坏文件隔离为 .corrupt 留待诊断，而不是静默当空处理
      if (error.code !== "ENOENT") {
        await fs.rename(this.fileFor(studentId), this.fileFor(studentId) + ".corrupt-" + Date.now()).catch(() => {});
      }
      return [];
    }
  }

  async clear(studentId) {
    this.assertStudent(studentId);
    await fs.rm(this.fileFor(studentId), { force: true }).catch(() => {});
  }
}

module.exports = { GradeStagingStore, sanitizePages, MAX_PAGES, UUID_PATTERN };
