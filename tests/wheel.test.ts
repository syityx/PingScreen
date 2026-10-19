import { describe, expect, it } from 'vitest';
import { characterCount, customErrors, defaultWheelActions, loadWheel, validateWheel, visibleActions, wheelItem, type WheelSlot } from '../src/shared/wheel';

describe('wheel configuration', () => {
  it('keeps two same-name, same-icon prompts independent by slot identity', () => {
    const actions = defaultWheelActions();
    actions[0] = { id: 'a', kind: 'prompt', name: '任务', icon: 'translate', prompt: '英文润色' };
    actions[1] = { ...actions[0], id: 'b', prompt: '审查代码' };
    const config = validateWheel({ wheelSlots: 6, wheelActions: actions });
    expect(config.wheelActions[0]).not.toEqual(config.wheelActions[1]);
    expect(wheelItem(actions[0]).id).not.toBe(wheelItem(actions[1]).id);
    expect(visibleActions(config)).toHaveLength(6);
    expect(visibleActions({ ...config, wheelSlots: 4 })).toEqual(actions.slice(0, 4));
  });
  it('validates Unicode code points and whitespace at field limits', () => {
    expect(characterCount('😀')).toBe(1);
    expect(customErrors({ name: '😀'.repeat(20), prompt: '😀'.repeat(8000), icon: 'eye' })).toEqual({});
    expect(customErrors({ name: '😀'.repeat(21), prompt: 'a'.repeat(8001), icon: 'bad' })).toHaveProperty('name');
    expect(customErrors({ name: ' ', prompt: '\n', icon: 'eye' })).toHaveProperty('prompt');
  });
  it('rejects invalid identities, types and all-region visible prefixes', () => {
    const actions: WheelSlot[] = defaultWheelActions().map(s => ({ ...s, kind: 'builtin', action: 'region' }));
    expect(() => validateWheel({ wheelSlots: 6, wheelActions: actions })).toThrow('可执行');
    actions[0] = { id: 'unique', kind: 'builtin', action: 'explain' };
    expect(visibleActions(validateWheel({ wheelSlots: 4, wheelActions: actions }), true)).toHaveLength(1);
    actions[1].id = 'unique';
    expect(() => validateWheel({ wheelSlots: 4, wheelActions: actions })).toThrow('重复');
    expect(() => validateWheel({ wheelSlots: 8, wheelActions: actions })).toThrow('项数');
  });
  it('repairs corrupt entries without losing valid custom slots', () => {
    const actions: unknown[] = defaultWheelActions();
    actions[0] = { id: 'a', kind: 'prompt', name: '审查', prompt: '检查这里', icon: 'missing' };
    actions[1] = { id: 'a', kind: 'nonsense' };
    const loaded = loadWheel({ wheelSlots: 6, wheelActions: actions });
    expect(loaded.wheelActions[0]).toMatchObject({ name: '审查', icon: 'custom' });
    expect(new Set(loaded.wheelActions.map(s => s.id)).size).toBe(6);
    expect(() => validateWheel(loaded)).not.toThrow();
  });
});
