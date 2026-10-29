const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_QUESTIONS = 50;
const RESULTS = new Set(["正确", "部分正确", "错误", "未作答"]);
const ERROR_TYPES = new Set(["概念", "计算", "审题", "方法", "其他"]);
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function completionUrl(baseUrl) {
  let url;
  try { url = new URL(String(baseUrl || "")); }
  catch { throw new Error("AI 接口地址无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("AI 接口必须使用不带账号信息的 HTTPS 地址");
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname.endsWith("/chat/completions") ? pathname : pathname + "/chat/completions";
  return url.href;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n");
}

function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); }
  catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 返回内容无法识别为逐题批阅 JSON，请重试或手动批阅");
    try { return JSON.parse(text.slice(start, end + 1)); }
    catch { throw new Error("AI 返回内容不是有效 JSON，请重试或手动批阅"); }
  }
}

function cleanText(value, limit) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function normalizeReview(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.questions)) throw new Error("AI 没有返回逐题批阅结果，请重试或手动批阅");
  if (!value.questions.length || value.questions.length > MAX_QUESTIONS) throw new Error("AI 返回的题目数量无效，请重试或手动批阅");
  const questions = value.questions.map((question, index) => {
    if (!question || typeof question !== "object") throw new Error("AI 返回了无效的题目记录，请重试或手动批阅");
    const questionNo = cleanText(question.questionNo, 32) || String(index + 1);
    const result = cleanText(question.result, 20);
    if (!RESULTS.has(result)) throw new Error("AI 返回了无法识别的判定结果，请重试或手动批阅");
    const knowledgePoints = Array.isArray(question.knowledgePoints)
      ? [...new Set(question.knowledgePoints.map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, 12)
      : [];
    return {
      questionNo,
      result,
      errorType: ERROR_TYPES.has(question.errorType) ? question.errorType : "其他",
      knowledgePoints,
      studentAnswer: cleanText(question.studentAnswer, 2000),
      correctAnswer: cleanText(question.correctAnswer, 2000),
      solutionSummary: cleanText(question.solutionSummary, 3000),
      mastered: false
    };
  });
  if (new Set(questions.map((question) => question.questionNo)).size !== questions.length) throw new Error("AI 返回了重复题号，请检查图片后手动批阅");
  return questions;
}

