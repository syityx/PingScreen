import { describe, it, expect } from 'vitest';
import { defaultWheelActions, type WheelPreferences } from '../src/shared/wheel';
import { copyWheel, moveWheelSlot, replaceWheelSlot, saveWheelDraft, wheelChanged } from '../src/shared/wheelDraft';

describe('explicit wheel editing session', () => {
  const initial = (): WheelPreferences => ({wheelSlots:5,wheelActions:defaultWheelActions()});
  it('keeps input, size and ordering separate from saved settings until one explicit save', async () => {
    const saved=initial();let writes=0;
    let draft=copyWheel(saved);draft.wheelSlots=4;
    draft=moveWheelSlot(draft,'slot-6',0);
    draft=replaceWheelSlot(draft,{id:'slot-6',kind:'prompt',name:'审查',icon:'eye',prompt:'Review here'});
    expect(saved).toEqual(initial());expect(wheelChanged(draft,saved)).toBe(true);expect(writes).toBe(0);
    const result=await saveWheelDraft(draft,async value=>{writes++;return value;});
    expect(writes).toBe(1);expect(result).toEqual(draft);expect(wheelChanged(draft,result)).toBe(false);
    result.wheelActions[0].id='mutated';expect(draft.wheelActions[0].id).toBe('slot-6');
  });
  it('retains an invalid draft and rejects it before persistence',async()=>{
    const draft=replaceWheelSlot(initial(),{id:'slot-1',kind:'prompt',name:'',icon:'eye',prompt:''});
    let writes=0;
    await expect(saveWheelDraft(draft,async value=>{writes++;return value;})).rejects.toThrow('名称');
    expect(writes).toBe(0);expect(draft.wheelActions[0]).toMatchObject({name:'',prompt:''});
  });
  it('keeps draft and baseline intact after write failure and supports discard',async()=>{
    const saved=initial(),draft=moveWheelSlot(saved,'slot-2',0);
    await expect(saveWheelDraft(draft,async()=>{throw new Error('disk unavailable');})).rejects.toThrow('disk');
    expect(draft.wheelActions[0].id).toBe('slot-2');expect(saved).toEqual(initial());
    expect(wheelChanged(copyWheel(saved),saved)).toBe(false);
  });
});
