function buildXhsCollectionInput(payload, sourceUrl, noteId) {
  return {
    title: payload?.title,
    author: payload?.author,
    source: "小红书采集",
    sourceUrl,
    noteId,
    expectedImages: payload?.expectedImages,
    images: payload?.images
  };
}

// 按标题推断科目：识别不出返回空串（记为"未分类"，可在详情页手动设置）
const SUBJECT_KEYWORDS = [
  ["数学", ["数学", "奥数", "几何", "代数", "函数", "方程"]],
  ["语文", ["语文", "阅读理解", "作文", "古诗文"]],
  ["英语", ["英语", "英文"]],
  ["物理", ["物理"]],
  ["化学", ["化学"]],
  ["生物", ["生物"]],
  ["历史", ["历史"]],
  ["地理", ["地理"]],
  ["政治", ["政治", "道德与法治"]],
  ["科学", ["科学"]]
];

function inferSubject(title) {
  const text = String(title || "");
  for (const [subject, keywords] of SUBJECT_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) return subject;
  }
  return "";
}

module.exports = { buildXhsCollectionInput, inferSubject, SUBJECT_KEYWORDS };
