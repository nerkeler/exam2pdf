const SEARCH_GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "七年级", "八年级", "九年级", "高一", "高二", "高三"];
const SEARCH_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "科学"];
const SEARCH_VERSIONS = ["人教版", "部编版", "北师大版", "沪科版", "苏教版", "浙教版", "冀教版", "外研版", "译林版", "粤教版"];
const SEARCH_TYPES = ["期中", "期末", "月考", "单元测试", "开学考", "专题"];
const SEARCH_FIELDS = ["grade", "subject", "version", "paperType", "unit"];

function buildSearchQuery(selection) {
  const values = selection && typeof selection === "object" ? selection : {};
  return SEARCH_FIELDS
    .map((field) => String(values[field] || "").trim().slice(0, 60))
    .filter(Boolean)
    .join(" ");
}

function buildSearchUrl(query) {
  const keyword = String(query || "").trim().slice(0, 300);
  if (!keyword) return null;
  const url = new URL("https://www.xiaohongshu.com/search_result");
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("source", "web_explore_feed");
  return url.toString();
}

function resolveSearchPanelBounds(viewport, open = false) {
  const viewWidth = Math.max(1, Math.round(Number(viewport?.width) || 1));
  const viewHeight = Math.max(1, Math.round(Number(viewport?.height) || 1));
  const edgeX = Math.min(12, Math.max(0, Math.floor((viewWidth-1)/2)));
  const top = Math.min(12, Math.max(0, Math.floor((viewHeight-1)/2)));
  const width = Math.min(open ? 350 : 80, viewWidth-edgeX*2);
  const height = Math.min(open ? 540 : 32, viewHeight-top*2);
  return {left:viewWidth-edgeX-width, top, width, height};
}

module.exports = {
  SEARCH_GRADES,
  SEARCH_SUBJECTS,
  SEARCH_VERSIONS,
  SEARCH_TYPES,
  buildSearchQuery,
  buildSearchUrl,
  resolveSearchPanelBounds
};
