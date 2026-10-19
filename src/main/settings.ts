import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ANSWER_FONT_SIZE, type PublicSettings, type Settings } from '../shared/types';
import { defaultWheelActions, loadWheel, validateWheel } from '../shared/wheel';
import { isProviderId, normalizeProfile, PROVIDER_IDS, type ConnectionProfile, type ProviderId, type PublicProfile } from '../shared/providers';
export const DEFAULTS: Settings = { provider: 'custom', baseUrl: '', model: '', trigger: 'alt', wheelSlots: 5, wheelActions: defaultWheelActions(), dragThresholdPx: 8, launchAtStartup: false, stream: true, answerFontSize: ANSWER_FONT_SIZE.default };
export function endpoint(base: string): string {
  const u = new URL(base.trim());
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error('模型地址需要是 HTTP/HTTPS 地址，且不包含用户名、密码或查询参数。');
  const clean = u.toString().replace(/\/+$/, '');
  return clean.endsWith('/chat/completions') ? clean : clean + '/chat/completions';
}
export function normalize(raw: unknown): Settings {
  const s = raw && typeof raw === 'object' ? raw as Partial<Settings> : {};
  const provider = isProviderId(s.provider) ? s.provider : 'custom';
  return { provider, ...normalizeProfile(provider, s), trigger: ['alt','ctrl','shift','mouse4','mouse5'].includes(s.trigger ?? '') ? s.trigger! : 'alt', ...loadWheel(s), dragThresholdPx: typeof s.dragThresholdPx === 'number' && Number.isFinite(s.dragThresholdPx) ? Math.round(Math.max(3, Math.min(40, s.dragThresholdPx))) : 8, launchAtStartup: s.launchAtStartup === true, answerFontSize: typeof s.answerFontSize === 'number' && Number.isFinite(s.answerFontSize) ? Math.round(Math.max(ANSWER_FONT_SIZE.min, Math.min(ANSWER_FONT_SIZE.max, s.answerFontSize))) : ANSWER_FONT_SIZE.default };
}
export interface SecretStorage { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string }
type StoredProfile = ConnectionProfile & { encryptedKey: string };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class SettingsStore {
  private current = { ...DEFAULTS };
  private profiles = Object.fromEntries(PROVIDER_IDS.map(id => [id, { ...normalizeProfile(id, {}), encryptedKey: '' }])) as Record<ProviderId, StoredProfile>;
  private needsBackup = false;
  private keyProblem: string | undefined;
  private readonly file: string;
  constructor(dir: string, private readonly secrets: SecretStorage) {
    mkdirSync(dir, { recursive: true }); this.file = join(dir, 'settings.json');
    if (existsSync(this.file)) {
      try {
        const raw = object(JSON.parse(readFileSync(this.file, 'utf8')));
        this.needsBackup = raw.version !== 2 || !Object.hasOwn(raw, 'wheelActions');
        if (raw.version === 2) {
          for (const id of PROVIDER_IDS) {
            const profile = object(object(raw.profiles)[id]);
            this.profiles[id] = { ...normalizeProfile(id, profile), encryptedKey: typeof profile.encryptedKey === 'string' ? profile.encryptedKey : '' };
          }
          const provider = isProviderId(raw.activeProvider) ? raw.activeProvider : 'custom';
          this.current = normalize({ ...raw, ...this.profiles[provider], provider });
        } else {
          this.current = normalize({ ...raw, provider: 'custom' });
          this.profiles.custom = { ...normalizeProfile('custom', raw), encryptedKey: typeof raw.encryptedKey === 'string' ? raw.encryptedKey : '' };
        }
      }
      catch { this.keyProblem = '设置文件无法读取，请重新配置。原文件将在保存时备份。'; }
    }
  }
  get(): Settings { return { ...this.current, wheelActions: this.current.wheelActions.map(s => ({ ...s })) }; }
  key(provider: ProviderId = this.current.provider ?? 'custom'): string {
    const encrypted = this.profiles[provider].encryptedKey;
    if (!encrypted) return '';
    if (!this.secrets.isEncryptionAvailable()) throw new Error('系统密钥存储不可用，请恢复后重试。');
    try { return this.secrets.decryptString(Buffer.from(encrypted, 'base64')); }
    catch { throw new Error('保存的密钥无法解密，请重新填写并保存。'); }
  }
  public(): PublicSettings {
    const profiles = {} as Record<ProviderId, PublicProfile>;
    for (const id of PROVIDER_IDS) {
      const { encryptedKey, ...profile } = this.profiles[id];
      let keyProblem: string | undefined;
      try { this.key(id); } catch (error) { keyProblem = (error as Error).message; }
      profiles[id] = { ...profile, hasKey: !!encryptedKey, keyProblem };
    }
    const provider = this.current.provider ?? 'custom';
    return { ...this.get(), provider, profiles, hasKey: profiles[provider].hasKey, secureStorage: this.secrets.isEncryptionAvailable(), keyProblem: this.keyProblem };
  }
  private draft(raw: unknown): { patch: Record<string, unknown>; provider: ProviderId; profile: ConnectionProfile } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设置格式无效。');
    const patch = raw as Record<string, unknown>;
    if (patch.provider !== undefined && !isProviderId(patch.provider)) throw new Error('未知的模型服务商。');
    if (patch.apiKey !== undefined && (typeof patch.apiKey !== 'string' || patch.apiKey.length > 8192)) throw new Error('密钥格式无效或过长。');
    const provider = isProviderId(patch.provider) ? patch.provider : this.current.provider ?? 'custom';
    const profile = normalizeProfile(provider, { ...this.profiles[provider], ...patch });
    if (profile.baseUrl) endpoint(profile.baseUrl);
    return { patch, provider, profile };
  }
  testConnection(raw: unknown = {}): { config: Settings; key: string } {
    const { patch, provider, profile } = this.draft(raw);
    if (!profile.baseUrl || !profile.model) throw new Error('请填写服务地址和模型名称。');
    const key = patch.clearKey === true ? '' : typeof patch.apiKey === 'string' && patch.apiKey.trim() ? patch.apiKey.trim() : this.key(provider);
    return { config: { ...this.get(), ...profile, provider }, key };
  }
  save(raw: unknown): PublicSettings {
    const { patch, provider, profile } = this.draft(raw);
    const connectionChanged = ['provider', 'baseUrl', 'model', 'stream', 'apiKey', 'clearKey'].some(field => Object.hasOwn(patch, field));
    if (Object.hasOwn(patch, 'wheelSlots') || Object.hasOwn(patch, 'wheelActions')) validateWheel({ ...this.current, ...patch });
    const next = normalize({ ...this.current, ...Object.fromEntries(['trigger', 'wheelSlots', 'wheelActions', 'dragThresholdPx', 'launchAtStartup', 'answerFontSize'].filter(field => Object.hasOwn(patch, field)).map(field => [field, patch[field]])), ...(connectionChanged ? { ...profile, provider } : {}) });
    let encrypted = this.profiles[provider].encryptedKey;
    if (patch.clearKey === true) encrypted = '';
    else if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
      if (!this.secrets.isEncryptionAvailable()) throw new Error('系统密钥存储不可用，无法安全保存密钥。');
      encrypted = this.secrets.encryptString(patch.apiKey.trim()).toString('base64');
    }
    const profiles = { ...this.profiles, ...(connectionChanged ? { [provider]: { ...profile, encryptedKey: encrypted } } : {}) };
    if ((this.needsBackup || this.keyProblem) && existsSync(this.file)) copyFileSync(this.file, this.file + '.bak-' + Date.now());
    const temp = this.file + '.tmp';
    const { baseUrl: _base, model: _model, stream: _stream, provider: activeProvider, ...preferences } = next;
    writeFileSync(temp, JSON.stringify({ version: 2, ...preferences, activeProvider, profiles }, null, 2), { mode: 0o600 });
    renameSync(temp, this.file);
    this.current = next; this.profiles = profiles; this.keyProblem = undefined; this.needsBackup = false;
    return this.public();
  }
}
