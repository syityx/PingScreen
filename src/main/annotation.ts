import type { Target } from '../shared/types';
/** Electron's native bitmap uses BGRA. Draw an outline without hiding the target's centre. */
export function annotateBitmap(bitmap: Buffer, width: number, height: number, target: Target): Buffer {
  const data = Buffer.from(bitmap);
  const paint = (x: number, y: number, white = false) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    data[offset] = white ? 255 : 220; data[offset + 1] = white ? 255 : 210; data[offset + 2] = white ? 255 : 30; data[offset + 3] = 255;
  };
  if (target.kind === 'point') {
    const { x, y } = target.point;
    for (let dy = -15; dy <= 15; dy++) for (let dx = -15; dx <= 15; dx++) {
      const r = Math.hypot(dx, dy);
      if (r >= 11 && r <= 14) paint(x + dx, y + dy, r < 12 || r > 13);
    }
  } else {
    const r = target.rect, right = Math.min(width - 1, r.x + r.width), bottom = Math.min(height - 1, r.y + r.height);
    for (let line = 0; line < 3; line++) {
      for (let x = r.x; x <= right; x++) { paint(x, r.y + line, line === 0); paint(x, bottom - line, line === 0); }
      for (let y = r.y; y <= bottom; y++) { paint(r.x + line, y, line === 0); paint(right - line, y, line === 0); }
    }
  }
  return data;
}
