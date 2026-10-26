const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const MAX_IMAGES = 24;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_PATTERN = /^page-\d{3}\.jpe?g$|^page-\d{3}\.png$|^page-\d{3}\.webp$/i;

function cleanText(value, maxLength, fallback = "") {
  return String(value == null ? "" : value).trim().slice(0, maxLength) || fallback;
}

function isValidNoteId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function toSummary(post) {
  const supplementalImages = post.images.filter((image) => image.supplemental === true).length;
  return {
    id: post.id,
    recordType: post.recordType || "post",
    title: post.title,
    author: post.author,
    studentName: post.studentName || "",
    source: post.source,
    sourceUrl: post.sourceUrl,
    noteId: post.noteId,
    collectedAt: post.collectedAt,
    expectedImages: post.expectedImages || post.images.length - supplementalImages,
    sourcePageCount: post.images.length - supplementalImages,
    supplementalImages,
    missingImages: Array.isArray(post.pendingIndexes) ? post.pendingIndexes.length : 0,
    removedImages: Math.max(0, post.images.length - post.pageOrder.length),
    reviewStatus: post.reviewStatus || "pending",
    trainingId: post.trainingId || "",
    subject: post.subject || "",
    images: post.images,
    pageOrder: post.pageOrder,
    pages: post.pageOrder.length
  };
}

class PostStore {
  constructor(rootPath, options = {}) {
    this.rootPath = rootPath;
    this.defaultSubject = options.defaultSubject || "";
    this.writeTail = Promise.resolve();
  }

  serialize(task) {
    const current = this.writeTail.then(task, task);
    this.writeTail = current.catch(() => {});
    return current;
  }

