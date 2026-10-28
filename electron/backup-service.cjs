const { validateRoster } = require("./student-store.cjs");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createGzip, createGunzip } = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { randomUUID } = require("node:crypto");
const { PROVIDERS, normalizeBaseUrl } = require("./ai-settings-store.cjs");

const BLOCK_SIZE = 512;
const MAX_UNPACKED_BYTES = 4 * 1024 * 1024 * 1024;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function octal(value, length) {
  return Buffer.from(Math.max(0, value).toString(8).padStart(length - 1, "0") + "\0", "ascii");
}

function tarHeader(name, size, directory = false) {
  const normalized = name.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized || Buffer.byteLength(normalized) > 100 || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error("备份路径无效：" + name);
  }
  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(normalized, 0, 100, "utf8");
  octal(directory ? 0o755 : 0o644, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(directory ? 0 : size, 12).copy(header, 124);
  octal(Math.floor(Date.now() / 1000), 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = directory ? 0x35 : 0x30;
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(checksum.toString(8).padStart(6, "0") + "\0 ", "ascii").copy(header, 148);
  return header;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await new Promise((resolve, reject) => {
    stream.once("drain", resolve);
    stream.once("error", reject);
  });
}

async function listLibraryEntries(libraryRoot) {
  const entries = [];
  for (const category of ["posts", "answers", "trainings"]) {
    const root = path.join(libraryRoot, category);
    await fsp.mkdir(root, { recursive: true });
    entries.push({ absolute: root, archivePath: category + "/", directory: true, size: 0 });
    async function walk(directory, relative) {
      const children = await fsp.readdir(directory, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name, "en"));
      for (const child of children) {
        if (child.name.startsWith(".tmp-")) continue;
        if ((child.name.startsWith(".post-") || child.name.startsWith(".history-")) && child.name.endsWith(".tmp")) continue;
        const absolute = path.join(directory, child.name);
        const archivePath = category + "/" + path.posix.join(relative, child.name);
        if (child.isSymbolicLink()) throw new Error("备份数据中不支持符号链接：" + archivePath);
        if (child.isDirectory()) {
          entries.push({ absolute, archivePath: archivePath + "/", directory: true, size: 0 });
          await walk(absolute, path.posix.join(relative, child.name));
        } else if (child.isFile()) {
          const stat = await fsp.stat(absolute);
          entries.push({ absolute, archivePath, directory: false, size: stat.size });
        }
      }
    }
    await walk(root, "");
  }
  for (const name of ["students.json", "workspace.json"]) {
    const absolute = path.join(libraryRoot, name);
    try {
      const stat = await fsp.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (name === "students.json" ? 16 : 1) * 1024 * 1024) throw new Error("学生配置文件无效");
      entries.push({ absolute, archivePath: name, directory: false, size: stat.size });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return entries;
}

async function createBackup(libraryRoot, destination, settingsProfile = null, options = {}) {
  const entries = await listLibraryEntries(libraryRoot);
  if (settingsProfile) {
    const profile = validateAiSettingsProfile(settingsProfile);
    const buffer = Buffer.from(JSON.stringify(profile, null, 2) + "\n", "utf8");
    entries.push({ archivePath: "settings/ai-settings.json", directory: false, size: buffer.length, buffer });
  }
  const replaceExisting = options.overwrite === true;
  const writePath = replaceExisting
    ? path.join(path.dirname(destination), ".exam2pdf-backup-" + randomUUID() + ".tmp")
    : destination;
  const output = fs.createWriteStream(writePath, { flags: "wx" });
  let destinationCreated = false;
  output.once("open", () => { destinationCreated = true; });
  const gzip = createGzip({ level: 6 });
  gzip.pipe(output);
  const finished = new Promise((resolve, reject) => {
    output.once("finish", resolve);
    output.once("error", reject);
    gzip.once("error", reject);
  });
  try {
    for (const entry of entries) {
      await writeChunk(gzip, tarHeader(entry.archivePath, entry.size, entry.directory));
      if (!entry.directory && entry.size) {
        if (entry.buffer) await writeChunk(gzip, entry.buffer);
        else await pipeline(fs.createReadStream(entry.absolute), gzip, { end: false });
        const remainder = entry.size % BLOCK_SIZE;
        if (remainder) await writeChunk(gzip, Buffer.alloc(BLOCK_SIZE - remainder));
      }
    }
    await writeChunk(gzip, Buffer.alloc(BLOCK_SIZE * 2));
    gzip.end();
    await finished;
    if (!output.closed) await new Promise((resolve) => output.once("close", resolve));
    if (replaceExisting) await fsp.rename(writePath, destination);
    return { filePath: destination, entries: entries.length, bytes: (await fsp.stat(destination)).size };
  } catch (error) {
    gzip.destroy();
    output.destroy();
    if (!output.closed) await new Promise((resolve) => output.once("close", resolve));
    if (destinationCreated) await fsp.rm(writePath, { force: true });
    throw error;
  }
}

function readOctal(buffer, start, length) {
  const raw = buffer.toString("ascii", start, start + length).replace(/\0.*$/, "").trim();
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error("备份文件包含无效的 TAR 数值字段");
  return Number.parseInt(raw, 8);
}

function archiveEntryPath(header) {
  const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
  const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
  return (prefix ? prefix + "/" : "") + name;
}

function validateEntryPath(name) {
  if (!name || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) throw new Error("备份中含有无效路径");
  const normalized = path.posix.normalize(name);
  if (normalized === ".." || normalized.startsWith("../") || normalized !== name.replace(/\/$/, "")) throw new Error("备份中含有越界路径");
  if (!(["students.json", "workspace.json"].includes(normalized) || normalized === "posts" || normalized.startsWith("posts/") || normalized === "answers" || normalized.startsWith("answers/") || normalized === "trainings" || normalized.startsWith("trainings/") || normalized === "settings" || normalized === "settings/ai-settings.json")) {
    throw new Error("备份中包含不支持的数据目录：" + normalized);
  }
  return normalized;
}

function validateAiSettingsProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || profile.schemaVersion !== 1 || Object.keys(profile).some((key) => !["schemaVersion", "provider", "model", "baseUrl"].includes(key))) {
    throw new Error("备份中的 AI 接口设置格式无效");
  }
  const provider = String(profile.provider || "").trim();
  const model = String(profile.model || "").trim().slice(0, 120);
  if (!PROVIDERS.has(provider) || !model) throw new Error("备份中的 AI 服务商或模型无效");
  return { schemaVersion: 1, provider, model, baseUrl: normalizeBaseUrl(profile.baseUrl) };
}

