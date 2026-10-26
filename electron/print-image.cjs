// 打印/PDF 导出前的页面图像处理：裁边、纠偏、方向修正、压缩。
// 纯函数部分（裁切边界、倾角估计、位图旋转、EXIF 读取）在普通 Node 下可测试；
// processPrintImage 依赖 Electron nativeImage，懒加载避免影响测试。

const zlib = require("node:zlib");

const PRINT_MAX_SIDE = 2200;
const PRINT_JPEG_QUALITY = 80;
const TRIM_TOLERANCE = 30;
const TRIM_PADDING = 8;
const DESKEW_MIN_ANGLE = 0.4;
const DESKEW_MAX_ANGLE = 8;

function channelOffsets(layout) {
  return layout === "bgra" ? { r: 2, g: 1, b: 0 } : { r: 0, g: 1, b: 2 };
}

// 以四角 8×8 均色为背景，找内容包围盒；内容过小或满幅时返回 null（不裁）
function computeTrimBounds(data, width, height, layout = "bgra", options = {}) {
  const tolerance = options.tolerance ?? TRIM_TOLERANCE;
  const padding = options.padding ?? TRIM_PADDING;
  const minAreaRatio = options.minAreaRatio ?? 0.12;
  if (width < 24 || height < 24) return null;
  const off = channelOffsets(layout);
  const blockAvg = (bx, by) => {
    const x0 = Math.min(bx, width - 8), y0 = Math.min(by, height - 8);
    let r = 0, g = 0, b = 0;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = x0; x < x0 + 8; x++) {
        const p = (y * width + x) * 4;
        r += data[p + off.r]; g += data[p + off.g]; b += data[p + off.b];
      }
    }
    return [r / 64, g / 64, b / 64];
  };
  const bg = [0, 1, 2].map((c) => (
    [blockAvg(0, 0), blockAvg(width - 8, 0), blockAvg(0, height - 8), blockAvg(width - 8, height - 8)]
      .reduce((sum, corner) => sum + corner[c], 0) / 4
  ));
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const p = row + x * 4;
      const dr = data[p + off.r] - bg[0], dg = data[p + off.g] - bg[1], db = data[p + off.b] - bg[2];
      if (dr * dr + dg * dg + db * db > tolerance * tolerance) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const contentW = maxX - minX + 1, contentH = maxY - minY + 1;
  if (contentW * contentH < width * height * minAreaRatio) return null;
  if (contentW >= width - 2 && contentH >= height - 2) return null;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  return {
    x,
    y,
    width: Math.min(width - x, maxX - x + 1 + padding),
    height: Math.min(height - y, maxY - y + 1 + padding)
  };
}

function cropBitmap(data, width, height, rect) {
  const out = Buffer.alloc(rect.width * rect.height * 4);
  const bytesPerRow = width * 4;
  for (let y = 0; y < rect.height; y++) {
    const srcStart = (y + rect.y) * bytesPerRow + rect.x * 4;
    data.copy(out, y * rect.width * 4, srcStart, srcStart + rect.width * 4);
  }
  return { data: out, width: rect.width, height: rect.height };
}

