const WRONG_RESULTS = new Set(["部分正确", "错误", "未作答"]);

function deriveLearningStats(answers, now = new Date()) {
  const confirmed = (Array.isArray(answers) ? answers : []).filter((answer) => answer && answer.reviewStatus === "confirmed");
  const questions = confirmed.flatMap((answer) => (Array.isArray(answer.review) ? answer.review : []).map((question, index) => ({ answer, question, index })));
  const correctCount = questions.filter(({ question }) => question.result === "正确").length;
  const mistakes = questions
    .filter(({ question }) => WRONG_RESULTS.has(question.result))
    .map(({ answer, question, index }) => ({
      id: answer.id + "-" + index,
      answerId: answer.id,
      questionIndex: index,
      questionNo: question.questionNo || String(index + 1),
      title: (answer.title || "作答记录") + " · 第 " + (question.questionNo || String(index + 1)) + " 题",
      source: answer.title || "作答记录",
      studentName: answer.studentName || "",
      topic: (Array.isArray(question.knowledgePoints) ? question.knowledgePoints : []).join(" · ") || "未标记知识点",
      knowledgePoints: Array.isArray(question.knowledgePoints) ? question.knowledgePoints : [],
      errorType: question.errorType || "未标记",
      result: question.result,
      status: question.mastered ? "mastered" : "active",
      subject: answer.subject || "",
      collectedAt: answer.collectedAt || ""
    }));

  const cutoff = new Date(now).getTime() - 30 * 24 * 60 * 60 * 1000;
  const recentCount = confirmed.filter((answer) => {
    const time = new Date(answer.collectedAt || "").getTime();
    return Number.isFinite(time) && time >= cutoff;
  }).length;
  const topicCounts = new Map();
  const errorCounts = new Map();
  for (const mistake of mistakes) {
    errorCounts.set(mistake.errorType, (errorCounts.get(mistake.errorType) || 0) + 1);
    const topics = mistake.knowledgePoints.length ? mistake.knowledgePoints : ["未标记知识点"];
    for (const topic of topics) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }

  return {
    confirmedCount: confirmed.length,
    recentCount,
    questionCount: questions.length,
    correctCount,
    accuracy: questions.length ? Math.round(correctCount / questions.length * 100) : null,
    mistakes,
    topics: [...topicCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN")),
    errors: [...errorCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"))
  };
}

module.exports = { deriveLearningStats };