async function readResponseText(response, maxBytes) {
  const advertisedLength = Number(response.headers?.get?.("content-length") || 0);
  if (advertisedLength > maxBytes) throw new Error("AI 返回内容过大");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("AI 返回内容过大");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("AI 返回内容过大");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

async function createAiReview({ baseUrl, model, apiKey, images, fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 AI 网络请求");
  const normalizedModel = cleanText(model, 120);
  const normalizedKey = cleanText(apiKey, 4096);
  if (!normalizedModel || !normalizedKey) throw new Error("请检查 AI 模型和 API Key 配置");
  if (!Array.isArray(images) || !images.length || images.length > 24) throw new Error("作答图片数量无效");
  let totalBytes = 0;
  for (const image of images) {
    if (!image || !MIME_TYPES.has(image.mime) || !Buffer.isBuffer(image.bytes) || !image.bytes.length) throw new Error("作答图片格式无效");
    totalBytes += image.bytes.length;
  }
  if (totalBytes > MAX_INPUT_BYTES) throw new Error("作答图片合计超过 20 MB；请压缩图片后再尝试 AI 批阅");

  const content = [{
    type: "text",
    text: "请按图片页序阅读这份学生作答试卷，识别所有可辨认的题目并逐题批阅。不要猜测模糊内容；无法可靠判断时使用“部分正确”并在解题说明中说明不确定处。只输出 JSON 对象，结构为 {\"questions\":[{\"questionNo\":\"题号\",\"result\":\"正确/部分正确/错误/未作答\",\"errorType\":\"概念/计算/审题/方法/其他\",\"knowledgePoints\":[\"知识点\"],\"studentAnswer\":\"学生作答摘要\",\"correctAnswer\":\"参考答案\",\"solutionSummary\":\"按解题四步写全的完整过程\"}]}。按图片出现顺序排列题目；不要添加 Markdown 围栏或卷面以外的题目。solutionSummary 必须按解题四步写全，不要一句话带过：①指出依据的条件、公式或定理；②给出关键计算步骤，保留必要算式与中间结果；③说明学生的错误出在哪一步（正确题可省略）；④结尾用【重点：…】点出最核心的易错点或思想方法。所有数学公式用 LaTeX 写法：行内公式用 $...$（例如 $y=\\frac{1}{2}x+1$），独立公式用 $$...$$；不要用图片或特殊字符拼凑公式。"
  }];
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    content.push({ type: "text", text: "作答页 " + (index + 1) });
    content.push({ type: "image_url", image_url: { url: "data:" + image.mime + ";base64," + image.bytes.toString("base64"), detail: "high" } });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    let response;
    try {
      response = await fetchImpl(completionUrl(baseUrl), {
        method: "POST",
        redirect: "error",
        headers: { "Authorization": "Bearer " + normalizedKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: normalizedModel,
          messages: [{ role: "user", content }],
          temperature: 0.2,
          max_tokens: 5000
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AI 请求超时或已取消，请检查网络后重试");
      throw new Error("连接 AI 服务失败：" + cleanText(error?.message, 240));
    }

    const raw = await readResponseText(response, MAX_RESPONSE_BYTES);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { throw new Error("AI 服务返回了无法识别的响应"); }
    if (!response.ok) {
      const detail = cleanText(payload?.error?.message || payload?.message || "", 300);
      throw new Error("AI 服务请求失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
    }
    const answer = textContent(payload?.choices?.[0]?.message?.content);
    if (!answer) throw new Error("AI 没有返回批阅内容，请检查模型是否支持图片输入");
    return { model: normalizedModel, review: normalizeReview(parseJsonObject(answer)) };
  } finally {
    clearTimeout(timeout);
  }
}

// 1x1 透明 PNG：探测模型是否接受图片输入（纯文本模型如 DeepSeek 官方 API 会明确拒绝）
const VISION_PROBE_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// 探测结果三态：true 支持图片；false 服务端明确拒绝；null 无法确认（网络层失败，不下定论）
async function probeVisionSupport({ baseUrl, model, apiKey, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(completionUrl(baseUrl), {
      method: "POST",
      redirect: "error",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: [
        { type: "text", text: "图片输入测试。请只回复 OK。" },
        { type: "image_url", image_url: { url: VISION_PROBE_IMAGE } }
      ] }], max_tokens: 64, temperature: 0 }),
      signal: controller.signal
    });
    const raw = await readResponseText(response, MAX_RESPONSE_BYTES);
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    if (response.ok) {
      return payload?.choices?.[0]?.message
        ? { vision: true }
        : { vision: false, visionDetail: "服务已响应但返回格式异常" };
    }
    const detail = cleanText(payload?.error?.message || payload?.message || "", 300);
    return { vision: false, visionDetail: detail || "HTTP " + response.status };
  } catch (error) {
    return { vision: null, visionDetail: error?.name === "AbortError" ? "探测超时" : cleanText(error?.message, 240) };
  } finally {
    clearTimeout(timeout);
  }
}

async function testAiConnection({ baseUrl, model, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 AI 网络请求");
  const normalizedModel = cleanText(model, 120);
  const normalizedKey = cleanText(apiKey, 4096);
  if (!normalizedModel || !normalizedKey) throw new Error("请检查 AI 模型和 API Key 配置");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    let response;
    try {
      response = await fetchImpl(completionUrl(baseUrl), {
        method: "POST",
        redirect: "error",
        headers: { "Authorization": "Bearer " + normalizedKey, "Content-Type": "application/json" },
        // 推理模型（如 DeepSeek deepseek-flash）会先产出思维链，max_tokens 太小会导致正文为空
        body: JSON.stringify({ model: normalizedModel, messages: [{ role: "user", content: "连接测试。请只回复 OK。" }], max_tokens: 512, temperature: 0 }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AI 连接测试超时或已取消");
      throw new Error("连接 AI 服务失败：" + cleanText(error?.message, 240));
    }
    const raw = await readResponseText(response, MAX_RESPONSE_BYTES);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { throw new Error("AI 服务返回了无法识别的响应"); }
    if (!response.ok) {
      const detail = cleanText(payload?.error?.message || payload?.message || "", 300);
      throw new Error("AI 服务请求失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
    }
    // 推理模型的 token 会先花在 reasoning_content 上，只要 message 存在即视为连接成功
    if (!payload?.choices?.[0]?.message) throw new Error("AI 服务已响应，但没有返回文本；请检查模型配置");
    const probe = await probeVisionSupport({ baseUrl, model: normalizedModel, apiKey: normalizedKey, fetchImpl, timeoutMs });
    return { model: normalizedModel, connected: true, vision: probe.vision, visionDetail: probe.visionDetail || "" };
  } finally {
    clearTimeout(timeout);
  }
}

// 宽松兜底提取：AI 输出的 JSON 常有局部语法错误（如 knowledgePoints 写成裸字符串串），
// 严格 JSON.parse 失败时按 questionNo 分段、逐字段容错提取，仍交给 normalizeReview 校验。
const REVIEW_FIELDS = "questionNo|result|errorType|knowledgePoints|studentAnswer|correctAnswer|solutionSummary|mastered";
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';

function extractQuestionsLoose(text) {
  const source = String(text || "");
  if (!source.trim()) return [];
  const segments = source.split(/"questionNo"\s*:/);
  const results = ["正确", "部分正确", "错误", "未作答"];
  const questions = [];
  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const noMatch = segment.match(/^\s*"((?:[^"\\]|\\.)*)"/) || segment.match(/^\s*([0-9]+)/);
    const pick = (field) => {
      // 常规：闭合字符串；兜底：AI 输出被截断时的未闭合字符串（取到段尾并清掉尾部括号）
      const closed = segment.match(new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
      if (closed) return closed[1];
      const open = segment.match(new RegExp('"' + field + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)$'));
      return open ? open[1].replace(/[}\]\s]+$/, "") : "";
    };
    const rawResult = pick("result").trim();
    const result = results.find((value) => rawResult.startsWith(value) || rawResult.replace(/[。．.！!？?\s]+$/, "") === value) || "";
    if (!result) continue;
    let knowledgePoints = [];
    const kpMatch = segment.match(new RegExp('"knowledgePoints"\\s*:\\s*(\\[(?:[^\\]\\\\]|\\\\.)*\\]|' + QUOTED + '(?:\\s*,\\s*(?!"(?:' + REVIEW_FIELDS + ')"\\s*:)' + QUOTED + ')*)'));
    if (kpMatch) {
      const raw = kpMatch[1];
      if (raw.startsWith("[")) {
        try {
          const arr = JSON.parse(raw.replace(/,\s*\]$/, "]"));
          if (Array.isArray(arr)) knowledgePoints = arr.map((item) => String(item ?? ""));
        } catch {
          knowledgePoints = [...raw.matchAll(new RegExp(QUOTED, "g"))].map((m) => m[1]);
        }
      } else {
        knowledgePoints = [...raw.matchAll(new RegExp(QUOTED, "g"))].map((m) => m[1]);
      }
    }
    questions.push({
      questionNo: (noMatch ? noMatch[1] : "").trim() || String(questions.length + 1),
      result,
      errorType: pick("errorType"),
      knowledgePoints: knowledgePoints.map((item) => item.trim()).filter(Boolean),
      studentAnswer: pick("studentAnswer"),
      correctAnswer: pick("correctAnswer"),
      solutionSummary: pick("solutionSummary")
    });
  }
  return questions;
}

// 外部网页 AI（豆包/千问/DeepSeek 等）返回内容的解析入口：
// 与 API 批阅共用 parseJsonObject + normalizeReview，保证两条路径的草稿格式完全一致。
// 额外归一（只作用于外部路径）：
// 1) 双重转义反斜杠归一（\\geqslant → \geqslant，cases 环境内跳过）；
// 2) 公式定界符统一：豆包风格的 \(...\) / \[...\] → $...$ / $$...$$，
//    并清掉 $...$ 内部残留的 \( \)（AI 常把括号误转义，KaTeX 无法解析）。
function collapseDoubleBackslashes(value) {
  return String(value ?? "")
    .split(/(\\begin\{cases\}[\s\S]*?\\end\{cases\})/)
    .map((part) => part.startsWith("\\begin{cases}") ? part : part.replace(/\\\\/g, "\\"))
    .join("");
}

function normalizeMathDelimiters(value) {
  let out = String(value ?? "");
  const protectedSpans = [];
  // ① 已有 $...$ 区段：内部 \( \) 是 AI 误转义的括号，还原为 ( ) 并整体保护
  out = out.replace(/\$([^$]*)\$/g, (match, inner) => {
    protectedSpans.push("$" + inner.replace(/\\\(/g, "(").replace(/\\\)/g, ")") + "$");
    return "\u0000" + (protectedSpans.length - 1) + "\u0000";
  });
  // ② 区段外的豆包风格 \(...\)：深度计数配对（内层 \( \) 是公式里的括号，还原后并入同一公式）
  out = convertParenDelimiters(out);
  // ③ \[...\] 无嵌套问题，惰性配对转 $$...$$
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (match, inner) => "$$" + inner.trim() + "$$");
  // ④ 还原受保护的 $...$ 区段
  out = out.replace(/\u0000(\d+)\u0000/g, (match, index) => protectedSpans[Number(index)]);
  return out;
}