  async initialize() {
    await fs.mkdir(this.rootPath, { recursive: true });
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(".tmp-"))
      .map((entry) => fs.rm(path.join(this.rootPath, entry.name), { recursive: true, force: true })));
    await Promise.all(entries
      .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
      .map(async (entry) => {
        const directory = path.join(this.rootPath, entry.name);
        const files = await fs.readdir(directory, { withFileTypes: true });
        await Promise.all(files
          .filter((file) => file.isFile() && /^\.post-[0-9a-f-]+\.tmp$/i.test(file.name))
          .map((file) => fs.rm(path.join(directory, file.name), { force: true })));
      }));
  }

  postDirectory(id) {
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new Error("无效的帖子编号");
    return path.join(this.rootPath, id);
  }

  async readPost(id) {
    const directory = this.postDirectory(id);
    const raw = await fs.readFile(path.join(directory, "post.json"), "utf8");
    const post = JSON.parse(raw);
    if (!post || post.id !== id || !Array.isArray(post.images) || !Array.isArray(post.pageOrder)) {
      throw new Error("帖子数据格式无效");
    }
    return post;
  }

  async listPosts(recordType) {
    await fs.mkdir(this.rootPath, { recursive: true });
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    const posts = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
      .map(async (entry) => {
        try { return toSummary(await this.readPost(entry.name)); }
        catch { return null; }
      }));
    return posts.filter((post) => post && (!recordType || post.recordType === recordType)).sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }

  async getPost(id) {
    const post = await this.readPost(id);
    return { ...toSummary(post), review: post.review || [] };
  }

  async createPost(input) {
    return this.serialize(() => this.createPostLocked(input));
  }

  async createPostLocked(input) {
    if (!input || typeof input !== "object") throw new Error("缺少帖子内容");
    const recordType = input.recordType === "answer" ? "answer" : "post";
    const source = recordType === "answer" ? "学生作答" : input.source === "本地导入" ? "本地导入" : "小红书采集";
    let title = cleanText(input.title, 160, "未命名试卷");
    // 同类记录标题重名时自动追加序号（固定格式）：错题本/列表能区分不同来源；
    // 输入标题本身已带"（n）"尾缀时，从基准名继续找下一个可用序号
    const siblingTitles = (await this.listPosts(recordType)).map((post) => post.title);
    if (siblingTitles.includes(title)) {
      const baseMatch = title.match(/^(.*)（(\d+)）$/);
      const base = baseMatch ? baseMatch[1] : title;
      let sequence = baseMatch ? Number(baseMatch[2]) + 1 : 2;
      while (siblingTitles.includes(base + "（" + sequence + "）")) sequence++;
      title = base + "（" + sequence + "）";
    }
    const author = cleanText(input.author, 100);
    const noteId = isValidNoteId(input.noteId) ? input.noteId : null;
    let sourceUrl = "";
    try {
      const url = new URL(String(input.sourceUrl || ""));
      if (url.protocol === "https:" && (url.hostname === "xiaohongshu.com" || url.hostname.endsWith(".xiaohongshu.com"))) {
        sourceUrl = url.href.slice(0, 2048);
      }
    } catch {}

    if (!Array.isArray(input.images) || input.images.length < 1 || input.images.length > MAX_IMAGES) {
      throw new Error("图片数量需在 1 到 " + MAX_IMAGES + " 张之间");
    }

    const expectedImages = source === "小红书采集" ? Number(input.expectedImages || input.images.length) : input.images.length;
    if (!Number.isInteger(expectedImages) || expectedImages < input.images.length || expectedImages > MAX_IMAGES) {
      throw new Error("笔记图片总数无效");
    }
    const images = [];
    let totalBytes = 0;
    for (let index = 0; index < input.images.length; index++) {
      const item = input.images[index];
      if (!item || typeof item !== "object" || !IMAGE_TYPES.has(item.mime)) {
        throw new Error("第 " + (index + 1) + " 张图片格式不支持，请使用 JPG、PNG 或 WebP");
      }
      if (typeof item.base64 !== "string" || item.base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.base64)) {
        throw new Error("第 " + (index + 1) + " 张图片数据无效或过大");
      }
      const bytes = Buffer.from(item.base64, "base64");
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== item.base64) {
        throw new Error("第 " + (index + 1) + " 张图片数据无效或超过 16 MB");
      }
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("图片总大小不能超过 80 MB");
      const extension = IMAGE_TYPES.get(item.mime);
      const sourceIndex = Number.isInteger(item.sourceIndex) ? item.sourceIndex : index;
      if (sourceIndex < 0 || sourceIndex >= expectedImages || images.some((image) => image.sourceIndex === sourceIndex)) {
        throw new Error("图片页码无效或重复");
      }
      const file = "page-" + String(sourceIndex + 1).padStart(3, "0") + "." + extension;
      images.push({
        file,
        mime: item.mime,
        bytes,
        sourceIndex,
        width: Number.isInteger(item.width) ? Math.max(0, Math.min(item.width, 20000)) : 0,
        height: Number.isInteger(item.height) ? Math.max(0, Math.min(item.height, 20000)) : 0
      });
    }

    if (source === "小红书采集" && noteId) {
      const existing = (await this.listPosts()).find((post) => post.noteId === noteId);
      if (existing) {
        const existingPost = await this.readPost(existing.id);
        if (existingPost.expectedImages !== expectedImages) throw new Error("笔记图片数量已变化，请刷新详情页后重新采集");
        const existingPositions = new Set(existingPost.images.filter((image) => image.supplemental !== true).map((image) => image.sourceIndex));
        const pendingPositions = new Set(existingPost.pendingIndexes || []);
        const missingImages = images.filter((image) => pendingPositions.has(image.sourceIndex) && !existingPositions.has(image.sourceIndex));
        if (!missingImages.length) {
          // 全部页面已在：用本次抓取的字节刷新已有页面（可提升已采集图片的画质）；
          // 字节一致则跳过，页面清单/科目/批阅数据保持不变
          let updatedCount = 0;
          const bySourceIndex = new Map(images.map((image) => [image.sourceIndex, image]));
          const directory = this.postDirectory(existing.id);
          for (const image of existingPost.images) {
            if (image.supplemental === true) continue;
            const incoming = bySourceIndex.get(image.sourceIndex);
            if (!incoming) continue;
            if (!/\.jpe?g$/i.test(image.file)) continue;  // 旧格式文件跳过（当前管线均为 jpg）
            const incomingBytes = incoming.bytes;
            if (!incomingBytes || !incomingBytes.length) continue;
            const filePath = path.join(directory, image.file);
            const current = await fs.readFile(filePath).catch(() => null);
            if (current && current.equals(incomingBytes)) continue;
            await fs.writeFile(filePath, incomingBytes);
            image.mime = incoming.mime;
            image.width = incoming.width;
            image.height = incoming.height;
            updatedCount++;
          }
          if (updatedCount) await this.writePost(existingPost);
          return { duplicate: true, added: 0, updated: updatedCount, post: toSummary(existingPost) };
        }
        const directory = this.postDirectory(existing.id);
        const savedFiles = [];
        try {
          for (const image of missingImages) {
            await fs.writeFile(path.join(directory, image.file), image.bytes, { flag: "wx" });
            savedFiles.push(image.file);
          }
          const post = existingPost;
          const addedImages = missingImages.map(({ bytes, ...image }) => image);
          post.images.push(...addedImages);
          const pageOrder = post.pageOrder.slice();
          for (const image of addedImages.sort((a, b) => a.sourceIndex - b.sourceIndex)) {
            const nextSourcePosition = pageOrder.findIndex((file) => {
              const existingImage = post.images.find((item) => item.file === file);
              return existingImage && existingImage.supplemental !== true && existingImage.sourceIndex > image.sourceIndex;
            });
            const firstSupplementalPosition = pageOrder.findIndex((file) => post.images.find((item) => item.file === file)?.supplemental === true);
            const insertAt = nextSourcePosition >= 0
              ? nextSourcePosition
              : firstSupplementalPosition >= 0 ? firstSupplementalPosition : pageOrder.length;
            pageOrder.splice(insertAt, 0, image.file);
          }
          post.pageOrder = pageOrder;
          const addedPositions = new Set(missingImages.map((image) => image.sourceIndex));
          post.pendingIndexes = (post.pendingIndexes || []).filter((position) => !addedPositions.has(position));
          await this.writePost(post);
          return { duplicate: true, added: missingImages.length, post: toSummary(post) };
        } catch (error) {
          await Promise.all(savedFiles.map((file) => fs.rm(path.join(directory, file), { force: true })));
          throw error;
        }
      }
    }

    const id = randomUUID();
    const temporaryDirectory = path.join(this.rootPath, ".tmp-" + id);
    const finalDirectory = this.postDirectory(id);
    const postImages = images.map(({ bytes, ...image }) => image);
    const post = {
      schemaVersion: 1,
      id,
      recordType,
      title,
      author,
      studentName: recordType === "answer" ? cleanText(input.studentName, 80) : "",
      source,
      sourceUrl,
      noteId,
      collectedAt: new Date().toISOString(),
      expectedImages,
      // 每条记录都必须有科目：显式指定 > 标题推断 > 默认科目
      subject: cleanText(input.subject, 20) || this.defaultSubject,
      images: postImages,
      pendingIndexes: Array.from({ length: expectedImages }, (_, index) => index).filter((index) => !postImages.some((image) => image.sourceIndex === index)),
      pageOrder: postImages.map((image) => image.file),
      reviewStatus: "pending",
      review: []
    };

    await fs.mkdir(temporaryDirectory, { recursive: false });
    try {
      await Promise.all(images.map((image) => fs.writeFile(path.join(temporaryDirectory, image.file), image.bytes, { flag: "wx" })));
      await fs.writeFile(path.join(temporaryDirectory, "post.json"), JSON.stringify(post, null, 2), { flag: "wx" });
      await fs.rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
    return { duplicate: false, post: toSummary(post) };
  }

  async renamePost(id, title) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      post.title = cleanText(title, 160, post.title);
      await this.writePost(post);
      return toSummary(post);
    });
  }

  async reorderPost(id, order) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      const allowed = new Set(post.images.map((image) => image.file));
      // 打印页序是视图定制：允许是全部图片的任意子集排列（被移除的页不在其中）
      if (!Array.isArray(order) || order.length > allowed.size || new Set(order).size !== order.length || order.some((file) => !allowed.has(file))) {
        throw new Error("页面顺序与当前图片不匹配");
      }
      post.pageOrder = order.slice();
      await this.writePost(post);
      return toSummary(post);
    });
  }

  async appendPostImages(id, inputImages) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      if (post.recordType === "answer") throw new Error("学生作答请从批阅页添加图片");
      if (!Array.isArray(inputImages) || !inputImages.length || inputImages.length > MAX_IMAGES) throw new Error("请选择 1 到 " + MAX_IMAGES + " 张图片");
      if (post.images.length + inputImages.length > MAX_IMAGES) throw new Error("一份试卷最多保存 " + MAX_IMAGES + " 张图片");
      const knownFiles = new Set(post.images.map((image) => image.file));
      const knownNumbers = new Set(post.images.map((image) => Number(String(image.file).match(/^page-(\d{3})\./)?.[1])));
      if (post.pageOrder.some((file) => !knownFiles.has(file)) || new Set(post.pageOrder).size !== post.pageOrder.length) {
        throw new Error("当前试卷图片清单不完整，请重新打开帖子池后重试");
      }

      const directory = this.postDirectory(id);
      let totalBytes = 0;
      for (const image of post.images) {
        if (!FILE_PATTERN.test(image.file)) throw new Error("当前试卷图片清单无效");
        const info = await fs.stat(path.join(directory, image.file));
        if (!info.isFile()) throw new Error("当前试卷有图片文件无法读取：" + image.file);
        totalBytes += info.size;
      }
      const additions = [];
      const minimumSupplementalNumber = (Number.isInteger(post.expectedImages)
        ? post.expectedImages
        : post.images.filter((image) => image.supplemental !== true).length) + 1;
      for (let index = 0; index < inputImages.length; index++) {
        const input = inputImages[index];
        if (!input || typeof input !== "object" || !IMAGE_TYPES.has(input.mime)) throw new Error("第 " + (index + 1) + " 张图片格式不支持，请使用 JPG、PNG 或 WebP");
        if (typeof input.base64 !== "string" || input.base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) {
          throw new Error("第 " + (index + 1) + " 张图片数据无效或过大");
        }
        const bytes = Buffer.from(input.base64, "base64");
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== input.base64) throw new Error("第 " + (index + 1) + " 张图片数据无效或超过 16 MB");
        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("整份试卷图片总大小不能超过 80 MB");

        const extension = IMAGE_TYPES.get(input.mime);
        let file = "";
        for (let sequence = minimumSupplementalNumber; sequence <= 999; sequence++) {
          if (knownNumbers.has(sequence)) continue;
          const candidate = "page-" + String(sequence).padStart(3, "0") + "." + extension;
          if (!knownFiles.has(candidate)) {
            file = candidate;
            knownNumbers.add(sequence);
            knownFiles.add(candidate);
            break;
          }
        }
        if (!file) throw new Error("无法为补充图片分配页码");
        additions.push({
          file,
          mime: input.mime,
          sourceIndex: null,
          supplemental: true,
          width: Number.isInteger(input.width) ? Math.max(0, Math.min(input.width, 20000)) : 0,
          height: Number.isInteger(input.height) ? Math.max(0, Math.min(input.height, 20000)) : 0,
          bytes
        });
      }

      const savedFiles = [];
      try {
        for (const image of additions) {
          await fs.writeFile(path.join(directory, image.file), image.bytes, { flag: "wx" });
          savedFiles.push(image.file);
        }
        post.images.push(...additions.map(({ bytes, ...image }) => image));
        post.pageOrder.push(...additions.map((image) => image.file));
        post.updatedAt = new Date().toISOString();
        await this.writePost(post);
      } catch (error) {
        await Promise.all(savedFiles.map((file) => fs.rm(path.join(directory, file), { force: true })));
        throw error;
      }
      return toSummary(post);
    });
  }

  async removePostPage(id, file) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      if (!FILE_PATTERN.test(file) || !post.images.some((image) => image.file === file)) throw new Error("找不到要移除的图片");
      // 只从打印视图排除：采集到的原始文件与图片清单保持不变，可随时恢复
      post.pageOrder = post.pageOrder.filter((item) => item !== file);
      post.updatedAt = new Date().toISOString();
      await this.writePost(post);
      return toSummary(post);
    });
  }

  // 原始页序 = 来源页按采集页序 + 补充页按追加序；恢复不改动任何文件
  deriveSourceOrder(post) {
    const sourcePages = post.images
      .filter((image) => image.supplemental !== true)
      .sort((a, b) => (Number.isInteger(a.sourceIndex) ? a.sourceIndex : 0) - (Number.isInteger(b.sourceIndex) ? b.sourceIndex : 0))
      .map((image) => image.file);
    const supplementalPages = post.images.filter((image) => image.supplemental === true).map((image) => image.file);
    return [...sourcePages, ...supplementalPages];
  }

  async setSubject(id, subject) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      post.subject = cleanText(subject, 20);
      post.updatedAt = new Date().toISOString();
      await this.writePost(post);
      return toSummary(post);
    });
  }

  async resetPostOrder(id) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      post.pageOrder = this.deriveSourceOrder(post);
      post.updatedAt = new Date().toISOString();
      await this.writePost(post);
      return toSummary(post);
    });
  }

  async deletePost(id) {
    return this.serialize(async () => {
      await fs.rm(this.postDirectory(id), { recursive: true, force: true });
      return true;
    });
  }

  async saveReview(id, questions, confirmed, trainingId) {
    return this.serialize(async () => {
      const post = await this.readPost(id);
      if (post.recordType !== "answer") throw new Error("只有学生作答记录可以批阅");
      if (!Array.isArray(questions) || questions.length > 200) throw new Error("批阅题目数量无效");
      const allowedResults = new Set(["正确", "部分正确", "错误", "未作答"]);
      const allowedErrors = new Set(["概念", "计算", "审题", "方法", "其他"]);
      const normalized = questions.map((question, index) => {
        if (!question || typeof question !== "object") throw new Error("第 " + (index + 1) + " 题内容无效");
        const result = cleanText(question.result, 12);
        if (!allowedResults.has(result)) throw new Error("第 " + (index + 1) + " 题判定无效");
        const errorType = cleanText(question.errorType, 12);
        if (result !== "正确" && !allowedErrors.has(errorType)) throw new Error("第 " + (index + 1) + " 题错因无效");
        return {
          questionNo: cleanText(question.questionNo, 24, String(index + 1)),
          studentAnswer: cleanText(question.studentAnswer, 1000),
          result,
          errorType: result === "正确" ? "" : errorType,
          knowledgePoints: Array.isArray(question.knowledgePoints)
            ? [...new Set(question.knowledgePoints.map((point) => cleanText(point, 80)).filter(Boolean))].slice(0, 12)
            : [],
          correctAnswer: cleanText(question.correctAnswer, 1000),
          solutionSummary: cleanText(question.solutionSummary, 2000),
          mastered: Boolean(question.mastered)
        };
      });
      post.review = normalized;
      post.reviewStatus = confirmed ? "confirmed" : "draft";
      if (trainingId !== undefined) post.trainingId = trainingId || null;
      post.reviewUpdatedAt = new Date().toISOString();
      await this.writePost(post);
      return { ...toSummary(post), review: post.review };
    });
  }

  async writePost(post) {
    const directory = this.postDirectory(post.id);
    const temporaryFile = path.join(directory, ".post-" + randomUUID() + ".tmp");
    await fs.writeFile(temporaryFile, JSON.stringify(post, null, 2), { flag: "wx" });
    await fs.rename(temporaryFile, path.join(directory, "post.json"));
  }

  async resolveImage(id, file) {
    if (!FILE_PATTERN.test(file)) throw new Error("无效的图片文件名");
    const post = await this.readPost(id);
    const image = post.images.find((item) => item.file === file);
    if (!image) throw new Error("图片不存在");
    return { path: path.join(this.postDirectory(id), image.file), mime: image.mime };
  }
}

module.exports = { PostStore, IMAGE_TYPES, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES };
