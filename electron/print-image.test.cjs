const test = require("node:test");
const assert = require("node:assert/strict");
const {
  computeTrimBounds, estimateSkewAngle, rotateBitmap, jpegOrientation, createPngPixel
} = require("./print-image.cjs");

function makeWhite(width, height) {
  return Buffer.alloc(width * height * 4, 255);  // 白色在 RGBA/BGRA 下字节相同
}

function fillRect(data, width, height, x0, y0, x1, y1, rgb, layout = "rgba") {
  const off = layout === "bgra" ? { r: 2, g: 1, b: 0 } : { r: 0, g: 1, b: 2 };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * width + x) * 4;
      data[p + off.r] = rgb[0];
      data[p + off.g] = rgb[1];
      data[p + off.b] = rgb[2];
      data[p + 3] = 255;
    }
  }
}

function drawDescendingLine(width, height, slope) {
  const data = makeWhite(width, height);
  fillRect(data, width, height, 0, 0, width - 1, height - 1, [255, 255, 255]);
  for (let x = 0; x < width; x++) {
    const y = Math.round(50 + x * slope);
    if (y >= 0 && y < height) fillRect(data, width, height, x, y, x, y, [0, 0, 0]);
  }
  return data;
}

test("computes the content bounds inside a uniform border with padding", () => {
  const w = 100, h = 140;
  const data = makeWhite(w, h);
  fillRect(data, w, h, 20, 30, 79, 109, [200, 30, 30]);
  const bounds = computeTrimBounds(data, w, h, "rgba", { padding: 8 });
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [12, 22, 76, 96]);
});

test("works in bgra layout as well", () => {
  const w = 80, h = 80;
  const data = makeWhite(w, h);
  fillRect(data, w, h, 10, 10, 69, 69, [30, 30, 200], "bgra");
  const bounds = computeTrimBounds(data, w, h, "bgra", { padding: 4 });
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [6, 6, 68, 68]);
});

test("leaves full-bleed or tiny-content images untrimmed", () => {
  const w = 100, h = 100;
  const full = makeWhite(w, h);
  fillRect(full, w, h, 0, 0, 99, 99, [10, 10, 10]);
  assert.equal(computeTrimBounds(full, w, h, "rgba"), null);
  const tiny = makeWhite(w, h);
  fillRect(tiny, w, h, 48, 48, 51, 51, [10, 10, 10]);
  assert.equal(computeTrimBounds(tiny, w, h, "rgba"), null);
});

test("detects horizontal text lines as zero tilt and tilted lines at their angle", () => {
  const flat = drawDescendingLine(600, 400, 0);
  assert.ok(Math.abs(estimateSkewAngle(flat, 600, 400, "rgba")) < 0.4);
  // 约定：返回值是"纠偏角"——视觉上向右下倾斜 3° 的行，纠偏角为 -3（逆时针转回）
  const tilted = drawDescendingLine(600, 400, Math.tan(3 * Math.PI / 180));
  const angle = estimateSkewAngle(tilted, 600, 400, "rgba");
  assert.ok(Math.abs(angle + 3) <= 0.75, "angle = " + angle);
});

test("straightens a tilted line by rotating by the detected correction angle", () => {
  const w = 600, h = 400;
  const tilted = drawDescendingLine(w, h, Math.tan(3 * Math.PI / 180));
  const angle = estimateSkewAngle(tilted, w, h, "rgba");
  assert.ok(Math.abs(angle) > 0.5, "angle = " + angle);
  const fixed = rotateBitmap(tilted, w, h, angle, "rgba");
  const residual = estimateSkewAngle(fixed.data, fixed.width, fixed.height, "rgba");
  assert.ok(Math.abs(residual) < 0.6, "residual = " + residual);
});

test("rotates bitmaps losslessly for right angles", () => {
  const w = 3, h = 2;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      data[p] = x + 1; data[p + 1] = y + 1; data[p + 2] = 0; data[p + 3] = 255;
    }
  }
  const rotated = rotateBitmap(data, w, h, 90, "rgba");
  assert.equal(rotated.width, 2);
  assert.equal(rotated.height, 3);
  const pixels = [];
  for (let y = 0; y < rotated.height; y++) {
    for (let x = 0; x < rotated.width; x++) {
      const p = (y * rotated.width + x) * 4;
      if (rotated.data[p + 3] === 255) pixels.push([rotated.data[p], rotated.data[p + 1]]);
    }
  }
  pixels.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(pixels, [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2]]);
});

test("reads the EXIF orientation from a minimal JPEG", () => {
  function tiffWithOrientation(value) {
    const tiff = Buffer.alloc(26);
    tiff.write("II", 0, "latin1");
    tiff[2] = 42;
    tiff.writeUInt32LE(8, 4);
    tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10);
    tiff.writeUInt16LE(3, 12);
    tiff.writeUInt32LE(1, 14);
    tiff.writeUInt16LE(value, 18);
    tiff.writeUInt16LE(0, 20);
    tiff.writeUInt32LE(0, 22);
    const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const app1 = Buffer.alloc(4 + payload.length);
    app1[0] = 0xff; app1[1] = 0xe1;
    app1.writeUInt16BE(payload.length + 2, 2);
    payload.copy(app1, 4);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
  }
  assert.equal(jpegOrientation(tiffWithOrientation(6)), 6);
  assert.equal(jpegOrientation(tiffWithOrientation(1)), 1);
  assert.equal(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), 1);
  assert.equal(jpegOrientation(Buffer.alloc(0)), 1);
});

test("builds a valid single-pixel PNG used for the bitmap layout probe", () => {
  const png = createPngPixel(255, 64, 0);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png.toString("latin1", png.length - 8, png.length - 4), "IEND");
});