// \( ... \) 配对采用深度计数：\( 使深度 +1，\) 在深度 >1 时是内层括号（还原为普通括号），
// 深度归 0 的 \) 才是公式结束定界符。这样豆包"外层定界符 + 内层转义括号"的嵌套输出也能正确切分。
function convertParenDelimiters(text) {
  let out = "";
  let i = 0;
  const len = text.length;
  while (i < len) {
    if (text[i] === "\\" && text[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let contentEnd = -1;
      while (j < len) {
        if (text[j] === "\\" && text[j + 1] === "(") { depth++; j += 2; continue; }
        if (text[j] === "\\" && text[j + 1] === ")") {
          if (depth > 1) { depth--; j += 2; continue; }
          contentEnd = j;
          j += 2;
          break;
        }
        j++;
      }
      if (contentEnd >= 0) {
        const inner = text.slice(i + 2, contentEnd).replace(/\\\(/g, "(").replace(/\\\)/g, ")").trim();
        out += "$" + inner + "$";
        i = j;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

function normalizeExternalDraft(review) {
  return review.map((question) => ({
    ...question,
    studentAnswer: normalizeMathDelimiters(collapseDoubleBackslashes(question.studentAnswer)),
    correctAnswer: normalizeMathDelimiters(collapseDoubleBackslashes(question.correctAnswer)),
    solutionSummary: normalizeMathDelimiters(collapseDoubleBackslashes(question.solutionSummary)),
    knowledgePoints: (question.knowledgePoints || []).map((item) => collapseDoubleBackslashes(item))
  }));
}

function parseExternalReview(text) {
  let parsed;
  try {
    parsed = parseJsonObject(text);
  } catch {
    const loose = extractQuestionsLoose(text);
    if (!loose.length) throw new Error("粘贴内容无法识别为逐题批阅 JSON；请确认复制了完整批阅内容后重试");
    return { model: "外部 AI 网页批阅", review: normalizeExternalDraft(normalizeReview({ questions: loose })) };
  }
  if (Array.isArray(parsed)) parsed = { questions: parsed };
  return { model: "外部 AI 网页批阅", review: normalizeExternalDraft(normalizeReview(parsed)) };
}

module.exports = { createAiReview, testAiConnection, parseExternalReview, extractQuestionsLoose, completionUrl, normalizeReview, parseJsonObject, MAX_INPUT_BYTES };
