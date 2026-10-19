import { validateWheel, type WheelPreferences, type WheelSlot } from './wheel';

export const copyWheel = (config: WheelPreferences): WheelPreferences => ({ wheelSlots: config.wheelSlots, wheelActions: config.wheelActions.map(slot => ({ ...slot })) });
const comparable = (config: WheelPreferences): string => JSON.stringify([config.wheelSlots, config.wheelActions.map(slot => slot.kind === 'builtin' ? [slot.id, slot.kind, slot.action] : [slot.id, slot.kind, slot.name, slot.icon, slot.prompt])]);
export const wheelChanged = (draft: WheelPreferences, saved: WheelPreferences): boolean => comparable(draft) !== comparable(saved);
export function moveWheelSlot(config: WheelPreferences, id: string, destination: number): WheelPreferences {
  const next = copyWheel(config), index = next.wheelActions.findIndex(slot => slot.id === id);
  if (index < 0) return next;
  const [slot] = next.wheelActions.splice(index, 1);
  next.wheelActions.splice(Math.max(0, Math.min(next.wheelActions.length, destination)), 0, slot);
  return next;
}
export function replaceWheelSlot(config: WheelPreferences, slot: WheelSlot): WheelPreferences {
  return { ...config, wheelActions: config.wheelActions.map(item => item.id === slot.id ? { ...slot } : { ...item }) };
}
export async function saveWheelDraft(config: WheelPreferences, write: (next: WheelPreferences) => Promise<WheelPreferences>): Promise<WheelPreferences> {
  return copyWheel(await write(validateWheel(config)));
}
