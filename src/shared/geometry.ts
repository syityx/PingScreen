import { ACTIONS, type Point, type Rect, type Target, type WheelAction } from './types';
export const WHEEL_RADIUS = 116;
export const DEAD_ZONE = 33;
export function answerCardSize(workArea: { width: number; height: number }, contentHeight = 160, previousHeight = 160): { width: number; height: number } {
  const width = Math.floor(Math.min(640, workArea.width));
  const maximum = Math.floor(Math.min(width, workArea.height));
  return { width, height: Math.min(maximum, Math.ceil(Math.max(160, contentHeight, previousHeight))) };
}
export function answerCardBounds(workArea: Rect, position: Point, contentHeight = 160, previousHeight = 160): Rect {
  const size = answerCardSize(workArea, contentHeight, previousHeight);
  return { ...size,
    x: Math.round(Math.max(workArea.x, Math.min(workArea.x + workArea.width - size.width, position.x))),
    y: Math.round(Math.max(workArea.y, Math.min(workArea.y + workArea.height - size.height, position.y))),
  };
}
export function pickAction(cursor: Point, center: Point, slots: 4 | 5): WheelAction | null {
  const dx = cursor.x - center.x, dy = cursor.y - center.y;
  if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
  const step = 2 * Math.PI / slots;
  const angle = ((Math.atan2(dy, dx) + Math.PI / 2 + step / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return ACTIONS[Math.floor(angle / step)] ?? null;
}
export function pickGestureAction(cursor: Point, origin: Point, center: Point, slots: 4 | 5): WheelAction | null {
  // A clamped visual wheel must still cancel when the user returns to the original target.
  if (Math.hypot(cursor.x - origin.x, cursor.y - origin.y) < DEAD_ZONE) return null;
  return pickAction(cursor, center, slots);
}
export function wheelCenter(p: Point, bounds: { width: number; height: number }): Point {
  const margin = WHEEL_RADIUS + 12;
  return { x: Math.max(Math.min(margin, bounds.width / 2), Math.min(bounds.width - margin, p.x)), y: Math.max(Math.min(margin, bounds.height / 2), Math.min(bounds.height - margin, p.y)) };
}
export function rectBetween(a: Point, b: Point, width: number, height: number): Rect {
  const x1 = Math.max(0, Math.min(width, a.x)), x2 = Math.max(0, Math.min(width, b.x));
  const y1 = Math.max(0, Math.min(height, a.y)), y2 = Math.max(0, Math.min(height, b.y));
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
export function toPixels(t: Target, dip: { width: number; height: number }, image: { width: number; height: number }): Target {
  const point = (p: Point) => ({ x: Math.max(0, Math.min(image.width - 1, Math.round(p.x * image.width / dip.width))), y: Math.max(0, Math.min(image.height - 1, Math.round(p.y * image.height / dip.height))) });
  if (t.kind === 'point') return { kind: 'point', point: point(t.point) };
  const a = point(t.rect);
  const right = Math.min(image.width, Math.round((t.rect.x + t.rect.width) * image.width / dip.width));
  const bottom = Math.min(image.height, Math.round((t.rect.y + t.rect.height) * image.height / dip.height));
  return { kind: 'region', rect: { ...a, width: Math.max(1, right - a.x), height: Math.max(1, bottom - a.y) } };
}
