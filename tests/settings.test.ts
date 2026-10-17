import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { normalize, SettingsStore } from '../src/main/settings';
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