// 文字行投影剖面法估倾角：加权暗像素按 tan(角) 剪切累加，剖面方差最大者为最优角。
// 正角度表示内容行向右下倾斜。
function estimateSkewAngle(data, width, height, layout = "bgra", options = {}) {
  const step = options.step ?? 3;
  const maxAngle = options.maxAngle ?? DESKEW_MAX_ANGLE;
  if (width < 100 || height < 100) return 0;
  const off = channelOffsets(layout);
  const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
  const weights = new Uint8Array(rows * cols);
  // 每个采样格取最暗像素：保证 1px 细线/笔画不会被采样网格漏掉
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      let darkest = 255;
      for (let dy = 0; dy < step; dy++) {
        const y = Math.min(height - 1, gy * step + dy);
        for (let dx = 0; dx < step; dx++) {
          const p = (y * width + Math.min(width - 1, gx * step + dx)) * 4;
          const bright = (data[p + off.r] + data[p + off.g] + data[p + off.b]) / 3;
          if (bright < darkest) darkest = bright;
        }
      }
      weights[gy * cols + gx] = darkest < 200 ? Math.min(255, 210 - darkest) : 0;
    }
  }
  const shearRows = Math.ceil(Math.abs(Math.tan(maxAngle * Math.PI / 180)) * cols) + 1;
  let bestAngle = 0, bestScore = 0;
  for (let tenths = -maxAngle * 2; tenths <= maxAngle * 2; tenths++) {
    const angleDeg = tenths / 2;
    const t = Math.tan(angleDeg * Math.PI / 180);
    const profile = new Float64Array(rows + shearRows);
    const offset = Math.ceil(shearRows / 2);
    for (let gy = 0; gy < rows; gy++) {
      const rowBase = gy * cols;
      for (let gx = 0; gx < cols; gx++) {
        const w = weights[rowBase + gx];
        if (!w) continue;
        profile[Math.round(gy + t * (gx - cols / 2)) + offset] += w;
      }
    }
    let mean = 0;
    for (let i = 0; i < profile.length; i++) mean += profile[i];
    mean /= profile.length;
    let variance = 0;
    for (let i = 0; i < profile.length; i++) { const d = profile[i] - mean; variance += d * d; }
    if (variance > bestScore) { bestScore = variance; bestAngle = angleDeg; }
  }
  return bestAngle;
}

// 双线性逆映射旋转；正角度 = 顺时针（屏幕坐标）。90/180 度走精确快速路径。
function rotateBitmap(data, width, height, angleDeg, layout = "bgra") {
  const angle = ((angleDeg % 360) + 360) % 360;
  if (angle === 90 || angle === 180 || angle === 270) {
    const outW = angle === 180 ? width : height;
    const outH = angle === 180 ? height : width;
    const out = Buffer.alloc(outW * outH * 4);
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        let sx, sy;
        if (angle === 90) { sx = oy; sy = height - 1 - ox; }
        else if (angle === 180) { sx = width - 1 - ox; sy = height - 1 - oy; }
        else { sx = width - 1 - oy; sy = ox; }
        const src = (sy * width + sx) * 4;
        const dst = (oy * outW + ox) * 4;
        out[dst] = data[src];
        out[dst + 1] = data[src + 1];
        out[dst + 2] = data[src + 2];
        out[dst + 3] = data[src + 3];
      }
    }
    return { data: out, width: outW, height: outH };
  }
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const outW = Math.ceil(Math.abs(width * cos) + Math.abs(height * sin));
  const outH = Math.ceil(Math.abs(width * sin) + Math.abs(height * cos));
  const out = Buffer.alloc(outW * outH * 4);
  const off = channelOffsets(layout);
  const cx = width / 2, cy = height / 2, ocx = outW / 2, ocy = outH / 2;
  const channels = [off.r, off.g, off.b, 3];
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const u = ox + 0.5 - ocx, v = oy + 0.5 - ocy;
      const sx = u * cos + v * sin + cx;
      const sy = -u * sin + v * cos + cy;
      const o = (oy * outW + ox) * 4;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const x0 = Math.min(width - 1, Math.floor(sx)), y0 = Math.min(height - 1, Math.floor(sy));
      const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      for (const c of channels) {
        const p00 = (y0 * width + x0) * 4 + c, p10 = (y0 * width + x1) * 4 + c;
        const p01 = (y1 * width + x0) * 4 + c, p11 = (y1 * width + x1) * 4 + c;
        const top = data[p00] + (data[p10] - data[p00]) * fx;
        const bottom = data[p01] + (data[p11] - data[p01]) * fx;
        out[o + c] = Math.round(top + (bottom - top) * fy);
      }
    }
  }
  return { data: out, width: outW, height: outH };
}

