const { completionUrl, parseJsonObject } = require("./ai-review-service.cjs");

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const QUESTION_COUNT = 5;

function cleanText(value, limit) {
  return String(value == null ? "" : value).trim().slice(0, limit);
}

function responseContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => typeof part === "string" ? part : part?.text || "").join("\n");
}

async function readResponseText(response) {
  const advertisedLength = Number(response.headers?.get?.("content-length") || 0);
  if (advertisedLength > MAX_RESPONSE_BYTES) throw new Error("AI 返回内容过大");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("AI 返回内容过大");
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
      if (total > MAX_RESPONSE_BYTES) {
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

function normalizePractice(value, topic) {
  if (!value || typeof value !== "object" || !Array.isArray(value.questions)) {
    throw new Error("AI 没有返回练习题，请重试");
  }
  if (value.questions.length !== QUESTION_COUNT) throw new Error("AI 返回的练习题数量不是 5 道，请重试");
  const questions = value.questions.map((question, index) => {
    if (!question || typeof question !== "object") throw new Error("AI 返回了无效的第 " + (index + 1) + " 道题");
    const prompt = cleanText(question.prompt, 1000);
    const answer = cleanText(question.answer, 2000);
    if (!prompt || !answer) throw new Error("AI 返回的第 " + (index + 1) + " 道题缺少题目或答案");
    return { prompt, answer };
  });
  if (new Set(questions.map((question) => question.prompt.toLocaleLowerCase("zh-CN"))).size !== questions.length) {
    throw new Error("AI 返回了重复练习题，请重试");
  }
  return {
    topic,
    source: "AI 生成草稿（待家长审核）",
    createdAt: new Date().toISOString(),
    questions
  };
}

async function generateAiPractice({ baseUrl, model, apiKey, topic, fetchImpl = globalThis.fetch, timeoutMs = 90000 }) {
  if (typeof fetchImpl !== "function") throw new Error("当前运行环境不支持 AI 网络请求");
  const normalizedModel = cleanText(model, 120);
  const normalizedKey = cleanText(apiKey, 4096);
  const normalizedTopic = cleanText(topic, 120);
  if (!normalizedModel || !normalizedKey) throw new Error("请检查 AI 模型和 API Key 配置");
  if (!normalizedTopic) throw new Error("请先选择薄弱知识点");

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
          messages: [{
            role: "user",
            content: "请为中小学生围绕知识点“" + normalizedTopic + "”生成恰好 5 道从基础到提升的练习，并给出可供家长核对的简明解题过程和答案。只输出 JSON 对象，结构为 {\"questions\":[{\"prompt\":\"题目\",\"answer\":\"解题过程与答案\"}]}。题目应有唯一、可验证的答案；不要编造教材页码或考试标准；不要输出 Markdown 围栏。"
          }],
          temperature: 0.35,
          max_tokens: 3500
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AI 练习生成超时或已取消，请检查网络后重试");
      throw new Error("连接 AI 服务失败：" + cleanText(error?.message, 240));
    }

    const raw = await readResponseText(response);
    let payload;
    try { payload = JSON.parse(raw); }
    catch { throw new Error("AI 服务返回了无法识别的响应"); }
    if (!response.ok) {
      const detail = cleanText(payload?.error?.message || payload?.message || "", 300);
      throw new Error("AI 服务请求失败（HTTP " + response.status + "）" + (detail ? "：" + detail : ""));
    }
    const content = responseContent(payload?.choices?.[0]?.message?.content);
    if (!content) throw new Error("AI 没有返回练习内容");
    return normalizePractice(parseJsonObject(content), normalizedTopic);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { generateAiPractice, normalizePractice, MAX_RESPONSE_BYTES };
