const test = require("node:test");
const assert = require("node:assert/strict");
const { generatePractice } = require("./training-generator.cjs");

test("generates five deterministic integer-solution equation questions", () => {
  const first = generatePractice("一元一次方程", 7);
  const second = generatePractice("一元一次方程", 7);
  assert.equal(first.questions.length, 5);
  assert.deepEqual(first.questions, second.questions);
  for (const question of first.questions) assert.match(question.answer, /x = -?\d+/);
});

test("generates arithmetic with whole-number division answers", () => {
  const practice = generatePractice("有理数运算", 42);
  assert.equal(practice.questions.length, 5);
  assert.ok(practice.questions.every((question) => question.prompt.startsWith("计算：") && question.answer.startsWith("结果：")));
});

test("generates fraction exercises when the weak point is fractions", () => {
  const practice = generatePractice("分数加减", 11);
  assert.equal(practice.questions.length, 5);
  assert.ok(practice.questions.every((question) => question.prompt.includes("/")));
  assert.ok(practice.questions.every((question) => question.answer.includes("约分后")));
});

test("provides proof hints for geometry questions and safe fallback topic", () => {
  const geometry = generatePractice("几何证明", 9);
  assert.equal(geometry.questions.length, 5);
  assert.ok(geometry.questions.some((question) => question.answer.includes("平行")));
  assert.equal(generatePractice("", 1).topic, "基础运算");
});