// 纠偏后从四边向内扫描亮色纸张边界（中间 60% 区域 ≥60% 像素偏亮视为纸张）。
// 适用于"深色桌面 + 白纸"的拍照场景；白底扫描件整页皆亮，返回 null 不裁。
function computePaperBounds(data, width, height, layout = "bgra", options = {}) {
  const off = channelOffsets(layout);
  const brightThreshold = options.brightThreshold ?? 200;
  const ratio = options.ratio ?? 0.6;
  const padding = options.padding ?? 4;
  const minSize = 200;
  if (width < minSize || height < minSize) return null;
  const brightness = (x, y) => {
    const p = (y * width + x) * 4;
    return (data[p + off.r] + data[p + off.g] + data[p + off.b]) / 3;
  };
  const rowBright = (y) => {
    let bright = 0, total = 0;
    for (let x = Math.floor(width * 0.2); x < width * 0.8; x += 3) { total++; if (brightness(x, y) >= brightThreshold) bright++; }
    return total && bright / total >= ratio;
  };
  const colBright = (x) => {
    let bright = 0, total = 0;
    for (let y = Math.floor(height * 0.2); y < height * 0.8; y += 3) { total++; if (brightness(x, y) >= brightThreshold) bright++; }
    return total && bright / total >= ratio;
  };
  const scanFrom = (fromStart, total, isReady) => {
    const dir = fromStart ? 1 : -1;
    let found = -1, run = 0;
    for (let i = 0; i < total; i++) {
      const index = fromStart ? i : total - 1 - i;
      run = isReady(index) ? run + 1 : 0;
      if (run >= 5) { found = fromStart ? index - 4 : index + 4; break; }
    }
    return found;
  };
  const top = scanFrom(true, height, rowBright);
  const bottom = scanFrom(false, height, rowBright);
  const left = scanFrom(true, width, colBright);
  const right = scanFrom(false, width, colBright);
  if (top < 0 || bottom < 0 || left < 0 || right < 0 || bottom - top < minSize || right - left < minSize) return null;
  const x = Math.max(0, left - padding);
  const y = Math.max(0, top - padding);
  return {
    x,
    y,
    width: Math.min(width - x, right + 1 + padding - x),
    height: Math.min(height - y, bottom + 1 + padding - y)
  };
}

// nativeImage 位图是预乘 alpha；透明像素合成到白底（out = p + 255 - a）
function flattenAlpha(data, layout = "bgra") {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) { hasAlpha = true; break; }
  }
  if (!hasAlpha) return false;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
      continue;
    }
    data[i] = Math.min(255, data[i] + 255 - a);
    data[i + 1] = Math.min(255, data[i + 1] + 255 - a);
    data[i + 2] = Math.min(255, data[i + 2] + 255 - a);
    data[i + 3] = 255;
  }
  return true;
}

// 最小实现：读取 JPEG APP1/Exif 的方向标记（1~8），无则 1
function parseTiffOrientation(tiff) {
  if (tiff.length < 8) return 1;
  const little = tiff[0] === 0x49;
  const read16 = (o) => little ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1];
  const read32 = (o) => little
    ? tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16) | (tiff[o + 3] << 24)
    : (tiff[o] << 24) | (tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3];
  if (read16(2) !== 42) return 1;
  const ifdOffset = read32(4);
  if (ifdOffset + 2 > tiff.length) return 1;
  const count = read16(ifdOffset);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (read16(entry) === 0x0112) return read16(entry + 8) || 1;
  }
  return 1;
}

function jpegOrientation(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) { offset++; continue; }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
    if (marker === 0xda) break;
    const size = (buffer[offset + 2] << 8) | buffer[offset + 3];
    if (size < 2) break;
    if (marker === 0xe1) {
      const segment = buffer.subarray(offset + 4, Math.min(buffer.length, offset + 2 + size));
      if (segment.length > 10 && segment.toString("latin1", 0, 4) === "Exif") {
        return parseTiffOrientation(segment.subarray(6));
      }
    }
    offset += 2 + size;
  }
  return 1;
}

