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
  process.exit(result.status == null ? 1 : result.status);
}

if (require.main === module) main();
module.exports = { checkPdfRuntime, getBuildArgs };
