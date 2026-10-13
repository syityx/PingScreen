const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const output = path.resolve(root, process.argv[2] || 'release');
const unpacked = path.join(output, 'win-unpacked');
const archive = path.join(unpacked, 'resources', 'app.asar');
const read = name => asar.extractFile(archive, name);
const metadata = JSON.parse(read('package.json').toString('utf8'));
assert.equal(metadata.version, pkg.version);
assert.equal(Object.hasOwn(metadata, 'demo'), false, 'Legacy build metadata must not be shipped');
assert.equal(pkg.build.appId, 'com.pingscreen.app');
for (const relative of ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html', 'build/icon.png', 'build/tray.png', 'LICENSE', 'THIRD_PARTY_LICENSES.txt']) {
  const name = path.join(...relative.split('/'));
  assert(read(name).equals(fs.readFileSync(path.join(root, name))), `Outdated ${relative}`);
}
const files = asar.listPackage(archive).map(name => name.slice(1));
for (const name of files.filter(name => name.startsWith(path.join('out', 'renderer', 'assets')) && /\.(css|js|png|svg|ico)$/.test(name))) {
  assert(read(name).equals(fs.readFileSync(path.join(root, name))), `Outdated renderer ${name}`);
}
assert(!files.some(name => /(?:^|[\\/])(?:\.tools|tests|docs|\.git|\.env[^\\/]*|settings\.json[^\\/]*)(?:[\\/]|$)/.test(name)), 'Private/local development files included');
for (const helper of ['hook-helper.exe', 'capture-helper.exe']) {
  assert(fs.readFileSync(path.join(unpacked, 'resources', helper)).equals(fs.readFileSync(path.join(root, 'native', 'hook-helper', 'build', helper))), `Outdated ${helper}`);
}
assert(fs.readFileSync(path.join(unpacked, '使用说明.txt')).equals(fs.readFileSync(path.join(root, 'docs', 'release-readme.txt'))));
assert(fs.statSync(path.join(unpacked, 'pingscreen.exe')).size > 0);
const installerName = `pingscreen-Setup-${pkg.version}.exe`;
const installer = path.join(output, installerName);
assert(fs.statSync(installer).size > 0);
const sevenZip = require('7zip-bin').path7za;
const integrity = spawnSync(sevenZip, ['t', installer], { encoding: 'utf8', windowsHide: true });
assert.equal(integrity.status, 0, integrity.error?.message || integrity.stderr || integrity.stdout);
const checksums = [installerName, `${installerName}.blockmap`].map(name => {
  const data = fs.readFileSync(path.join(output, name));
  assert(data.length > 0, `Empty ${name}`);
  return `${crypto.createHash('sha256').update(data).digest('hex')}  ${name}\n`;
}).join('');
fs.writeFileSync(path.join(output, `SHA256SUMS-${pkg.version}.txt`), checksums);
console.log(`Release ${pkg.version} verified: formal identity, current code/helpers, licenses, guide and installer integrity.`);
console.log('SHA-256 checksums written for installer and blockmap.');