async function extractBackupToTemp(archivePath, tempRoot) {
  const tarPath = path.join(tempRoot, "backup.tar");
  let totalBytes = 0;
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_UNPACKED_BYTES) callback(new Error("解压后的备份超过 4 GB 限制"));
    else callback(null, chunk);
  } });
  await pipeline(fs.createReadStream(archivePath), createGunzip(), limit, fs.createWriteStream(tarPath, { flags: "wx" }));
  const archive = await fsp.open(tarPath, "r");
  const outputs = [];
  const categories = new Set();
  let terminated = false;
  try {
    const stat = await archive.stat();
    let offset = 0;
    while (offset + BLOCK_SIZE <= stat.size) {
      const header = Buffer.alloc(BLOCK_SIZE);
      const { bytesRead } = await archive.read(header, 0, BLOCK_SIZE, offset);
      if (bytesRead !== BLOCK_SIZE) throw new Error("备份文件内容不完整");
      if (header.every((byte) => byte === 0)) {
        const ending = Buffer.alloc(BLOCK_SIZE);
        const next = await archive.read(ending, 0, BLOCK_SIZE, offset + BLOCK_SIZE);
        if (next.bytesRead !== BLOCK_SIZE || !ending.every((byte) => byte === 0)) throw new Error("备份文件结束标记不完整");
        terminated = true;
        break;
      }
      const expectedChecksum = readOctal(header, 148, 8);
      const checksumHeader = Buffer.from(header);
      checksumHeader.fill(0x20, 148, 156);
      const actualChecksum = checksumHeader.reduce((sum, byte) => sum + byte, 0);
      if (actualChecksum !== expectedChecksum) throw new Error("备份文件校验失败");

      const rawName = archiveEntryPath(header);
      const isDirectory = header[156] === 0x35;
      const isRegular = header[156] === 0 || header[156] === 0x30;
      if (!isDirectory && !isRegular) throw new Error("备份文件包含不支持的链接或特殊文件");
      const safeName = validateEntryPath(rawName);
      categories.add(safeName.split("/")[0]);
      const size = isDirectory ? 0 : readOctal(header, 124, 12);
      if (size > MAX_UNPACKED_BYTES) throw new Error("备份文件中的单个条目过大");
      const target = path.resolve(tempRoot, "library", safeName);
      const allowedRoot = path.resolve(tempRoot, "library") + path.sep;
      if (!target.startsWith(allowedRoot)) throw new Error("备份路径越界");
      await fsp.mkdir(isDirectory ? target : path.dirname(target), { recursive: true });
      const dataOffset = offset + BLOCK_SIZE;
      if (!isDirectory) {
        const end = dataOffset + size;
        if (end > stat.size) throw new Error("备份文件内容不完整");
        if (size) await pipeline(fs.createReadStream(tarPath, { start: dataOffset, end: end - 1 }), fs.createWriteStream(target, { flags: "wx" }));
        else await fsp.writeFile(target, Buffer.alloc(0), { flag: "wx" });
        outputs.push({ path: target, archivePath: safeName });
      }
      offset = dataOffset + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    }
    if (!terminated || !categories.has("posts") || !categories.has("answers")) {
      throw new Error("备份文件不完整或缺少帖子/作答目录");
    }
  } finally {
    await archive.close();
    await fsp.rm(tarPath, { force: true });
  }
  return outputs;
}

