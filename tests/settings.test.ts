import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { normalize, SettingsStore } from '../src/main/settings';
import { defaultWheelActions, type WheelSlot } from '../src/shared/wheel';

describe('wheel settings persistence', () => {
  const secrets = { isEncryptionAvailable:()=>true, encryptString:(s:string)=>Buffer.from('encrypted:'+s), decryptString:(b:Buffer)=>b.toString().replace('encrypted:','') };
  it.each([1,2])('upgrades version %s without rewriting, preserves settings and backs up the original', version => {
    const dir = mkdtempSync(join(tmpdir(), 'wheel-upgrade-'));
    const file = join(dir, 'settings.json');
    const profile = { baseUrl:'http://localhost:1234/v1',model:'old-model',stream:false,encryptedKey:Buffer.from('encrypted:old-key').toString('base64') };
    const original = JSON.stringify({version,wheelSlots:4,trigger:'shift',answerFontSize:22,...(version===1?profile:{activeProvider:'custom',profiles:{custom:profile}})});
    try {
      writeFileSync(file, original);
      const store = new SettingsStore(dir, secrets);
      expect(readFileSync(file,'utf8')).toBe(original);
      expect(store.get()).toMatchObject({wheelSlots:4,model:'old-model',trigger:'shift',answerFontSize:22,stream:false});
      expect(store.get().wheelActions).toEqual(defaultWheelActions());
      const actions = store.get().wheelActions;
      actions[1] = {id:actions[1].id,kind:'prompt',name:'审查',icon:'eye',prompt:'检查这里'};
      store.save({wheelSlots:6,wheelActions:actions});
      const reopened = new SettingsStore(dir,secrets);
      expect(reopened.get().wheelActions).toEqual(actions);
      expect(reopened.get()).toMatchObject({wheelSlots:6,model:'old-model',trigger:'shift',answerFontSize:22,stream:false});
      expect(reopened.key()).toBe('old-key');
      expect(readFileSync(join(dir,readdirSync(dir).find(f=>f.startsWith('settings.json.bak-'))!),'utf8')).toBe(original);
      for (const wheelSlots of [4,5,6]) reopened.save({wheelSlots});
      expect(new SettingsStore(dir,secrets).get().wheelActions).toEqual(actions);
      const returned = reopened.public(); returned.wheelActions[0].id='changed';
      expect(reopened.get().wheelActions[0].id).not.toBe('changed');
      expect(JSON.parse(readFileSync(file,'utf8')).version).toBe(2);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('rejects invalid saves, repairs corrupt loaded slots and keeps unrelated data', () => {
    const dir=mkdtempSync(join(tmpdir(),'wheel-invalid-'));
    try {
      const store=new SettingsStore(dir,secrets); const before=store.get();
      expect(()=>store.save({wheelSlots:7})).toThrow('项数');
      expect(()=>store.save({wheelActions:[]})).toThrow('六个');
      const bad: WheelSlot[]=defaultWheelActions();
      bad[0]={id:'custom-task',kind:'prompt',name:'',prompt:'ok',icon:'eye'};
      expect(()=>store.save({wheelActions:bad})).toThrow('名称');
      expect(store.get()).toEqual(before);
      store.save({trigger:'ctrl',answerFontSize:21});
      const raw=JSON.parse(readFileSync(join(dir,'settings.json'),'utf8')); raw.wheelActions=bad;
      writeFileSync(join(dir,'settings.json'),JSON.stringify(raw));
      expect(new SettingsStore(dir,secrets).get()).toMatchObject({trigger:'ctrl',answerFontSize:21});
      expect(new SettingsStore(dir,secrets).get().wheelActions[0]).toMatchObject({kind:'builtin',action:'explain'});
    } finally {rmSync(dir,{recursive:true,force:true});}
  });
});
describe('encrypted settings', () => {
  it('stores encrypted keys, never returns them to the UI, preserves and clears them', () => {
    const dir = mkdtempSync(join(tmpdir(),'pingscreen-'));
    const secrets = { isEncryptionAvailable:()=>true, encryptString:(s:string)=>Buffer.from('encrypted:'+s), decryptString:(b:Buffer)=>b.toString().replace('encrypted:','') };
    try {
      const store = new SettingsStore(dir,secrets);
      const publicSettings = store.save({baseUrl:'http://localhost:1234/v1',model:'vision',apiKey:'private-key'});
      expect(JSON.stringify(publicSettings)).not.toContain('private-key');
      expect(readFileSync(join(dir,'settings.json'),'utf8')).not.toContain('private-key');
      expect(store.key()).toBe('private-key');
      expect(new SettingsStore(dir,secrets).key()).toBe('private-key');
      store.save({apiKey:''}); expect(store.key()).toBe('private-key');
      store.save({clearKey:true}); expect(store.key()).toBe('');
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  it('refuses plaintext fallback when system storage is unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(),'pingscreen-'));
    try {
      const store = new SettingsStore(dir,{isEncryptionAvailable:()=>false,encryptString:()=>{throw new Error('unavailable');},decryptString:()=>''});
      expect(()=>store.save({apiKey:'secret'})).toThrow('无法安全保存'); expect(store.public().hasKey).toBe(false);
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
});

describe('answer reading settings', () => {
  it.each([undefined, null, '20', NaN, Infinity, -Infinity])('defaults invalid or missing font size %s to 16px', value => {
    expect(normalize({ answerFontSize: value }).answerFontSize).toBe(16);
  });
  it.each([[3,14], [14,14], [16,16], [19.6,20], [24,24], [50,24]])('normalizes font size %s to %s', (value, expected) => {
    expect(normalize({ answerFontSize: value }).answerFontSize).toBe(expected);
  });
  it('loads old settings without rewriting them and persists only the new preference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pingscreen-reading-'));
    const file = join(dir, 'settings.json');
    const secrets = { isEncryptionAvailable:()=>true, encryptString:(s:string)=>Buffer.from('encrypted:'+s), decryptString:(b:Buffer)=>b.toString().replace('encrypted:','') };
    const legacy = JSON.stringify({ version:1, baseUrl:'http://localhost:1234/v1', model:'existing-model', trigger:'ctrl', wheelSlots:4, dragThresholdPx:15, launchAtStartup:true, stream:false, encryptedKey:Buffer.from('encrypted:existing-key').toString('base64') });
    try {
      writeFileSync(file, legacy);
      const store = new SettingsStore(dir, secrets);
      expect(store.get().answerFontSize).toBe(16);
      expect(readFileSync(file, 'utf8')).toBe(legacy);
      const before = store.get();
      store.save({ answerFontSize:24 });
      const reopened = new SettingsStore(dir, secrets);
      expect(reopened.get()).toEqual({ ...before, answerFontSize:24 });
      expect(reopened.key()).toBe('existing-key');
      store.save({ trigger:'shift' });
      expect(store.get().answerFontSize).toBe(24);
      expect(readFileSync(file, 'utf8')).not.toContain('existing-key');
    } finally { rmSync(dir, { recursive:true, force:true }); }
  });
});
