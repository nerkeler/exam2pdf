const test = require("node:test");
const assert = require("node:assert/strict");
const { generateAiPractice, normalizePractice } = require("./ai-practice-service.cjs");

function sampleQuestions() {
  return Array.from({ length: 5 }, (_, index) => ({
    prompt: "练习题 " + (index + 1),
    answer: "解题过程与答案 " + (index + 1)
  }));
}

test("requests five text-only questions and returns an unapproved practice draft", async () => {
  let request;
  const result = await generateAiPractice({
    baseUrl: "https://api.example.test/v1/",
    model: "text-model",
    apiKey: "test-key",
    topic: "分数加减",
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ questions: sampleQuestions() }) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.equal(request.url, "https://api.example.test/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.match(request.body.messages[0].content, /分数加减/);
  assert.equal(request.body.max_tokens, 3500);
  assert.equal(Object.hasOwn(request.body.messages[0], "images"), false);
  assert.equal(result.topic, "分数加减");
  assert.equal(result.source, "AI 生成草稿（待家长审核）");
  assert.equal(Object.hasOwn(result, "status"), false, "the store must create this as an unapproved draft");
  assert.equal(result.questions.length, 5);
  assert.equal(result.questions[4].answer, "解题过程与答案 5");
});

test("rejects insecure endpoints, missing keys, wrong question count, and incomplete questions", async () => {
  await assert.rejects(generateAiPractice({
    baseUrl: "http://api.example.test/v1", model: "text-model", apiKey: "key", topic: "方程",
    fetchImpl: async () => { throw new Error("must not call"); }
  }), /HTTPS/);
  await assert.rejects(generateAiPractice({
    baseUrl: "https://api.example.test/v1", model: "text-model", apiKey: "", topic: "方程",
    fetchImpl: async () => { throw new Error("must not call"); }
  }), /API Key/);
  assert.throws(() => normalizePractice({ questions: sampleQuestions().slice(0, 4) }, "方程"), /数量不是 5/);
  assert.throws(() => normalizePractice({ questions: [{ prompt: "重复题", answer: "答案" }, { prompt: "重复题", answer: "答案" }, ...sampleQuestions().slice(2)] }, "方程"), /重复练习题/);
  const incomplete = sampleQuestions();
  incomplete[2].answer = "  ";
  assert.throws(() => normalizePractice({ questions: incomplete }, "方程"), /缺少题目或答案/);
});

test("bounds provider errors and response size", async () => {
  await assert.rejects(generateAiPractice({
    baseUrl: "https://api.example.test/v1", model: "text-model", apiKey: "key", topic: "方程",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 })
  }), /HTTP 429.*quota exceeded/);
  await assert.rejects(generateAiPractice({
    baseUrl: "https://api.example.test/v1", model: "text-model", apiKey: "key", topic: "方程",
    fetchImpl: async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 })
  }), /返回内容过大/);
});
