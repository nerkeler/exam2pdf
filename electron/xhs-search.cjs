const SEARCH_GRADES = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "七年级", "八年级", "九年级", "高一", "高二", "高三"];
const SEARCH_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "政治", "科学"];
const SEARCH_VERSIONS = ["人教版", "部编版", "北师大版", "沪科版", "苏教版", "浙教版", "冀教版", "外研版", "译林版", "粤教版"];
const SEARCH_TYPES = ["期中", "期末", "月考", "单元测试", "开学考", "专题"];
const SEARCH_FIELDS = ["grade", "subject", "version", "paperType", "unit"];

const SEARCH_BUTTON_WIDTH = 80;
const SEARCH_BUTTON_HEIGHT = 32;
const SEARCH_BUTTON_EDGE = 12;
const SEARCH_BUTTON_GAP = 8;

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

function readBox(rect, fallback) {
  if (!rect) return fallback;
  const left = Number(rect.left);
  const right = Number(rect.right);
  const top = Number(rect.top);
  const bottom = Number(rect.bottom);
  if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) return fallback;
  return { left, right, top, bottom };
}

function resolveSearchGuidePosition(inputRect, rowRect, viewport, options = {}) {
  const view = viewport && typeof viewport === "object" ? viewport : {};
  const viewWidth = Math.max(1, Math.round(Number(view.width || viewport) || 1));
  const viewHeight = Math.max(1, Math.round(Number(view.height) || 1));
  const wantedWidth = Math.max(64, Math.round(Number(options.width) || SEARCH_BUTTON_WIDTH));
  const wantedHeight = Math.max(24, Math.round(Number(options.height) || SEARCH_BUTTON_HEIGHT));
  const width = Math.min(wantedWidth, Math.max(1, viewWidth - SEARCH_BUTTON_EDGE * 2));
  const height = Math.min(wantedHeight, Math.max(1, viewHeight - SEARCH_BUTTON_EDGE * 2));
  const corner = {
    left: viewWidth - width - SEARCH_BUTTON_EDGE,
    top: SEARCH_BUTTON_EDGE,
    width,
    height
  };

  const input = readBox(inputRect, null);
  if (!input) return corner;
  // 搜索框外面通常还包着一圈可视容器（圆角白底），贴靠时以容器右边缘为准。
  const row = readBox(rowRect, input);
  const rowRight = Math.max(row.right, input.right);
  const rowBottom = Math.max(row.bottom, input.bottom);
  const rowTop = Math.min(row.top, input.top);
  const top = Math.round(Math.min(
    Math.max(SEARCH_BUTTON_EDGE, input.top + (input.bottom - input.top - height) / 2),
    Math.max(SEARCH_BUTTON_EDGE, viewHeight - height - SEARCH_BUTTON_EDGE)
  ));

  // 1) 搜索行右侧还有余地：贴在搜索框后面，并与输入行垂直居中。
  if (rowRight + SEARCH_BUTTON_GAP + width <= viewWidth - SEARCH_BUTTON_EDGE) {
    return { left: Math.round(rowRight + SEARCH_BUTTON_GAP), top, width, height };
  }

  const rightAlignedLeft = Math.round(Math.max(
    SEARCH_BUTTON_EDGE,
    Math.min(rowRight - width, viewWidth - width - SEARCH_BUTTON_EDGE)
  ));

  // 2) 右侧放不下时，退到搜索行上方或下方，右对齐搜索框，避免压住输入框。
  const above = Math.round(rowTop - height - SEARCH_BUTTON_GAP);
  if (above >= SEARCH_BUTTON_EDGE) return { left: rightAlignedLeft, top: above, width, height };
  const below = Math.round(rowBottom + SEARCH_BUTTON_GAP);
  if (below + height <= viewHeight - SEARCH_BUTTON_EDGE) return { left: rightAlignedLeft, top: below, width, height };
  return corner;
}

module.exports = {
  SEARCH_GRADES,
  SEARCH_SUBJECTS,
  SEARCH_VERSIONS,
  SEARCH_TYPES,
  SEARCH_BUTTON_WIDTH,
  SEARCH_BUTTON_HEIGHT,
  SEARCH_BUTTON_EDGE,
  SEARCH_BUTTON_GAP,
  buildSearchQuery,
  buildSearchUrl,
  resolveSearchGuidePosition
};
