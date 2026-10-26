const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

function collect(source, target, tag) {
  const version = tag.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid release version');
  fs.mkdirSync(target, { recursive: true });
  const metadata = new Map();
  const names = new Set();
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Symlink in artifacts');
      if (entry.isDirectory()) { walk(file); continue; }
      if (/^(latest|preview).*\.yml$/.test(entry.name)) {
        const info = yaml.load(fs.readFileSync(file, 'utf8'));
        if (info.version !== version || !Array.isArray(info.files)) throw new Error('Invalid updater metadata version');
        const previous = metadata.get(entry.name);
        if (previous) previous.files.push(...info.files);
        else metadata.set(entry.name, info);
        continue;
      }
      if (!/\.(dmg|zip|exe|AppImage|deb|blockmap)$/.test(entry.name)) continue;
      const key = entry.name.toLowerCase();
      if (names.has(key)) throw new Error('Duplicate asset: ' + entry.name);
      names.add(key);
      fs.copyFileSync(file, path.join(target, entry.name));
    }
  }
  walk(source);
  const base = 'exam2pdf-' + version;
  const required = ['-mac-arm64.dmg', '-mac-arm64.zip', '-mac-x64.dmg', '-mac-x64.zip', '-win-x64.exe', '-linux-x86_64.AppImage', '-linux-amd64.deb'].map(s => base + s);
  for (const file of required) if (!fs.existsSync(path.join(target, file))) throw new Error('Missing installer: ' + file);
  if ([...names].filter(n => !n.endsWith('.blockmap')).length !== required.length) throw new Error('Unexpected installer set');
  // GitHub builds use latest metadata even for prereleases; preserve the builder's channel.
  const channel = metadata.has('latest.yml') ? 'latest' : (version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest');
  for (const name of [channel + '.yml', channel + '-mac.yml', channel + '-linux.yml']) if (!metadata.has(name)) throw new Error('Missing update metadata: ' + name);
  for (const [name, info] of metadata) {
    const urls = new Set();
    for (const file of info.files) {
      if (typeof file.url !== 'string' || path.basename(file.url) !== file.url || urls.has(file.url)) throw new Error('Invalid update asset URL');
      urls.add(file.url);
      const bytes = fs.readFileSync(path.join(target, file.url));
      if (file.sha512 !== crypto.createHash('sha512').update(bytes).digest('base64') || file.size !== bytes.length) throw new Error('Update asset checksum mismatch');
    }
    fs.writeFileSync(path.join(target, name), yaml.dump(info));
  }
  const checksums = fs.readdirSync(target).sort().filter(n => n !== 'SHA256SUMS').map(name => crypto.createHash('sha256').update(fs.readFileSync(path.join(target, name))).digest('hex') + '  ' + name);
  fs.writeFileSync(path.join(target, 'SHA256SUMS'), checksums.join('\n') + '\n');
  return fs.readdirSync(target);
}
if (require.main === module) collect(...process.argv.slice(2));
module.exports = { collect };
