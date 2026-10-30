// 打包后处理：压缩 Chromium 授权文本（LICENSES.chromium.html）。
// 新版 Electron 随包携带的该文件已超过 19MB，运行期不会被读取；
// 压缩为同目录 .gz 保留在应用内（第三方声明仍随包分发），原文件删除。
// 注意：本钩子在代码签名之前执行；当前项目为未签名测试包。若未来启用签名，
// 请确保签名发生在本钩子之后，不要再改动包内容。
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

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
};
