function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function createStartupErrorPage(error) {
  const message = error && error.message ? error.message : error;
  const detail = escapeHtml(message || "工作台启动失败");
  return "<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; style-src 'unsafe-inline'\"><title>家卷 启动失败</title><style>body{font:16px system-ui,sans-serif;margin:0;padding:48px 24px;background:#f6f7f9;color:#202733}main{max-width:760px;margin:auto;padding:28px;border:1px solid #dce2ec;border-radius:16px;background:white}h1{font-size:22px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#9b2534}</style><main><h1>家卷 没有加载成功</h1><p>请保存下面的错误信息，并检查应用文件及本机数据目录权限，然后重新启动。</p><pre>" + detail + "</pre></main></html>";
}

function createStartupErrorUrl(error) {
  return "data:text/html;charset=utf-8," + encodeURIComponent(createStartupErrorPage(error));
}

module.exports = { createStartupErrorPage, createStartupErrorUrl };
