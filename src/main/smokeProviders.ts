import { app, nativeImage, type BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsStore } from './settings';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown | Promise<unknown>, label: string) {
  const start = Date.now(); while (!await test()) { if (Date.now() - start > 8000) throw new Error('Provider smoke: ' + label); await delay(25); }
}
export async function runProviderSmoke(win: BrowserWindow, store: SettingsStore, localBase: string, packets: any[]) {
  const js = (source: string) => win.webContents.executeJavaScript(source);
  const select = async (label: string, value: string) => { await js(`(()=>{const el=document.querySelector('select[aria-label="${label}"]');el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`); await delay(40); };
  const input = async (selector: string, value: string) => { await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`); await delay(30); };
  const click = async (selector: string) => { await js(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(40); };
  const value = (selector: string) => js(`document.querySelector(${JSON.stringify(selector)})?.value`);
  const checkLayout = async () => {
    if (!await js(`(()=>{const root=document.querySelector('.model-panel');return root.scrollWidth<=root.clientWidth && [...root.querySelectorAll('input,select')].every(el=>el.getBoundingClientRect().width>0 && el.getBoundingClientRect().right<=root.getBoundingClientRect().right);})()`)) throw new Error('Provider fields overflow');
  };
  const snapshot = async (name: string) => writeFileSync(join(app.getAppPath(), '.tools/smoke', name), (await win.webContents.capturePage()).toPNG());
  if (await js(`document.querySelector('select[aria-label="服务商"]').options.length`) !== 7) throw new Error('Missing provider options');
  for (const provider of ['qwen', 'siliconflow', 'doubao', 'openai', 'gemini', 'deepseek']) {
    await select('服务商', provider);
    if (await js(`!!document.querySelector('input[type=url]')`)) throw new Error('Cloud provider requires URL');
    await checkLayout();
  }
  if (await value('select[aria-label="模型"]') !== 'deepseek-flash' || !await js(`document.querySelector('select[aria-label="模型"]').textContent.includes('DeepSeek-Flash')`)) throw new Error('DeepSeek Flash mapping lost');
  await snapshot('settings-provider-deepseek.png');
  await js(`document.querySelector('select[aria-label="服务商"]').focus()`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await until(async () => await value('select[aria-label="服务商"]') === 'custom', 'keyboard provider selection');
  await select('服务商', 'deepseek'); await select('模型', '__other__'); await input('[aria-label="模型名称"]', 'draft-deepseek');
  await input('input[type=password]', 'unsaved-key'); await select('服务商', 'openai');
  if (await value('input[type=password]') !== '' || !await js(`document.querySelector('.save-message').textContent.includes('尚未保存')`)) throw new Error('Secret draft moved to another provider');
  await select('服务商', 'deepseek');
  if (await value('[aria-label="模型名称"]') !== 'draft-deepseek') throw new Error('Provider draft lost');
  await input('#answer-font-size', '19'); await until(() => store.get().answerFontSize === 19, 'preference save');
  if (store.get().provider !== 'custom' || store.public().profiles.deepseek.model !== 'deepseek-flash') throw new Error('Preference committed provider draft');
  await select('模型', 'deepseek-flash'); await input('input[type=password]', 'deepseek-test-key');
  const originalTest = store.testConnection.bind(store);
  let resolved: ReturnType<SettingsStore['testConnection']> | undefined;
  const before = packets.length;
  try {
    // Exercise IPC and renderer against a local fixture; unit tests verify the real resolved URL.
    store.testConnection = raw => { resolved = originalTest(raw); return { ...resolved, config: { ...resolved.config, baseUrl: localBase } }; };
    await js(`document.querySelector('.settings-buttons button').click()`);
    if (!await js(`[...document.querySelectorAll('.model-panel input,.model-panel select,.model-panel button')].every(el=>el.disabled)`)) throw new Error('Connection fields remain editable during test');
    await until(async () => await js(`document.querySelector('.save-message')?.textContent.includes('本次测试未保存')`), 'cloud draft test feedback');
    if (!resolved || resolved.config.baseUrl !== 'https://api.deepseek.com' || resolved.key !== 'deepseek-test-key' || store.get().provider !== 'custom' || store.public().profiles.deepseek.hasKey) throw new Error('Test target/key isolation failed');
    const packet = packets[before];
    const image = packet.messages[0].content.find((part: any) => part.type === 'image_url').image_url.url;
    if (packet.model !== 'deepseek-flash' || packet.messages.length !== 1 || nativeImage.createFromDataURL(image).getSize().width !== 32) throw new Error('Test did not use synthetic image');
  } finally { store.testConnection = originalTest; }
  await click('.settings-buttons button:last-child');
  await until(() => store.get().provider === 'deepseek', 'explicit provider save');
  if (store.key() !== 'deepseek-test-key' || store.public().profiles.custom.hasKey) throw new Error('Saved key assigned to wrong profile');
  win.webContents.reload(); await until(() => !win.webContents.isLoading(), 'reload');
  await until(async () => await value('select[aria-label="服务商"]') === 'deepseek', 'selected provider survives reload');
  if (await value('input[type=password]') !== '' || !await js(`document.querySelector('input[type=password]').placeholder.includes('保留')`)) throw new Error('Saved secret exposed / missing state');
  await click('.connection-options .text-button'); await select('服务商', 'custom');
  await click('.settings-buttons button:last-child'); await until(() => store.get().provider === 'custom', 'restore custom');
  if (store.key('deepseek') !== 'deepseek-test-key') throw new Error('Clear flag leaked between providers');
  await select('服务商', 'deepseek'); await click('.connection-options .text-button'); await click('.settings-buttons button:last-child');
  await until(() => !store.public().profiles.deepseek.hasKey, 'clear provider secret');
  await select('服务商', 'custom');
  if (await value('input[type=url]') !== localBase) throw new Error('Custom address lost');
  await click('.settings-buttons button:last-child'); await until(() => store.get().provider === 'custom', 'restore active profile');
  await input('#answer-font-size', '16'); await until(() => store.get().answerFontSize === 16, 'restore font');
  win.setSize(700, 400); await delay(100);
  for (const provider of ['custom', 'deepseek', 'doubao']) { await select('服务商', provider); await checkLayout(); await snapshot(`settings-provider-${provider}-narrow.png`); }
  await select('服务商', 'custom'); win.setSize(900, 560);
  packets.length = 0;
}
