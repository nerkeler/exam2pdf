// 应用内更新的共享逻辑：版本比较与发布页地址。
// macOS 安装包未签名，Squirrel 自动更新不可用，因此 darwin 只提示并打开下载页；
// Windows / Linux 使用 electron-updater 手动下载、确认后安装。
const RELEASES_PAGE = "https://github.com/nerkeler/exam2pdf/releases/latest";
const LATEST_RELEASE_API = "https://api.github.com/repos/nerkeler/exam2pdf/releases/latest";

function parseVersion(value) {
  const raw = String(value || "").trim().replace(/^v/i, "");
  const [core = "", prerelease = ""] = raw.split("-");
  const [major = 0, minor = 0, patch = 0] = core.split(".").map((part) => Number(part) || 0);
  return { major, minor, patch, prerelease: prerelease.split(".").filter(Boolean) };
}

function isNumericIdentifier(text) {
  return /^\d+$/.test(text);
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;  // 无预发布标识的正式版更大
  if (!b.length) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = isNumericIdentifier(left);
    const rightNumeric = isNumericIdentifier(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff) return diff < 0 ? -1 : 1;
      continue;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePrerelease(left.prerelease, right.prerelease);
}

module.exports = { RELEASES_PAGE, LATEST_RELEASE_API, compareVersions };
