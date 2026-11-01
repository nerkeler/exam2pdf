function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safePdfFileName(value) {
  const cleaned = String(value || "试卷").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100);
  return (cleaned || "试卷") + ".pdf";
}

// A4 纸去掉上下左右 8mm 页边距后的内容区（96dpi 像素），旋转页按可视方向适配
const SHEET_CONTENT_W = Math.round(194 / 25.4 * 96);
const SHEET_CONTENT_H = Math.round(281 / 25.4 * 96);

function sheetImageLayout(image) {
  const width = Number(image.width) || 1;
  const height = Number(image.height) || 1;
  const rot = ((Number(image.rotation) || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const visualW = swap ? height : width;
  const visualH = swap ? width : height;
  const boxW = swap ? SHEET_CONTENT_H : SHEET_CONTENT_W;
  const boxH = swap ? SHEET_CONTENT_W : SHEET_CONTENT_H;
  const scale = Math.min(boxW / visualW, boxH / visualH, 1);
  const layoutW = Math.max(1, Math.round(width * scale));
  const layoutH = Math.max(1, Math.round(height * scale));
  return {
    landscape: visualW > visualH,
    style: rot ? "width:" + layoutW + "px;height:" + layoutH + "px;transform:rotate(" + rot + "deg)" : ""
  };
}

function createPrintHtml(title, pages) {
  const pageHtml = pages.map((image, index) => {
    const layout = sheetImageLayout(image);
    const direction = layout.landscape ? "landscape" : "portrait";
    return '<section class="sheet ' + direction + '"><img src="' + escapeHtml(image.url) + '" alt="第 ' + (index + 1) + ' 页"' + (layout.style ? ' style="' + layout.style + '"' : "") + "></section>";
  }).join("");
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' +
    '@page portrait{size:A4 portrait;margin:0}@page landscape{size:A4 landscape;margin:0}*{box-sizing:border-box}' +
    'html,body{margin:0;padding:0;background:#fff}.sheet{page-break-after:always;break-after:page;display:flex;align-items:center;justify-content:center;width:210mm;height:297mm;padding:8mm;overflow:hidden}' +
    '.sheet.landscape{page:landscape;width:297mm;height:210mm}.sheet.portrait{page:portrait}.sheet:last-child{page-break-after:auto;break-after:auto}' +
    'img{display:block;max-width:100%;max-height:100%;object-fit:contain}@media screen{body{background:#e7e9ed}.sheet{margin:16px auto;background:#fff;box-shadow:0 2px 18px #0002}.sheet.landscape{width:min(1120px,calc(100vw - 32px));height:min(790px,calc((100vw - 32px)*.707))}.sheet.portrait{width:min(790px,calc(100vw - 32px));height:min(1120px,calc((100vw - 32px)*1.414))}}</style></head><body>' + pageHtml + '</body></html>';
}

module.exports = { createPrintHtml, safePdfFileName, sheetImageLayout };
