import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicSettings, Settings } from '../shared/types';
export const DEFAULTS: Settings = { baseUrl: '', model: '', trigger: 'alt', wheelSlots: 5, dragThresholdPx: 8, launchAtStartup: false, stream: true };
export function endpoint(base: string): string {
  const u = new URL(base.trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('模型地址需要是 HTTP/HTTPS 地址，且不包含用户名、密码或查询参数。');
  const clean = u.toString().replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions';
}
export function normalize(raw: unknown): Settings {
  const s = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  return { baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl.trim().slice(0, 2048) : '', model: typeof s.model === 'string' ? s.model.trim().slice(0, 200) : '', trigger: ['alt','ctrl','shift','mouse4','mouse5'].includes(s.trigger ?? '') ? s.trigger! : 'alt', wheelSlots: s.wheelSlots === 4 ? 4 : 5, dragThresholdPx: typeof s.dragThresholdPx === 'number' && Number.isFinite(s.dragThresholdPx) ? Math.round(Math.max(3, Math.min(40, s.dragThresholdPx))) : 8, launchAtStartup: s.launchAtStartup === true, stream: s.stream !== false };
}
export interface SecretStorage { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
export class SettingsStore {
  private current = { ...DEFAULTS };
  private encrypted = '';
  private keyProblem: string | undefined;
  private readonly file: string;
  constructor(dir: string, private readonly secrets: SecretStorage) {
    mkdirSync(dir, { recursive: true }); this.file = join(dir, 'settings.json');
    if (existsSync(this.file)) {
      try { const raw = JSON.parse(readFileSync(this.file, 'utf8')); this.current = normalize(raw); if (typeof raw.encryptedKey === 'string') this.encrypted = raw.encryptedKey; }
      catch { this.keyProblem = '设置文件无法读取，请重新配置。原文件将在保存时备份。'; }
    }
  }
  get(): Settings { return { ...this.current }; }
  key(): string {
    if (!this.encrypted) return '';
    if (!this.secrets.isEncryptionAvailable()) throw new Error('系统密钥存储不可用，请恢复后重试。');
    try { return this.secrets.decryptString(Buffer.from(this.encrypted, 'base64')); }
    catch { throw new Error('保存的密钥无法解密，请重新填写并保存。'); }
  }
  public(): PublicSettings { return { ...this.get(), hasKey: !!this.encrypted, secureStorage: this.secrets.isEncryptionAvailable(), keyProblem: this.keyProblem }; }
  save(raw: unknown): PublicSettings {
    if (!raw || typeof raw !== 'object') throw new Error('设置格式无效。');
    const patch = raw as Record<string, unknown>;
    const next = normalize({ ...this.current, ...patch });
    if (next.baseUrl) endpoint(next.baseUrl);
    let encrypted = this.encrypted;
    if (patch.clearKey === true) encrypted = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      if (!this.secrets.isEncryptionAvailable()) throw new Error('系统密钥存储不可用，无法安全保存密钥。');
      if (patch.apiKey.length > 8192) throw new Error('密钥过长。');
      encrypted = this.secrets.encryptString(patch.apiKey.trim()).toString('base64');
    }
    if (this.keyProblem && existsSync(this.file)) renameSync(this.file, this.file + '.bak-' + Date.now());
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify({ version: 1, ...next, encryptedKey: encrypted }, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    this.current = next; this.encrypted = encrypted; this.keyProblem = undefined;
    return this.public();
  }
}
