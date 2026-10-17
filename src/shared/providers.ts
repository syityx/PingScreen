export const PROVIDER_IDS = ['qwen', 'siliconflow', 'doubao', 'openai', 'gemini', 'deepseek', 'custom'] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export interface Provider { id: ProviderId; label: string; baseUrl: string; models: readonly { id: string; label: string }[]; note?: string }
export const PROVIDERS: readonly Provider[] = [
  { id: 'qwen', label: '通义千问（百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: [{ id: 'qwen3-vl-plus', label: 'Qwen3-VL Plus' }], note: '使用中国大陆地域密钥；其他地域或业务空间专属地址请选择自定义。' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', models: [{ id: 'moonshotai/Kimi-K2.7-Code', label: 'Kimi K2.7 Code' }] },
  { id: 'doubao', label: '豆包（火山方舟）', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: [], note: '填写北京地域已开通图片输入的模型或部署 ID（ep-…），可在火山方舟控制台获取。' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' }] },
  { id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: [{ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', models: [{ id: 'deepseek-flash', label: 'DeepSeek-Flash' }] },
  { id: 'custom', label: '自定义', baseUrl: '', models: [], note: '支持图片输入的 Chat Completions 兼容接口，包括 Ollama 等本地服务。' },
];
export function isProviderId(value: unknown): value is ProviderId { return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value); }
export function providerFor(id: ProviderId): Provider { return PROVIDERS.find(provider => provider.id === id)!; }
export interface ConnectionProfile { baseUrl: string; model: string; stream: boolean }
export interface PublicProfile extends ConnectionProfile { hasKey: boolean; keyProblem?: string }
export function normalizeProfile(id: ProviderId, raw: unknown): ConnectionProfile {
  const value = raw && typeof raw === 'object' ? raw as Partial<ConnectionProfile> : {};
  const preset = providerFor(id);
  return { baseUrl: id === 'custom' ? typeof value.baseUrl === 'string' ? value.baseUrl.trim().slice(0, 2048) : '' : preset.baseUrl,
    model: typeof value.model === 'string' ? value.model.trim().slice(0, 200) : preset.models[0]?.id ?? '', stream: value.stream !== false };
}
