// electron-builder afterPack 钩子：mac 应用目录组装完成后、DMG/ZIP 打包前，
// 整体重签为有效 adhoc 签名。无签名身份时 electron-builder 跳过签名，应用
// 只剩链接器对主程序的残留签名（资源封条缺失）→ Gatekeeper 报"已损坏"。
const { spawnSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const productName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, productName + ".app");
  console.log("Re-signing mac app with adhoc identity (no developer certificate) ...");
  const resign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  if (resign.status !== 0) throw new Error("adhoc re-sign failed (exit " + resign.status + ")");
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  if (verify.status !== 0) throw new Error("codesign verify failed (exit " + verify.status + ")");
  console.log("codesign verify OK: valid adhoc signature for " + appPath);
};
