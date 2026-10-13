import type { TranslationMode } from './types';
/** Accumulate precision-wheel deltas; each full notch flips the prompt scope. */
export function scrollTranslation(mode: TranslationMode, remainder: number, delta: number): { mode: TranslationMode; remainder: number } {
  const total = remainder + delta, notches = Math.trunc(total / 120);
  return { mode: Math.abs(notches) % 2 ? mode === 'point' ? 'line' : 'point' : mode, remainder: total - notches * 120 };
}