// 供运行期探测位图通道序使用：构造 1×1 纯色 PNG
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function createPngPixel(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const raw = Buffer.from([0, r, g, b]);  // filter 0 + 像素
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

let bitmapLayoutCache = null;
function detectBitmapLayout(nativeImage) {
  if (bitmapLayoutCache) return bitmapLayoutCache;
  try {
    const probe = nativeImage.createFromBuffer(createPngPixel(255, 64, 0));
    const bitmap = probe.isEmpty() ? null : probe.toBitmap();
    bitmapLayoutCache = bitmap && bitmap[2] === 255 ? "bgra" : "rgba";
  } catch {
    bitmapLayoutCache = "bgra";
  }
  return bitmapLayoutCache;
}

// 出口管线：EXIF 方向 → 裁边 → 纠偏 → 拍平透明 → 缩放 → JPEG。
// 返回 null 表示不适合处理（webp/小图/收益不足/任何失败），调用方保留原图。
function processPrintImage(sourceBytes, mime, options = {}) {
  const opts = { maxSide: PRINT_MAX_SIDE, quality: PRINT_JPEG_QUALITY, trim: true, deskew: true, ...options };
  try {
    if (mime === "image/webp") return null;
    if (sourceBytes.length < 200 * 1024) return null;
    const { nativeImage } = require("electron");
    const layout = detectBitmapLayout(nativeImage);
    const img = nativeImage.createFromBuffer(sourceBytes);
    if (img.isEmpty()) return null;
    let { width, height } = img.getSize();
    let bitmap = Buffer.from(img.toBitmap());
    if (mime === "image/jpeg") {
      // 方向 2/4/5/7 含镜像，此处按对应旋转近似处理
      const angle = { 3: 180, 6: 90, 8: -90, 2: 180, 4: 180, 5: -90, 7: 90 }[jpegOrientation(sourceBytes)] || 0;
      if (angle) {
        const rotated = rotateBitmap(bitmap, width, height, angle, layout);
        bitmap = rotated.data;
        width = rotated.width;
        height = rotated.height;
      }
    }
    if (opts.trim) {
      const bounds = computeTrimBounds(bitmap, width, height, layout);
      if (bounds) {
        const cropped = cropBitmap(bitmap, width, height, bounds);
        bitmap = cropped.data;
        width = cropped.width;
        height = cropped.height;
      }
    }
    if (opts.deskew && width >= 100 && height >= 100) {
      const angle = estimateSkewAngle(bitmap, width, height, layout);
      if (Math.abs(angle) >= DESKEW_MIN_ANGLE) {
        const rotated = rotateBitmap(bitmap, width, height, angle, layout);
        bitmap = rotated.data;
        width = rotated.width;
        height = rotated.height;
        // 旋转后按亮色纸张边界收紧裁切（在拍平前扫描：透明角点读作暗色被跳过）
        if (opts.trim) {
          const paperBounds = computePaperBounds(bitmap, width, height, layout);
          if (paperBounds) {
            const cropped = cropBitmap(bitmap, width, height, paperBounds);
            bitmap = cropped.data;
            width = cropped.width;
            height = cropped.height;
          }
        }
      }
    }
    flattenAlpha(bitmap, layout);
    let out = nativeImage.createFromBitmap(bitmap, { width, height });
    if (out.isEmpty()) return null;
    const longest = Math.max(width, height);
    if (longest > opts.maxSide) {
      const scale = opts.maxSide / longest;
      out = out.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
    }
    const finalSize = out.getSize();
    const jpeg = out.toJPEG(opts.quality);
    if (!jpeg.length || jpeg.length >= sourceBytes.length * 0.85) return null;
    return { data: jpeg, mime: "image/jpeg", width: finalSize.width, height: finalSize.height };
  } catch {
    return null;
  }
}

module.exports = {
  PRINT_MAX_SIDE,
  PRINT_JPEG_QUALITY,
  computeTrimBounds,
  computePaperBounds,
  cropBitmap,
  estimateSkewAngle,
  rotateBitmap,
  flattenAlpha,
  jpegOrientation,
  parseTiffOrientation,
  createPngPixel,
  processPrintImage
};
