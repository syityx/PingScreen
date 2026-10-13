import type { Settings } from './types';
export type WheelKind = 'ping' | 'emote';
export type HelperEvent =
  | { type: 'ready'; version: number }
  | { type: 'wheelOpen' | 'wheelMove' | 'wheelRelease' | 'click'; x: number; y: number; wheel: WheelKind }
  | { type: 'wheelScroll'; x: number; y: number; wheel: WheelKind; delta: number }
  | { type: 'cancel' } | { type: 'toggled'; enabled: boolean }
  | { type: 'error'; message: string; code?: string } | { type: 'sim'; swallow: boolean; inject: string };
export type HelperStatus = 'starting' | 'running' | 'failed' | 'noAccess';
export const HELPER_EXIT_NO_ACCESS = 3;
export type HelperCommand = { type: 'config'; trigger: string; triggerVk: number; clickPing: boolean; gameCheck: boolean; emoteTrigger: string; emoteTriggerVk: number; emoteClick: boolean; dragThresholdPx: number; toggleMods: number; toggleVk: number; enabled: boolean } | { type: 'suspend'; on: boolean } | { type: 'setEnabled'; enabled: boolean } | { type: 'shutdown' };
export function configCommand(s: Settings, enabled: boolean): HelperCommand {
  return { type: 'config', trigger: s.trigger, triggerVk: 0, clickPing: false, gameCheck: true, emoteTrigger: 'off', emoteTriggerVk: 0, emoteClick: false, dragThresholdPx: s.dragThresholdPx, toggleMods: 3, toggleVk: 0x50, enabled };
}
export const serializeCommand = (c: HelperCommand) => JSON.stringify(c) + '\n';
export function parseHelperLine(line: string): HelperEvent | null {
  let v: any;
  try { v = JSON.parse(line); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  if (v.type === 'cancel') return { type: 'cancel' };
  if (v.type === 'ready' && Number.isInteger(v.version)) return { type: 'ready', version: v.version };
  if (v.type === 'toggled' && typeof v.enabled === 'boolean') return { type: 'toggled', enabled: v.enabled };
  if (v.type === 'error' && typeof v.message === 'string') return { type: 'error', message: v.message };
  if (v.type === 'sim' && typeof v.swallow === 'boolean' && typeof v.inject === 'string') return { type: 'sim', swallow: v.swallow, inject: v.inject };
  if (v.type === 'wheelScroll' && Number.isInteger(v.x) && Number.isInteger(v.y) && Number.isInteger(v.delta) && v.delta !== 0 && Math.abs(v.delta) <= 32768) return { type: 'wheelScroll', x: v.x, y: v.y, delta: v.delta, wheel: v.wheel === 'emote' ? 'emote' : 'ping' };
  if (['wheelOpen', 'wheelMove', 'wheelRelease', 'click'].includes(v.type) && Number.isInteger(v.x) && Number.isInteger(v.y)) return { type: v.type, x: v.x, y: v.y, wheel: v.wheel === 'emote' ? 'emote' : 'ping' };
  return null;
}
