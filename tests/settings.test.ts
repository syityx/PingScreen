import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SettingsStore } from '../src/main/settings';
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
