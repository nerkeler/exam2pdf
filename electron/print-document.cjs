function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function safePdfFileName(value) {
  const cleaned = String(value || "试卷").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().slice(0, 100);
  return (cleaned || "试卷") + ".pdf";
}

function createPrintHtml(title, pages) {
  const pageHtml = pages.map((image, index) => {
    const direction = image.width > image.height ? "landscape" : "portrait";
    return '<section class="sheet ' + direction + '"><img src="' + escapeHtml(image.url) + '" alt="第 ' + (index + 1) + ' 页"></section>';
  }).join("");
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title><style>' +
    '@page portrait{size:A4 portrait;margin:0}@page landscape{size:A4 landscape;margin:0}*{box-sizing:border-box}' +
    'html,body{margin:0;padding:0;background:#fff}.sheet{page-break-after:always;break-after:page;display:flex;align-items:center;justify-content:center;width:210mm;height:297mm;padding:8mm;overflow:hidden}' +
    '.sheet.landscape{page:landscape;width:297mm;height:210mm}.sheet.portrait{page:portrait}.sheet:last-child{page-break-after:auto;break-after:auto}' +
    'img{display:block;max-width:100%;max-height:100%;object-fit:contain}@media screen{body{background:#e7e9ed}.sheet{margin:16px auto;background:#fff;box-shadow:0 2px 18px #0002}.sheet.landscape{width:min(1120px,calc(100vw - 32px));height:min(790px,calc((100vw - 32px)*.707))}.sheet.portrait{width:min(790px,calc(100vw - 32px));height:min(1120px,calc((100vw - 32px)*1.414))}}</style></head><body>' + pageHtml + '</body></html>';
}

module.exports = { createPrintHtml, safePdfFileName };
