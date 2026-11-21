const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function checkPdfRuntime(projectRoot) {
  const runtime = path.join(projectRoot, "node_modules", "pdfjs-dist");
  const required = ["build/pdf.mjs", "build/pdf.worker.mjs", "LICENSE", "cmaps", "standard_fonts", "wasm"];
  for (const name of required) {
    if (!fs.existsSync(path.join(runtime, name))) throw new Error("Missing bundled PDF.js resource: " + name + "; run npm ci first");
  }
  return runtime;
}

function getBuildArgs(target, arch) {
  if (!["mac", "win", "linux"].includes(target)) throw new Error("Unknown package target: " + target);
  if (!["x64", "arm64"].includes(arch)) throw new Error("Unsupported build architecture: " + arch);
  const formats = { mac: ["dmg", "zip"], win: ["nsis"], linux: ["AppImage", "deb"] };
  return ["--" + target, ...formats[target], "--" + arch, "--publish", "never"];
}

function main() {
  const target = process.argv[2];
  const arch = process.env.EXAM2PDF_BUILD_ARCH || (target === "mac" ? process.arch : "x64");
  const projectRoot = path.resolve(__dirname, "..");
  let args;
  try {
    args = getBuildArgs(target, arch);
    checkPdfRuntime(projectRoot);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (process.argv.includes("--check-only")) {
    console.log("Bundled PDF.js resources verified for " + target + " " + arch + ". No installer was built.");
    return;
  }
  const builder = path.join(projectRoot, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
  const result = spawnSync(builder, args, {
    cwd: projectRoot, stdio: "inherit",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || "false" },
    shell: process.platform === "win32"
  });
  if (result.error) console.error("Unable to run electron-builder: " + result.error.message);
  const builderFailed = result.status == null || result.status !== 0;
  // mac 目标：electron-builder 无签名身份时跳过签名，应用只剩链接器对主程序的
  // adhoc 签名——资源封条缺失，Gatekeeper 报"已损坏，无法打开"。整体重签为
  // 有效的 adhoc 签名：提示降级为"无法验证开发者"（系统设置可放行），且
  // Squirrel 暂存校验不再报资源缺失。
  if (target === "mac" && process.platform === "darwin" && !builderFailed) {
    const appPath = arch === "x64"
      ? path.join(projectRoot, "release", "mac", "exam2pdf.app")
      : path.join(projectRoot, "release", "mac-arm64", "exam2pdf.app");
    if (fs.existsSync(appPath)) {
      console.log("Re-signing mac app with adhoc identity (no developer certificate) ...");
      const resign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
      if (resign.status !== 0) {
        console.error("adhoc re-sign failed");
        process.exit(resign.status == null ? 1 : resign.status);
      }
      const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
      console.log(verify.status === 0
        ? "codesign verify OK: valid adhoc signature"
        : "codesign verify FAILED (exit " + verify.status + ")");
      if (verify.status !== 0) process.exit(verify.status);
    }
  }
  process.exit(result.status == null ? 1 : result.status);
}

if (require.main === module) main();
module.exports = { checkPdfRuntime, getBuildArgs };
