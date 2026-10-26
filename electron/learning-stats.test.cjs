const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveLearningStats } = require("./learning-stats.cjs");

test("derives learning indicators only from confirmed answer records", () => {
  const stats = deriveLearningStats([
    { id: "draft", reviewStatus: "draft", review: [{ result: "错误", knowledgePoints: ["分数"], errorType: "计算" }] },
    { id: "done", title: "月考", studentName: "小明", collectedAt: "2026-10-18T10:00:00.000Z", reviewStatus: "confirmed", review: [
      { questionNo: "1", result: "正确" },
      { questionNo: "2", result: "错误", errorType: "计算", knowledgePoints: ["分数", "约分"], mastered: false },
      { questionNo: "3", result: "部分正确", errorType: "方法", knowledgePoints: [], mastered: true }
    ] }
  ], new Date("2026-10-19T10:00:00.000Z"));

  assert.equal(stats.confirmedCount, 1);
  assert.equal(stats.recentCount, 1);
  assert.equal(stats.questionCount, 3);
  assert.equal(stats.accuracy, 33);
  assert.equal(stats.mistakes.length, 2);
  assert.equal(stats.mistakes[1].status, "mastered");
  assert.deepEqual(stats.topics, [
    { name: "分数", count: 1 },
    { name: "未标记知识点", count: 1 },
    { name: "约分", count: 1 }
  ]);
  assert.deepEqual(stats.errors, [{ name: "方法", count: 1 }, { name: "计算", count: 1 }]);
});

test("reports missing history without inventing an accuracy or trend", () => {
  const stats = deriveLearningStats([{ id: "empty", reviewStatus: "confirmed", review: [] }]);
  assert.equal(stats.accuracy, null);
  assert.equal(stats.questionCount, 0);
  assert.equal(stats.recentCount, 0);
  assert.deepEqual(stats.topics, []);
  assert.deepEqual(stats.errors, []);
});


test("mistakes inherit the subject of their answer record", () => {
  const answers = [{
    id: "a1", title: "数学月考", reviewStatus: "confirmed", subject: "数学", collectedAt: "2026-10-20",
    review: [
      { questionNo: "1", result: "错误", errorType: "计算", knowledgePoints: ["去括号"], mastered: false },
      { questionNo: "2", result: "正确", errorType: "", knowledgePoints: [], mastered: false }
    ]
  }];
  const stats = deriveLearningStats(answers);
  assert.equal(stats.mistakes.length, 1);
  assert.equal(stats.mistakes[0].subject, "数学");
  // 多份卷子时标题带来源试卷名，避免只显示"第 N 题"无法区分
  assert.equal(stats.mistakes[0].title, "数学月考 · 第 1 题");
  const empty = deriveLearningStats([{ id: "a2", reviewStatus: "confirmed", review: [{ questionNo: "1", result: "错误", errorType: "概念" }] }]);
  assert.equal(empty.mistakes[0].subject, "");
});