async function validateRestoredLibrary(libraryRoot) {
  let roster;
  try { roster = validateRoster(JSON.parse(await fsp.readFile(path.join(libraryRoot, "students.json"), "utf8"))); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    roster = []; await fsp.writeFile(path.join(libraryRoot, "students.json"), "[]\n", { flag: "wx" });
  }
  const studentIds = new Set(roster.map(student => student.id));
  try {
    const context = JSON.parse(await fsp.readFile(path.join(libraryRoot, "workspace.json"), "utf8"));
    if (!context || context.schemaVersion !== 1 || (context.activeStudentId !== null && !studentIds.has(context.activeStudentId))) throw new Error("备份中的当前学生无效");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fsp.writeFile(path.join(libraryRoot, "workspace.json"), JSON.stringify({ schemaVersion: 1, activeStudentId: roster[0]?.id || null }) + "\n", { flag: "wx" });
  }
  const linkedTrainingIds = new Set();
  for (const category of ["posts", "answers"]) {
    const categoryPath = path.join(libraryRoot, category);
    await fsp.mkdir(categoryPath, { recursive: true });
    for (const entry of await fsp.readdir(categoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RECORD_ID.test(entry.name)) throw new Error("备份中含有无效的记录目录");
      const recordPath = path.join(categoryPath, entry.name);
      const record = JSON.parse(await fsp.readFile(path.join(recordPath, "post.json"), "utf8"));
      if (!record || record.id !== entry.name || !Array.isArray(record.images) || !Array.isArray(record.pageOrder)) throw new Error("备份中含有损坏的记录清单");
      if ((category === "answers" && record.recordType !== "answer") || (category === "posts" && record.recordType === "answer")) throw new Error("备份中的记录类型与目录不匹配");
      if (category === "answers" && record.trainingId) {
        if (!RECORD_ID.test(record.trainingId)) throw new Error("备份中的训练关联编号无效");
        linkedTrainingIds.add(record.trainingId);
      }
      const imageFiles = new Set();
      for (const image of record.images) {
        if (!/^page-\d{3}\.(jpg|jpeg|png|webp)$/i.test(image.file) || imageFiles.has(image.file)) throw new Error("备份中含有无效或重复的图片文件名");
        imageFiles.add(image.file);
        await fsp.access(path.join(recordPath, image.file), fs.constants.R_OK);
      }
      // pageOrder 是打印视图（允许因用户移除而是图片清单的子集）
      if (!Array.isArray(record.pageOrder) || new Set(record.pageOrder).size !== record.pageOrder.length || record.pageOrder.some((file) => !imageFiles.has(file))) throw new Error("备份中的图片顺序清单无效");
    }
  }
  const trainingPath = path.join(libraryRoot, "trainings");
  await fsp.mkdir(trainingPath, { recursive: true });
  let trainingHistory = [];
  try { trainingHistory = JSON.parse(await fsp.readFile(path.join(trainingPath, "history.json"), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fsp.writeFile(path.join(trainingPath, "history.json"), "[]\n", { flag: "wx" });
  }
  if (!Array.isArray(trainingHistory)) throw new Error("备份中的训练历史格式无效");
  const trainingIds = new Set();
  const trainingById = new Map();
  for (const record of trainingHistory) {
    if (!record || !RECORD_ID.test(record.id) || trainingIds.has(record.id) || !Array.isArray(record.questions) || record.questions.length < 1 || record.questions.length > 20 || !["draft", "approved"].includes(record.status)) {
      throw new Error("备份中含有无效的训练记录");
    }
    trainingIds.add(record.id);
    trainingById.set(record.id, record);
    if (typeof record.topic !== "string" || typeof record.createdAt !== "string" || record.questions.some((question) => !question || typeof question.prompt !== "string" || !question.prompt.trim() || typeof question.answer !== "string" || !question.answer.trim())) {
      throw new Error("备份中含有不完整的训练题目");
    }
  }
  for (const id of linkedTrainingIds) {
    if (!trainingById.has(id) || trainingById.get(id).status !== "approved") throw new Error("备份中的作答记录关联了不存在或未审核的练习");
  }
  try {
    return validateAiSettingsProfile(JSON.parse(await fsp.readFile(path.join(libraryRoot, "settings", "ai-settings.json"), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function restoreBackup(archivePath, libraryRoot) {
  const userDataRoot = path.dirname(libraryRoot);
  const tempRoot = path.join(userDataRoot, ".restore-" + randomUUID());
  await fsp.mkdir(userDataRoot, { recursive: true });
  await fsp.mkdir(tempRoot, { recursive: false });
  const swaps = [];
  try {
    await extractBackupToTemp(archivePath, tempRoot);
    const stagedLibrary = path.join(tempRoot, "library");
    const settingsProfile = await validateRestoredLibrary(stagedLibrary);
    await fsp.mkdir(libraryRoot, { recursive: true });
    for (const category of ["posts", "answers", "trainings", "students.json", "workspace.json"]) {
      const destination = path.join(libraryRoot, category);
      const staged = path.join(stagedLibrary, category);
      const previous = path.join(tempRoot, "previous-" + category);
      try { await fsp.rename(destination, previous); swaps.push({ destination, previous, staged, installed: false }); }
      catch (error) { if (error.code !== "ENOENT") throw error; swaps.push({ destination, previous: null, staged, installed: false }); }
      await fsp.rename(staged, destination);
      swaps[swaps.length - 1].installed = true;
    }
    await fsp.rm(tempRoot, { recursive: true, force: true });
    return { restoredRecords: await countRecords(libraryRoot), settingsProfile };
  } catch (error) {
    for (const swap of swaps.reverse()) {
      if (swap.installed) await fsp.rm(swap.destination, { recursive: true, force: true }).catch(() => {});
      if (swap.previous) await fsp.rename(swap.previous, swap.destination).catch(() => {});
    }
    await fsp.rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

async function countRecords(libraryRoot) {
  let count = 0;
  for (const category of ["posts", "answers"]) {
    const entries = await fsp.readdir(path.join(libraryRoot, category), { withFileTypes: true });
    count += entries.filter((entry) => entry.isDirectory() && RECORD_ID.test(entry.name)).length;
  }
  try {
    const history = JSON.parse(await fsp.readFile(path.join(libraryRoot, "trainings", "history.json"), "utf8"));
    if (Array.isArray(history)) count += history.length;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  return count;
}

module.exports = { createBackup, restoreBackup, extractBackupToTemp, validateRestoredLibrary, validateEntryPath, validateAiSettingsProfile, MAX_UNPACKED_BYTES };
