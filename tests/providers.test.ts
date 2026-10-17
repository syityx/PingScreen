import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/main/settings';
import { PROVIDERS, providerFor } from '../src/shared/providers';
import { askModel } from '../src/main/model';

const secrets = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from('protected:' + s), decryptString: (b: Buffer) => { if (!b.toString().startsWith('protected:')) throw new Error('bad'); return b.toString().slice(10); } };
function fixture(run: (store: SettingsStore, file: string, dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'pingscreen-providers-'));
  return Promise.resolve().then(() => run(new SettingsStore(dir, secrets), join(dir, 'settings.json'), dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}
describe('provider connections', () => {
  it('resolves cloud model IDs and protects preset endpoints', () => fixture((store) => {
    expect(PROVIDERS).toHaveLength(7);
    expect(providerFor('deepseek').models).toContainEqual({ id: 'deepseek-flash', label: 'DeepSeek-Flash' });
    const { config } = store.testConnection({ provider: 'deepseek', baseUrl: 'https://wrong.example/v1' });
    expect(config.baseUrl).toBe('https://api.deepseek.com');
    expect(config.model).toBe('deepseek-flash');
    expect(() => store.save({ provider: 'unknown' })).toThrow('未知');
    expect(() => store.testConnection({ provider: 'unknown' })).toThrow('未知');
    expect(store.testConnection({ provider: 'doubao', model: 'ep-own-vision' }).config.model).toBe('ep-own-vision');
  }));
  it('keeps independent encrypted credentials, including retain and clear', () => fixture((store, file, dir) => {
    store.save({ provider: 'openai', apiKey: 'a-secret' });
    store.save({ provider: 'deepseek', apiKey: 'b-secret' });
    expect(store.key('openai')).toBe('a-secret');
    store.save({ provider: 'openai', apiKey: '' });
    expect(store.key()).toBe('a-secret');
    const disk = readFileSync(file, 'utf8'), publicData = JSON.stringify(store.public());
    for (const data of [disk, publicData]) { expect(data).not.toContain('a-secret'); expect(data).not.toContain('b-secret'); }
    expect(publicData).not.toContain('encryptedKey');
    expect(publicData).not.toContain(Buffer.from('protected:a-secret').toString('base64'));
    expect(new SettingsStore(dir, secrets).key('deepseek')).toBe('b-secret');
    store.save({ provider: 'deepseek', clearKey: true });
    expect(store.key()).toBe(''); expect(store.key('openai')).toBe('a-secret');
    const locked = new SettingsStore(dir, { ...secrets, isEncryptionAvailable: () => false });
    expect(() => locked.save({ provider: 'deepseek', apiKey: 'new' })).toThrow('无法安全保存');
    expect(() => locked.key('openai')).toThrow('系统密钥');
    const raw = JSON.parse(readFileSync(file, 'utf8')); raw.profiles.openai.encryptedKey = 'invalid'; writeFileSync(file, JSON.stringify(raw));
    const broken = new SettingsStore(dir, secrets);
    expect(broken.public().profiles.openai.keyProblem).toContain('无法解密');
    expect(() => broken.testConnection({ provider: 'openai' })).toThrow('无法解密');
    expect(broken.testConnection({ provider: 'openai', apiKey: 'replacement' }).key).toBe('replacement');
  }));
  it('migrates old files without rewriting on load and keeps a recoverable backup', () => fixture((_store, file, dir) => {
    const legacy = JSON.stringify({ version: 1, baseUrl: 'http://localhost:11434/v1', model: 'local-vision', stream: false, trigger: 'ctrl', answerFontSize: 20, encryptedKey: Buffer.from('protected:old-secret').toString('base64') });
    writeFileSync(file, legacy);
    const store = new SettingsStore(dir, secrets);
    expect(store.get()).toMatchObject({ provider: 'custom', model: 'local-vision', stream: false, trigger: 'ctrl', answerFontSize: 20 });
    expect(store.key()).toBe('old-secret'); expect(readFileSync(file, 'utf8')).toBe(legacy);
    store.save({ answerFontSize: 24 });
    const backup = readdirSync(dir).find(name => name.startsWith('settings.json.bak-'))!;
    expect(readFileSync(join(dir, backup), 'utf8')).toBe(legacy);
    expect(new SettingsStore(dir, secrets).get()).toMatchObject({ provider: 'custom', model: 'local-vision', answerFontSize: 24, stream: false });
    const upgraded = JSON.parse(readFileSync(file, 'utf8')); upgraded.activeProvider = 'removed'; upgraded.profiles.removed = { encryptedKey: Buffer.from('protected:wrong').toString('base64') }; writeFileSync(file, JSON.stringify(upgraded));
    const unknown = new SettingsStore(dir, secrets); expect(unknown.get().provider).toBe('custom'); expect(unknown.key()).toBe('old-secret');
    copyFileSync(join(dir, backup), file); expect(new SettingsStore(dir, secrets).key()).toBe('old-secret');
  }));
  it('tests B without persisting B or borrowing A credentials; preference patches keep A active', () => fixture(async (store, file) => {
    store.save({ provider: 'openai', apiKey: 'a-secret' });
    store.save({ provider: 'deepseek', apiKey: 'b-secret' });
    store.save({ provider: 'openai' });
    const before = readFileSync(file, 'utf8');
    const draft = store.testConnection({ provider: 'deepseek', model: 'deepseek-flash', stream: false });
    let requested = '', options: RequestInit | undefined;
    const controller = new AbortController();
    const messages = [{ role: 'user' as const, content: [{ type: 'image_url' as const, image_url: { url: 'data:image/png;base64,synthetic' } }] }];
    await askModel(draft.config, draft.key, messages, controller.signal, () => {}, async (url, init) => { requested = String(url); options = init; return Response.json({ choices: [{ message: { content: 'OK' } }] }); });
    expect(requested).toBe('https://api.deepseek.com/chat/completions');
    expect(options?.headers).toHaveProperty('Authorization', 'Bearer b-secret');
    expect(options?.body).toContain('data:image/png;base64,synthetic'); expect(options?.signal).toBe(controller.signal);
    expect(readFileSync(file, 'utf8')).toBe(before); expect(store.get().provider).toBe('openai'); expect(store.key()).toBe('a-secret');
    expect(store.testConnection({ provider: 'gemini' }).key).toBe('');
    expect(store.testConnection({ provider: 'deepseek', clearKey: true, apiKey: 'ignored' }).key).toBe('');
    const local = store.testConnection({ provider: 'custom', baseUrl: 'http://localhost:11434/v1/chat/completions', model: 'vision' });
    expect(local.key).toBe('');
    store.save({ answerFontSize: 24, trigger: 'shift' });
    expect(store.get()).toMatchObject({ provider: 'openai', model: 'gpt-4.1-mini', answerFontSize: 24, trigger: 'shift' });
    expect(store.public().profiles.deepseek.model).toBe('deepseek-flash');
  }));
});
