import { getDocument, GlobalWorkerOptions } from '../node_modules/pdfjs-dist/build/pdf.mjs';
GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
const resources = new URL('../node_modules/pdfjs-dist/', import.meta.url).href;

// This document has no Node.js privileges, no network access, and never executes PDF actions.
window.renderLocalPdf = async (encoded) => {
  const binary = atob(encoded);
  const data = Uint8Array.from(binary, character => character.charCodeAt(0));
  const task = getDocument({ data, isEvalSupported: false, enableXfa: false, stopAtErrors: true,
    cMapUrl: resources + 'cmaps/', cMapPacked: true, standardFontDataUrl: resources + 'standard_fonts/',
    wasmUrl: resources + 'wasm/', iccUrl: resources + 'iccs/', useSystemFonts: true });
  let document;
  try {
    document = await task.promise;
    if (document.numPages > 24) throw new Error('一份作答记录最多 24 页，请拆分 PDF 后再导入');
    if (!document.numPages) throw new Error('PDF 中没有可导入的页面');
    const pages = [];
    let totalBytes = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const longest = Math.max(original.width, original.height);
      if (!Number.isFinite(longest) || longest <= 0) throw new Error('PDF 页面尺寸无效');
      const viewport = page.getViewport({ scale: Math.min(2200 / longest, 3) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      try {
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: 'rgb(255,255,255)' }).promise;
        const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
        const bytes = Math.floor(base64.length * 3 / 4);
        if (bytes > 16 * 1024 * 1024) throw new Error('PDF 第 ' + number + ' 页转换后超过 16 MB');
        totalBytes += bytes;
        if (totalBytes > 80 * 1024 * 1024) throw new Error('转换后的 PDF 页面合计超过 80 MB');
        pages.push({ name: 'PDF 第 ' + number + ' 页', mime: 'image/jpeg', base64, width: canvas.width, height: canvas.height });
      } finally {
        canvas.width = canvas.height = 0;
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await task.destroy();
  }
};
