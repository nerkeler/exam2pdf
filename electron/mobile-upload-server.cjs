const http = require("node:http");
const os = require("node:os");
const { randomBytes, timingSafeEqual } = require("node:crypto");

const MAX_FILES = 24;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

const UPLOAD_PAGE = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>上传学生作答</title>
<style>body{font:16px system-ui,sans-serif;max-width:620px;margin:0 auto;padding:24px 18px;color:#202733;background:#f5f7fb}main{background:white;border:1px solid #dce2ec;border-radius:18px;padding:22px}h1{font-size:22px;margin:0 0 8px}p{color:#637083;line-height:1.55}label{display:block;margin:18px 0 7px;font-weight:600}input{box-sizing:border-box;width:100%;min-height:48px;border:1px solid #ccd4e0;border-radius:10px;padding:10px;font:inherit}input[type=file]{padding:12px;background:#f8f9fb}button{width:100%;min-height:50px;margin-top:20px;border:0;border-radius:11px;background:#1764ff;color:white;font:inherit;font-weight:700}button:disabled{opacity:.55}#status{min-height:24px;margin-top:14px}</style>
<main><h1>上传学生作答</h1><p>选择学生完成后的答题照片，提交后会直接保存到电脑上的「家卷」作答记录。支持 JPG、PNG、WebP，最多 24 张，每张不超过 16 MB。</p>
<form id="uploadForm"><label for="title">试卷名称</label><input id="title" name="title" maxlength="160" placeholder="例如：八年级数学周练">
<p>当前学生：<strong>__STUDENT_LABEL__</strong>。如需上传给另一位学生，请先在电脑上切换并重新开启上传。</p>
<label for="images">作答照片</label><input id="images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required>
<button id="submit" type="submit">上传到电脑</button></form><p id="status" role="status" aria-live="polite"></p></main>
<script>const form=document.querySelector('#uploadForm'),status=document.querySelector('#status'),button=document.querySelector('#submit');form.addEventListener('submit',async event=>{event.preventDefault();const files=document.querySelector('#images').files;if(!files.length){status.textContent='请先选择作答照片';return}button.disabled=true;status.textContent='正在上传…';try{const response=await fetch(location.pathname+'/upload',{method:'POST',body:new FormData(form)});const result=await response.json();if(!response.ok)throw new Error(result.error||'上传失败');status.textContent='已保存：'+result.title+'（'+result.pages+' 张），可以关闭此页。';form.reset()}catch(error){status.textContent=error.message||'上传失败，请重试'}finally{button.disabled=false}})</script></html>`;

function getLanAddresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces)) {
    for (const entry of entries || []) {
      if (!entry.internal && (entry.family === "IPv4" || entry.family === 4)) addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function matchesToken(candidate, expected) {
  if (typeof candidate !== "string") return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_REQUEST_BYTES) {
        reject(new Error("上传内容超过 80 MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks, total)));
    request.on("error", reject);
  });
}

function parseMultipart(contentType, body) {
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([\w'()+,./:=?-]{1,70})"|([\w'()+,./:=?-]{1,70}))$/i.exec(contentType || "");
  if (!match) throw new Error("上传表单格式无效");
  const boundary = Buffer.from("--" + (match[1] || match[2]));
  const fields = Object.create(null);
  const files = [];
  let offset = 0;
  while (offset < body.length) {
    const boundaryStart = body.indexOf(boundary, offset);
    if (boundaryStart < 0) break;
    let cursor = boundaryStart + boundary.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) cursor += 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd < 0) throw new Error("上传表单头部无效");
    const headers = body.toString("latin1", cursor, headerEnd);
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(Buffer.concat([Buffer.from("\r\n"), boundary]), dataStart);
    if (nextBoundary < 0) throw new Error("上传表单内容不完整");
    const data = body.subarray(dataStart, nextBoundary);
    const disposition = /content-disposition:\s*form-data;\s*name="([^"]{1,64})"(?:;\s*filename="([^"]{0,255})")?/i.exec(headers);
    if (!disposition) throw new Error("上传表单字段无效");
    const [, name, filename] = disposition;
    if (filename !== undefined) {
      if (filename && data.length) {
        const mime = (/content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || "application/octet-stream").trim().toLowerCase();
        files.push({ name, mime, bytes: data });
      }
    } else if (name === "title" || name === "studentName") {
      fields[name] = data.toString("utf8").trim().slice(0, name === "title" ? 160 : 80);
    }
    offset = nextBoundary + 2;
  }
  if (files.length < 1 || files.length > MAX_FILES) throw new Error("请上传 1 到 24 张作答照片");
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0);
  if (files.some((file) => file.bytes.length > MAX_FILE_BYTES)) throw new Error("单张照片不能超过 16 MB");
  if (totalBytes > MAX_REQUEST_BYTES) throw new Error("照片总大小不能超过 80 MB");
  for (const file of files) {
    const allowed = IMAGE_EXTENSIONS.has(file.mime);
    const bytes = file.bytes;
    const actual = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
      : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : "";
    if (!allowed || actual !== file.mime) throw new Error("照片格式无效，请使用 JPG、PNG 或 WebP");
  }
  return { fields, files };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  });
  response.end(JSON.stringify(body));
}

function createUploadHandler({ token, answerStore, onUploaded, getStudentId, studentName }) {
  if (!token || !answerStore || typeof answerStore.createPost !== "function") throw new Error("手机上传服务配置无效");
  const tokenPath = "/u/" + token;
  return async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const pathParts = url.pathname.split("/");
      if (pathParts.length < 3 || pathParts[1] !== "u" || !matchesToken(pathParts[2], token)) {
        sendJson(response, 404, { error: "上传地址无效或已失效" });
        return;
      }
      if (request.method === "GET" && url.pathname === tokenPath) {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer"
        });
        response.end(UPLOAD_PAGE.replace("__STUDENT_LABEL__", String(studentName || "当前学生").replace(/[&<>\"]/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;"})[char])));
        return;
      }
      if (request.method !== "POST" || url.pathname !== tokenPath + "/upload") {
        sendJson(response, 405, { error: "不支持的请求" });
        return;
      }
      const body = await readRequestBody(request);
      const { fields, files } = parseMultipart(request.headers["content-type"], body);
      const result = await answerStore.createPost({
        recordType: "answer",
        title: fields.title || "手机上传作答",
        studentName: studentName === undefined ? (fields.studentName || "") : studentName,
        studentId: typeof getStudentId === "function" ? getStudentId() : null,
        images: files.map(({ mime, bytes }) => ({ mime, base64: bytes.toString("base64") }))
      });
      if (typeof onUploaded === "function") await onUploaded(result.post);
      sendJson(response, 201, { id: result.post.id, title: result.post.title, pages: result.post.pages });
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const message = String(error && error.message || "上传失败");
      sendJson(response, /超过|请上传|格式无效|无效/.test(message) ? 400 : 500, { error: message });
    }
  };
}

async function startMobileUploadServer({ answerStore, onUploaded, getStudentId, studentName, host = "0.0.0.0", port = 0, networkInterfaces } = {}) {
  if (!answerStore || typeof answerStore.createPost !== "function") throw new Error("作答记录存储尚未就绪");
  const token = randomBytes(32).toString("hex");
  const tokenPath = "/u/" + token;
  const server = http.createServer(createUploadHandler({ token, answerStore, onUploaded, getStudentId, studentName }));
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const actualPort = server.address().port;
  const addresses = getLanAddresses(networkInterfaces);
  const urls = addresses.map((address) => "http://" + address + ":" + actualPort + tokenPath);
  return {
    port: actualPort,
    localUrl: "http://127.0.0.1:" + actualPort + tokenPath,
    urls,
    enabled: true,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    })
  };
}

module.exports = { startMobileUploadServer, createUploadHandler, getLanAddresses, parseMultipart, MAX_FILES, MAX_FILE_BYTES, MAX_REQUEST_BYTES };
