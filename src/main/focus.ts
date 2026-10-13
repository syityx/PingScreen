import type { Rect, Target } from '../shared/types';
/** Additional native-resolution detail, while retaining the full screenshot. */
export function focusRect(target: Target, size: { width: number; height: number }): Rect {
  const area = target.kind === 'region' ? target.rect : { x: target.point.x - 320, y: target.point.y - 240, width: 640, height: 480 };
  const padding = target.kind === 'region' ? 24 : 0;
  const x = Math.max(0, Math.floor(area.x - padding)), y = Math.max(0, Math.floor(area.y - padding));
  const right = Math.min(size.width, Math.ceil(area.x + area.width + padding));
  const bottom = Math.min(size.height, Math.ceil(area.y + area.height + padding));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
