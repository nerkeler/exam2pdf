(function (global) {
  "use strict";

  function jpegSize(u8) {
    if (!u8 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const marker = u8[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8] };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
      i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
    }
    return null;
  }

  async function ensureJpeg(bytes, mime) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      const size = jpegSize(bytes);
      if (size) return { bytes, w: size.w, h: size.h };
    }
    const blob = new Blob([bytes], { type: mime || "image/png" });
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement("canvas");
    cv.width = bmp.width;
    cv.height = bmp.height;
    cv.getContext("2d").drawImage(bmp, 0, 0);
    const dataUrl = cv.toDataURL("image/jpeg", 0.95);
    const bin = atob(dataUrl.split(",")[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const w = bmp.width, h = bmp.height;
    if (bmp.close) bmp.close();
    return { bytes: u8, w, h };
  }

  async function build(pages) {
    const enc = new TextEncoder();
    const parts = [];
    let offset = 0;
    const offs = {};
    const push = function (x) {
      const u = typeof x === "string" ? enc.encode(x) : x;
      parts.push(u);
      offset += u.length;
    };
    const n = pages.length;
    push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
    offs[1] = offset;
    push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offs[2] = offset;
    const kids = pages.map(function (_, i) { return (3 + i * 3) + " 0 R"; }).join(" ");
    push("2 0 obj\n<< /Type /Pages /Kids [" + kids + "] /Count " + n + " >>\nendobj\n");
    pages.forEach(function (p, i) {
      const pageNo = 3 + i * 3, contentNo = pageNo + 1, imgNo = pageNo + 2;
      const content = "q\n" + p.w + " 0 0 " + p.h + " 0 0 cm\n/Im0 Do\nQ";
      const contentU8 = enc.encode(content);
      offs[pageNo] = offset;
      push(pageNo + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + p.w + " " + p.h + "] /Resources << /XObject << /Im0 " + imgNo + " 0 R >> /ProcSet [/PDF /ImageC] >> /Contents " + contentNo + " 0 R >>\nendobj\n");
      offs[contentNo] = offset;
      push(contentNo + " 0 obj\n<< /Length " + contentU8.length + " >>\nstream\n");
      push(contentU8);
      push("\nendstream\nendobj\n");
      offs[imgNo] = offset;
      push(imgNo + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.bytes.length + " >>\nstream\n");
      push(p.bytes);
      push("\nendstream\nendobj\n");
    });
    const xrefStart = offset;
    let xref = "xref\n0 " + (3 + n * 3) + "\n0000000000 65535 f \n";
    for (let o = 1; o < 3 + n * 3; o++) xref += String(offs[o]).padStart(10, "0") + " 00000 n \n";
    push(xref);
    push("trailer\n<< /Size " + (3 + n * 3) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n");
    return new Blob(parts, { type: "application/pdf" });
  }

  global.MiniPDF = { build, ensureJpeg, jpegSize };
})(typeof window !== "undefined" ? window : this);
