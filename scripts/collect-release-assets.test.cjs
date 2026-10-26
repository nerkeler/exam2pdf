const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { collect } = require('./collect-release-assets.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exam2pdf-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'in'); fs.mkdirSync(source);
  for (const [platform, suffixes, meta] of [
    ['arm', ['mac-arm64.dmg', 'mac-arm64.zip'], 'preview-mac.yml'],
    ['intel', ['mac-x64.dmg', 'mac-x64.zip'], 'preview-mac.yml'],
    ['win', ['win-x64.exe'], 'preview.yml'],
    ['linux', ['linux-x86_64.AppImage', 'linux-amd64.deb'], 'preview-linux.yml']
  ]) {
    const dir = path.join(source, platform); fs.mkdirSync(dir);
    const files = suffixes.map(suffix => {
      const url = 'exam2pdf-0.1.1-preview.1-' + suffix;
      const bytes = Buffer.from(url); fs.writeFileSync(path.join(dir, url), bytes);
      return { url, size: bytes.length, sha512: crypto.createHash('sha512').update(bytes).digest('base64') };
    });
    fs.writeFileSync(path.join(dir, meta), yaml.dump({ version: '0.1.1-preview.1', files, path: files[0].url, sha512: files[0].sha512 }));
  }
  return { source, target: path.join(root, 'out') };
}
test('release collector merges Mac architectures and checksums every installer and update manifest', t => {
  const { source, target } = fixture(t);
  collect(source, target, 'v0.1.1-preview.1');
  assert.equal(yaml.load(fs.readFileSync(path.join(target, 'preview-mac.yml'), 'utf8')).files.length, 4);
  assert.equal(fs.readFileSync(path.join(target, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 10);
});
test('release collector rejects missing platforms and tampered updater checksums', t => {
  const one = fixture(t);
  fs.rmSync(path.join(one.source, 'win', 'exam2pdf-0.1.1-preview.1-win-x64.exe'));
  assert.throws(() => collect(one.source, one.target, 'v0.1.1-preview.1'), /Missing installer/);
  const two = fixture(t);
  fs.appendFileSync(path.join(two.source, 'win', 'exam2pdf-0.1.1-preview.1-win-x64.exe'), 'tampered');
  assert.throws(() => collect(two.source, two.target, 'v0.1.1-preview.1'), /checksum mismatch/);
});
