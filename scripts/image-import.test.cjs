const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('answer photo compression draws the live bitmap before releasing it', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/原型图.html'), 'utf8');
  const start = html.indexOf('    async function importImage(');
  const end = html.indexOf('\n    async function ', start + 1);
  const source = html.slice(start, end);
  let closed = false, drawn = false;
  const bitmap = { width: 4400, height: 3300, close() { closed = true; } };
  const canvas = { getContext: () => ({ fillRect() {}, drawImage() { assert.equal(closed, false); drawn = true; } }), toBlob: callback => callback({ size: 3, arrayBuffer: async () => new ArrayBuffer(3) }) };
  const context = vm.createContext({ createImageBitmap: async () => bitmap, document: { createElement: () => canvas }, bufferToBase64: () => 'YWJj', Uint8Array, Blob, console });
  vm.runInContext(source + '\nthis.runImport = importImage;', context);
  const page = await context.runImport({ name: 'answer.png', type: 'image/png', size: 7000000 }, { kind: 'answer' });
  assert.equal(drawn, true); assert.equal(closed, true);
  assert.equal(page.width, 2200); assert.equal(page.height, 1650);
});
