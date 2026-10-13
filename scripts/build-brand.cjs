// Format the approved transparent PNG without recoloring or redrawing it.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
async function main() {
  const source = path.join(root, 'docs', 'design', 'brand', 'logo-source.png');
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  // Ignore nearly transparent export noise when measuring the outside margin.
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 16) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error('Logo artwork is empty');
  left = Math.max(0, left - 4); top = Math.max(0, top - 4);
  right = Math.min(info.width - 1, right + 4); bottom = Math.min(info.height - 1, bottom + 4);
  const logo = await sharp(source).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
  const assets = path.join(root, 'src', 'renderer', 'assets', 'brand');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'logo.png'), logo);
  const square = size => sharp(logo).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await square(512));
  fs.writeFileSync(path.join(root, 'build', 'tray.png'), await square(32));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(square));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    const entry = 6 + i * 16;
    directory[entry] = directory[entry + 1] = sizes[i] === 256 ? 0 : sizes[i];
    directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([directory, ...images]));
  console.log('Approved logo formatted: renderer PNG, 512px app icon, 32px tray icon, nine Windows ICO sizes.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
