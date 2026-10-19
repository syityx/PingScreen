import { ACTIONS, LABELS, type WheelAction } from './types';

export const CUSTOM_ICONS = ['explain', 'translate', 'rewrite', 'custom', 'eye', 'link', 'model', 'info'] as const;
export type CustomIcon = typeof CUSTOM_ICONS[number];
export type WheelSize = 4 | 5 | 6;
export type WheelSlot = { id: string } & (
  | { kind: 'builtin'; action: WheelAction }
  | { kind: 'prompt'; name: string; icon: CustomIcon; prompt: string }
);
export interface WheelItem { id: string; name: string; icon: CustomIcon | 'region'; action?: WheelAction }
export interface WheelPreferences { wheelSlots: WheelSize; wheelActions: WheelSlot[] }
export const characterCount = (value: string): number => [...value].length;
export const isBuiltin = (slot: WheelSlot | undefined, action: WheelAction): boolean => slot?.kind === 'builtin' && slot.action === action;
export const defaultWheelActions = (): WheelSlot[] => [...ACTIONS, 'explain' as const].map((action, i) => ({ id: `slot-${i + 1}`, kind: 'builtin', action }));
export function wheelItem(slot: WheelSlot): WheelItem {
  return slot.kind === 'builtin' ? { id: slot.id, name: LABELS[slot.action], icon: slot.action, action: slot.action } : { id: slot.id, name: slot.name, icon: slot.icon };
}
export function visibleActions(config: WheelPreferences, region = false): WheelSlot[] {
  return config.wheelActions.slice(0, config.wheelSlots).filter(slot => !region || !isBuiltin(slot, 'region'));
}
export function customErrors(slot: { name: string; prompt: string; icon: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!slot.name.trim() || characterCount(slot.name.trim()) > 20) errors.name = '名称需为 1–20 个字符';
  if (!slot.prompt.trim() || characterCount(slot.prompt.trim()) > 8000) errors.prompt = '提示词需为 1–8000 个字符';
  if (!(CUSTOM_ICONS as readonly string[]).includes(slot.icon)) errors.icon = '请选择内置图标';
  return errors;
}
function parseSlot(raw: unknown): WheelSlot {
  if (!raw || typeof raw !== 'object') throw new Error('槽位格式无效');
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id)) throw new Error('槽位 ID 无效');
  if (s.kind === 'builtin' && ACTIONS.includes(s.action as WheelAction)) return { id: s.id, kind: 'builtin', action: s.action as WheelAction };
  if (s.kind !== 'prompt' || typeof s.name !== 'string' || typeof s.prompt !== 'string' || typeof s.icon !== 'string') throw new Error('功能格式无效');
  const errors = customErrors(s as { name: string; prompt: string; icon: string });
  if (Object.keys(errors).length) throw new Error(Object.values(errors).join('；'));
  return { id: s.id, kind: 'prompt', name: s.name.trim(), prompt: s.prompt.trim(), icon: s.icon as CustomIcon };
}
export function validateWheel(raw: { wheelSlots?: unknown; wheelActions?: unknown }): WheelPreferences {
  if (![4, 5, 6].includes(raw.wheelSlots as number)) throw new Error('轮盘项数需为 4、5 或 6');
  if (!Array.isArray(raw.wheelActions) || raw.wheelActions.length !== 6) throw new Error('轮盘必须包含六个槽位');
  const wheelActions = raw.wheelActions.map((s, i) => {
    try { return parseSlot(s); } catch (error) { throw new Error(`槽位 ${i + 1}：${(error as Error).message}`); }
  });
  if (new Set(wheelActions.map(s => s.id)).size !== 6) throw new Error('槽位 ID 不能重复');
  if (wheelActions.slice(0, 4).every(s => isBuiltin(s, 'region'))) throw new Error('前四项必须保留至少一个可执行功能');
  return { wheelSlots: raw.wheelSlots as WheelSize, wheelActions };
}
/** Loading repairs old/corrupt data; saving uses validateWheel and never silently repairs it. */
export function loadWheel(raw: { wheelSlots?: unknown; wheelActions?: unknown }): WheelPreferences {
  const wheelSlots: WheelSize = raw.wheelSlots === 4 || raw.wheelSlots === 6 ? raw.wheelSlots : 5;
  const defaults = defaultWheelActions();
  const seen = new Set<string>();
  const wheelActions = Array.isArray(raw.wheelActions) && raw.wheelActions.length === 6 ? raw.wheelActions.map((value, i) => {
    const s = value && typeof value === 'object' ? { ...value } : {};
    if (typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id) || seen.has(s.id)) s.id = `repaired-${i + 1}`;
    while (seen.has(s.id)) s.id += '-r';
    seen.add(s.id);
    if (s.kind === 'prompt' && !CUSTOM_ICONS.includes(s.icon)) s.icon = 'custom';
    try { return parseSlot(s); } catch { return { ...defaults[i], id: s.id }; }
  }) : defaults;
  return { wheelSlots, wheelActions: wheelActions.slice(0, 4).every(s => isBuiltin(s, 'region')) ? defaults : wheelActions };
}
