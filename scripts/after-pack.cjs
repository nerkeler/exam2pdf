// 打包后处理（afterPack），按序：
// 1. 压缩 Chromium 授权文本（LICENSES.chromium.html，新版 Electron 随包约 19MB，
//    运行期不会被读取；压缩为同目录 .gz 保留，原文件删除）。
// 2. darwin：整体重签为有效 adhoc 签名。无签名身份时 electron-builder 会跳过
//    签名，应用只剩链接器对主程序的残留签名（资源封条缺失）→ Gatekeeper 报
//    "已损坏，无法打开"，Squirrel 暂存校验也报资源缺失。重签后提示降级为
//    "无法验证开发者"（系统设置可放行）。
// 本钩子在 electron-builder 自身签名步骤之前执行。若未来启用 Developer ID
// 正式签名，请确保正式签名发生在本钩子之后，不要再改动包内容。
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const TARGET_NAME = "LICENSES.chromium.html";
const MAX_DEPTH = 6;

function findTargets(dir, depth, found) {
  if (depth > MAX_DEPTH) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findTargets(full, depth + 1, found);
    else if (entry.name === TARGET_NAME) found.push(full);
  }
}

exports.default = async function afterPack(context) {
  // 1) LICENSES.chromium.html → gzip
  const found = [];
  findTargets(context.appOutDir, 0, found);
  for (const file of found) {
    const compressed = file + ".gz";
    const original = fs.readFileSync(file);
    fs.writeFileSync(compressed, zlib.gzipSync(original, { level: 9 }));
    fs.unlinkSync(file);
    const saved = ((original.length - fs.statSync(compressed).size) / 1048576).toFixed(1);
    console.log(`  • 已压缩 ${path.basename(file)}（安装体积减少约 ${saved} MB，内容以 gzip 随包保留）`);
  }

  // 2) darwin 整体重签 + 强校验
  if (context.electronPlatformName === "darwin") {
    const appPath = path.join(context.appOutDir, "exam2pdf.app");
    console.log("  • Re-signing mac app with adhoc identity (no developer certificate) ...");
    const resign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
    if (resign.status !== 0) throw new Error("adhoc re-sign failed (exit " + resign.status + ")");
    const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
    if (verify.status !== 0) throw new Error("codesign verify failed (exit " + verify.status + ")");
    console.log("  • codesign verify OK: valid adhoc signature");
  }
};
