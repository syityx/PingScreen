/** Local integration runner. Only reached with --smoke in an unpackaged build. */
import { app, clipboard, screen, shell, type BrowserWindow, type Display } from 'electron';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HelperEvent } from '../shared/protocol';
import type { CardState, Point, StageState, TranslationMode } from '../shared/types';
import type { SettingsStore } from './settings';
import { version } from '../../package.json';
import { runCardLayoutSmoke } from './smokeCardLayout';
import { runProviderSmoke } from './smokeProviders';
import { runSettingsInterfaceSmoke } from './smokeSettingsInterface';
interface SmokeSession { id: string; card?: CardState; stage?: StageState; origin: Point; wheelCenter: Point; release?: Point; translationMode: TranslationMode; display: Display; request?: AbortController }
export interface Harness { handle(event: HelperEvent): void; getSession(): SmokeSession | undefined; getSettings(): BrowserWindow | undefined; getCard(): BrowserWindow | undefined; getStage(): BrowserWindow | undefined; store: SettingsStore; closeSession(): void }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown | Promise<unknown>, label: string, timeout = 8000): Promise<void> {
  const start = Date.now(); while (!await test()) { if (Date.now() - start > timeout) throw new Error('Timed out: ' + label); await delay(25); }
}
export async function runSmoke(h: Harness): Promise<void> {
  const forcedScale=app.commandLine.getSwitchValue('smoke-reading-scale') || app.commandLine.getSwitchValue('force-device-scale-factor');
  const dir = join(app.getAppPath(), '.tools/smoke', forcedScale ? `dpi-${Math.round(Number(forcedScale)*100)}` : ''); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir,'progress.log'), 'Starting smoke\n');
  const progress = (text: string) => appendFileSync(join(dir,'progress.log'), text + '\n');
  const deadline = setTimeout(() => { progress('Global timeout'); app.exit(1); }, 120000);
  const results: string[] = [];
  const packets: any[] = [];
  let failNextRequest=false;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const packet = JSON.parse(body); packets.push(packet);
    if(failNextRequest) { failNextRequest=false; res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'模拟模型暂时不可用'}}));return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({choices:[{delta:{content:'这里是**定位区域**，先看目标本身。'}}]}) + '\n\n');
    await delay(80);
    res.end('data: ' + JSON.stringify({choices:[{delta:{content:'\n\n- 第一项说明\n- 第二项说明\n\n`Alt` + 拖动\n\n```text\n示例内容\n```\n\n[查看帮助](https://example.com/help)\n\n![不应加载远程图片](https://example.com/tracking.png)'}}]}) + '\n\ndata: [DONE]\n\n');
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    progress('Server listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server');
    progress('Saving fixture settings');
    h.store.save({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'smoke-vision', clearKey: true, wheelSlots: 5, trigger: 'alt', dragThresholdPx: 8, launchAtStartup: false, stream: true, answerFontSize:16 });
    progress('Fixture settings saved');
    await until(() => h.getSettings()?.webContents.isLoading() === false, 'settings loaded'); await delay(200);
    progress('Settings loaded');
    const settings = h.getSettings()!;
    const workArea = screen.getPrimaryDisplay().workArea;
    const initialSettings = settings.getBounds();
    // Forced fractional DPI can round the native framed window's invisible borders by 2–3 DIP.
    const frameRounding = forcedScale ? 4 : 1;
    if (Math.abs(initialSettings.width - Math.max(700, Math.min(900, workArea.width))) > frameRounding || Math.abs(initialSettings.height - Math.max(400, Math.min(560, workArea.height))) > frameRounding || settings.getMinimumSize().join(',') !== '700,400' || !settings.isResizable() || !settings.isMovable()) throw new Error('Settings window geometry mismatch: ' + JSON.stringify(initialSettings));
    const title = await Promise.race([settings.webContents.executeJavaScript('document.querySelector("h1")?.textContent'), delay(3000).then(() => { throw new Error('Settings renderer evaluation timed out'); })]);
    progress('Settings evaluated: ' + title);
    if (title !== '设置') throw new Error('Settings failed to render');
    await snapshot(settings, join(dir,'settings.png')); results.push('Settings renderer and sandboxed preload');
    const checkLayout = async (win: BrowserWindow, label: string) => {
      const layout = await win.webContents.executeJavaScript(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,contentFits:!document.querySelector('.settings-content')||document.querySelector('.settings-content').scrollWidth<=document.querySelector('.settings-content').clientWidth,icons:[...document.querySelectorAll('.icon')].every(el=>getComputedStyle(el).maskImage!=='none'&&el.getBoundingClientRect().width>0),logos:[...document.querySelectorAll('.product-logo')].every(el=>el.complete&&el.naturalWidth>0&&getComputedStyle(el).objectFit==='contain'),background:getComputedStyle(document.querySelector('.settings-content')||document.querySelector('.card-shell')).backgroundColor})`);
      if (layout.scrollWidth > layout.width || !layout.icons || !layout.logos || !layout.contentFits) throw new Error('UI overflow / missing assets in '+label+': '+JSON.stringify(layout));
    };
    if(settings.isMenuBarVisible()) throw new Error('Native menu bar is still visible');
    const navigateSettings = async (tab: string) => {
      await settings.webContents.executeJavaScript(`(async()=>{
        document.querySelector('[data-tab=${tab}]').click();
        const root=document.querySelector('.settings-content'),section=document.querySelector('[data-section=${tab}]'),start=performance.now();
        while(performance.now()-start<3000){
          const target=Math.min(section.offsetTop,root.scrollHeight-root.clientHeight);
          if(Math.abs(root.scrollTop-target)<2 && document.querySelector('.nav-item.active')?.dataset.tab==='${tab}') return;
          await new Promise(resolve=>setTimeout(resolve,25));
        }throw new Error('Navigation failed: ${tab}');
      })()`);
    };
    const scrollStyles=await settings.webContents.executeJavaScript(`({snap:getComputedStyle(document.querySelector('.settings-content')).scrollSnapType,smooth:getComputedStyle(document.querySelector('.settings-content')).scrollBehavior,sections:document.querySelectorAll('[data-section]').length})`);
    if(scrollStyles.snap!=='none'||scrollStyles.sections!==4) throw new Error('Unexpected settings scroll snap: '+JSON.stringify(scrollStyles));
    const settingsCopy = await settings.webContents.executeJavaScript(`({extra:document.querySelectorAll('.settings-heading>p,.settings-row p,.note,.security-panel,.test-note,.panel-heading,.field-note,.wheel-help,.status-action-label,.autosave-message').length,ready:document.querySelector('.runtime-status h2').textContent,hint:!!document.querySelector('.runtime-status p'),key:document.querySelector('input[type=password]').placeholder})`);
    if(settingsCopy.extra || settingsCopy.hint || settingsCopy.ready!=='已就绪' || settingsCopy.key!=='本地服务可留空') throw new Error('Concise settings copy failed: '+JSON.stringify(settingsCopy));
    await settings.webContents.executeJavaScript(`const field=document.querySelector('input[placeholder="填写支持图片输入的模型名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'draft-model');field.dispatchEvent(new Event('input',{bubbles:true}))`);
    for (const tab of ['gesture','wheel','app']) {
      await navigateSettings(tab);
      await checkLayout(settings,tab); await snapshot(settings,join(dir,'settings-'+tab+'.png'));
    }
    const copyright=await settings.webContents.executeJavaScript(`document.querySelector('.copyright').textContent`);
    if(!copyright.includes('MIT')||!copyright.includes('lolPing')||!copyright.includes('Danrui Meng')) throw new Error('Attribution missing');
    const compact=await settings.webContents.executeJavaScript(`(()=>{
      const sections=[...document.querySelectorAll('[data-section]')];
      return {natural:sections.every(section=>getComputedStyle(section).minHeight==='0px'),
        gaps:sections.slice(0,-1).map(section=>section.nextElementSibling.querySelector('.settings-heading').getBoundingClientRect().top-section.lastElementChild.getBoundingClientRect().bottom),
        about:[...document.querySelectorAll('.about-panel>*')].map(el=>el.textContent),
        appText:document.querySelector('[data-section=app]').textContent,
        link:document.querySelector('.copyright a')?.getAttribute('href')};
    })()`);
    if(!compact.natural||compact.gaps.some((gap:number)=>gap>33)||JSON.stringify(compact.about)!==JSON.stringify([`pingscreen ${version}`,'Windows 桌面 AI 助手'])||compact.appText.includes('当前会话，不保存历史')||compact.link!=='https://github.com/darrenprx/lolPing') throw new Error('Compact settings / release identity / project link failed: '+JSON.stringify(compact));
    if((await settings.webContents.executeJavaScript(`document.querySelector('.sidebar-help').textContent`)).includes('UI Demo')) throw new Error('Release sidebar still shows Demo');
    const originalOpenExternal=shell.openExternal, openedLinks:string[]=[];
    shell.openExternal=async(url:string)=>{openedLinks.push(url);};
    try {
      await settings.webContents.executeJavaScript(`document.querySelector('.copyright a').click()`);
      await until(()=>openedLinks.length===1,'lolPing project link');
      if(openedLinks[0]!=='https://github.com/darrenprx/lolPing') throw new Error('Wrong project link');
    } finally { shell.openExternal=originalOpenExternal; }
    await navigateSettings('model');
    if(await settings.webContents.executeJavaScript(`document.querySelector('input[placeholder="填写支持图片输入的模型名称"]').value`)!=='draft-model') throw new Error('Navigation lost settings draft');
    await settings.webContents.executeJavaScript(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('input[placeholder="填写支持图片输入的模型名称"]'),'smoke-vision');document.querySelector('input[placeholder="填写支持图片输入的模型名称"]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="启用屏幕手势"]').click()`);
    await delay(120);
    if(await settings.webContents.executeJavaScript(`document.querySelector('[aria-label="启用屏幕手势"]').getAttribute('aria-checked')`)!=='false') throw new Error('Settings pause toggle failed');
    await settings.webContents.executeJavaScript(`document.querySelector('[aria-label="启用屏幕手势"]').click()`); await delay(120);
    if(await settings.webContents.executeJavaScript(`document.querySelector('[aria-label="启用屏幕手势"]').getAttribute('aria-checked')`)!=='true') throw new Error('Settings resume toggle failed');
    const editField = async (selector: string, value: string) => settings.webContents.executeJavaScript(`(()=>{const field=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await editField('input[type=url]','not-a-valid-url');
    await settings.webContents.executeJavaScript(`(()=>{const trigger=document.querySelector('[aria-label="触发键"]');trigger.value='ctrl';trigger.dispatchEvent(new Event('change',{bubbles:true}));const slider=document.querySelector('[aria-label="拖动阈值"]');for(const value of ['29','15']){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,value);slider.dispatchEvent(new Event('input',{bubbles:true}));}document.querySelector('[aria-label="开机启动"]').click();})()`);
    await until(()=>h.store.get().trigger==='ctrl'&&h.store.get().dragThresholdPx===15&&h.store.get().launchAtStartup,'immediate non-model settings');
    if(h.store.get().baseUrl!==`http://127.0.0.1:${address.port}/v1`) throw new Error('Auto-save persisted a model draft');
    if(await settings.webContents.executeJavaScript(`document.querySelector('input[type=url]').value`)!=='not-a-valid-url') throw new Error('Auto-save overwrote the model draft');
    await navigateSettings('app');
    const fontControl = await settings.webContents.executeJavaScript(`(()=>{const el=document.querySelector('#answer-font-size');return {min:el.min,max:el.max,step:el.step,value:el.value,label:el.getAttribute('aria-label')};})()`);
    if(JSON.stringify(fontControl)!==JSON.stringify({min:'14',max:'24',step:'1',value:'16',label:'回答字号'})) throw new Error('Font range/default mismatch: '+JSON.stringify(fontControl));
    for(const value of ['20','24','18']) await editField('#answer-font-size',value);
    await until(()=>h.store.get().answerFontSize===18,'rapid font preference saves');
    if(await settings.webContents.executeJavaScript(`document.querySelector('#answer-font-size+output').textContent`)!=='18 px') throw new Error('Font output missing');
    const persisted = JSON.parse(readFileSync(join(app.getAppPath(),'.tools/smoke/config/settings.json'),'utf8'));
    if(persisted.answerFontSize!==18 || persisted.profiles.custom.model!=='smoke-vision' || persisted.profiles.custom.baseUrl!==`http://127.0.0.1:${address.port}/v1`) throw new Error('Font persistence changed model settings');
    if(await settings.webContents.executeJavaScript(`document.querySelector('input[type=url]').value`)!=='not-a-valid-url') throw new Error('Font auto-save replaced model draft');
    const saveBeforeFontFailure=h.store.save.bind(h.store);
    try {
      h.store.save=(raw:unknown)=>{if((raw as any)?.answerFontSize===23)throw new Error('模拟字号保存失败');return saveBeforeFontFailure(raw);};
      await editField('#answer-font-size','23');
      await delay(180);
      if(h.store.get().answerFontSize!==18 || await settings.webContents.executeJavaScript(`document.querySelector('#answer-font-size').value`)!=='18') throw new Error('Font save failure did not restore persisted preference');
      if(!(await settings.webContents.executeJavaScript(`document.querySelector('[data-section=app] .autosave-message').textContent`)).includes('自动保存失败')) throw new Error('Font save failure hidden');
    } finally { h.store.save=saveBeforeFontFailure; }
    await editField('#answer-font-size','16');
    await until(()=>h.store.get().answerFontSize===16,'restore default reading preference');
    await until(async()=>await settings.webContents.executeJavaScript(`document.querySelector('#answer-font-size').value`)==='16','restore font control');
    await until(async()=>await settings.webContents.executeJavaScript(`document.querySelector('.autosave-message')===null`),'successful automatic save has no feedback');
    await navigateSettings('app');
    await snapshot(settings,join(dir,'settings-reading.png'));
    results.push('Answer font range 14-24/default 16/step 1; rapid automatic saves; persisted reload value; failed save rollback; model drafts isolated');
    const originalSave=h.store.save.bind(h.store);
    h.store.save=(raw:unknown)=>{if((raw as any)?.wheelSlots===4)throw new Error('模拟保存失败');return originalSave(raw);};
    await settings.webContents.executeJavaScript(`document.querySelector('[aria-pressed="false"]').click()`);await delay(180);
    if(h.store.get().wheelSlots!==5||await settings.webContents.executeJavaScript(`document.querySelector('.layout-options button[aria-pressed=true]').textContent`)!=='五项 · 包含框选') throw new Error('Failed auto-save did not restore the persisted value');
    if(!(await settings.webContents.executeJavaScript(`document.querySelector('.autosave-message').textContent`)).includes('自动保存失败')) throw new Error('Auto-save failure hidden');
    h.store.save=originalSave;
    await settings.webContents.executeJavaScript(`document.querySelector('.layout-options button[aria-pressed=false]').click()`);
    await until(()=>h.store.get().wheelSlots===4,'automatic wheel layout persistence');
    await settings.webContents.executeJavaScript(`(()=>{document.querySelector('.layout-options button[aria-pressed=false]').click();const trigger=document.querySelector('[aria-label="触发键"]');trigger.value='alt';trigger.dispatchEvent(new Event('change',{bubbles:true}));const slider=document.querySelector('[aria-label="拖动阈值"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,'8');slider.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[aria-label="开机启动"]').click();})()`);
    await until(()=>h.store.get().wheelSlots===5&&h.store.get().trigger==='alt'&&h.store.get().dragThresholdPx===8&&!h.store.get().launchAtStartup,'restored automatic settings');
    await editField('input[type=url]',`http://127.0.0.1:${address.port}/v1`);
    await editField('input[placeholder="填写支持图片输入的模型名称"]','unsaved-vision');
    await editField('input[type=password]','test-only-key');
    const actions=await settings.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-buttons button')].map(button=>button.textContent)`);
    if(JSON.stringify(actions)!==JSON.stringify(['测试连接','保存'])) throw new Error('Expected only separate test and save actions');
    await settings.webContents.executeJavaScript(`document.querySelector('.settings-buttons button').click()`);
    await until(()=>packets.length>0,'draft connection test request');await delay(180);
    if(packets.at(-1).model!=='unsaved-vision'||h.store.get().model!=='smoke-vision'||h.store.public().hasKey) throw new Error('Test did not use the draft / accidentally saved model or key');
    await editField('input[type=password]','');
    await settings.webContents.executeJavaScript(`document.querySelector('.settings-buttons button:last-child').click()`);
    await until(()=>h.store.get().model==='unsaved-vision','separate explicit model save');await delay(80);
    await editField('input[placeholder="填写支持图片输入的模型名称"]','smoke-vision');
    await settings.webContents.executeJavaScript(`document.querySelector('.settings-buttons button:last-child').click()`);
    await until(()=>h.store.get().model==='smoke-vision','restore model');await delay(80);packets.length=0;
    results.push('Immediate non-model saves with rapid edits; failure rollback; invalid model drafts isolated; exactly test/save buttons; draft model/key test does not save; explicit model save');
    await navigateSettings('model');
    await runProviderSmoke(settings, h.store, `http://127.0.0.1:${address.port}/v1`, packets);
    results.push('Provider dropdowns, keyboard selection, DeepSeek-Flash, custom local synthetic-image request, per-provider drafts and secrets, explicit save/reload/clear and narrow layout; cloud network simulated');
    await runSettingsInterfaceSmoke(settings, dir);
    await navigateSettings('model');
    results.push('Compact 15px/20px settings, 900x560 default/700x400 minimum, collapsible accessible sidebar, failure-only auto-save, natural scrolling and interruptible latest-target navigation; see settings-interface.json');
    progress('Settings preview attempted');
    if (app.commandLine.hasSwitch('smoke-settings-only')) {
      writeFileSync(join(dir,'results.json'),JSON.stringify({passed:results,scope:'settings'},null,2));
      clearTimeout(deadline); console.log('SETTINGS SMOKE PASSED'); server.close(); app.quit(); return;
    }
    const d = screen.getPrimaryDisplay();
    const physical = screen.dipToScreenRect(null, d.bounds);
    const origin = { x: physical.x + Math.round(physical.width/2), y: physical.y + Math.round(physical.height/2) };
    const emit = (type: 'wheelOpen' | 'wheelMove' | 'wheelRelease', x: number, y: number) => h.handle({ type, x, y, wheel: 'ping' });
    emit('wheelOpen',origin.x,origin.y); emit('wheelMove',origin.x,origin.y-90); emit('wheelRelease',origin.x,origin.y-90);
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'done', 'fast release / model completion');
    progress('Fast release answered');
    if (!packets[0].messages[1].content[1].image_url.url.startsWith('data:image/png;base64,')) throw new Error('No complete image sent');
    if (!packets[0].messages[1].content[0].text.includes('point')) throw new Error('No coordinates');
    if (packets[0].messages[1].content.filter((part: any) => part.type === 'image_url').length !== 2) throw new Error('Missing focus detail');
    results.push('Release buffered during capture; full annotated screen and coordinates submitted');
    const card = h.getCard()!; await delay(150);
    await until(async()=>await card.webContents.executeJavaScript(`document.querySelector('.answer strong')?.textContent`)==='定位区域','Markdown module ready');
    if (!(await card.webContents.executeJavaScript('document.querySelector(".answer")?.textContent')).includes('定位区域')) throw new Error('No answer UI');
    const markdown = await card.webContents.executeJavaScript('({bold:document.querySelector(".answer strong")?.textContent,items:document.querySelectorAll(".answer li").length,code:document.querySelector(".answer pre code")?.textContent,images:document.querySelectorAll(".answer img").length,link:document.querySelector(".answer .inline-link")?.textContent,question:document.querySelector(".question-label")?.textContent})');
    if(markdown.bold !== '定位区域' || markdown.items !== 2 || !markdown.code?.includes('示例内容') || markdown.images !== 0 || markdown.link !== '查看帮助' || markdown.question !== undefined) throw new Error('Markdown/hidden task label failed: '+JSON.stringify(markdown));
    results.push('Markdown bold, lists, code and clickable links; remote images disabled; generated task label hidden; focus detail retained');
    await card.webContents.executeJavaScript(`document.querySelector('.card-scroll').scrollTop=0`);
    await snapshot(card, join(dir,'card.png'));
    await checkLayout(card,'answer card');
    const fixture = h.getSession()!.card!;
    const init = await card.webContents.executeJavaScript('window.pingscreen.init()');
    if(init.card?.answerFontSize!==16 || init.card?.capturedAt!==fixture.capturedAt || 'settings' in init) throw new Error('Card init lost the font/metadata or exposed full settings');
    const assertCardChrome = async () => {
      const chrome = await card.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.composer textarea'),send=document.querySelector('.composer-send'),header=document.querySelector('.card-header'),shell=document.querySelector('.card-shell'),composer=document.querySelector('.composer');return {header:header.textContent,buttons:header.querySelectorAll('button').length,previews:document.querySelectorAll('.snapshot,.preview,.intent-badge').length,screenImages:document.querySelectorAll('.card-scroll img').length,footer:composer.textContent,placeholder:input.getAttribute('placeholder'),label:input.getAttribute('aria-label'),sendText:send.textContent,sendWidth:send.getBoundingClientRect().width,sendHeight:send.getBoundingClientRect().height,sendRadius:getComputedStyle(send).borderRadius,headerHeight:header.getBoundingClientRect().height,surface:getComputedStyle(shell).backgroundColor,composerSurface:getComputedStyle(composer).backgroundColor,inline:input.getBoundingClientRect().right<send.getBoundingClientRect().left};})()`);
      if(chrome.header!=='PingScreen' || chrome.buttons!==1 || chrome.previews || chrome.screenImages || chrome.footer || chrome.placeholder!==null || !chrome.label || chrome.sendText || chrome.sendWidth!==40 || chrome.sendHeight!==40 || chrome.sendRadius!=='50%' || chrome.headerHeight>57 || chrome.surface!=='rgb(255, 255, 255)' || chrome.composerSurface!=='rgb(255, 255, 255)' || !chrome.inline) throw new Error('Minimal card chrome failed: '+JSON.stringify(chrome));
    };
    await assertCardChrome();
    const cardBounds=card.getContentBounds();
    if(cardBounds.width!==640 || cardBounds.height<160 || cardBounds.height>640 || cardBounds.x<d.workArea.x || cardBounds.y<d.workArea.y || cardBounds.x+cardBounds.width>d.workArea.x+d.workArea.width || cardBounds.y+cardBounds.height>d.workArea.y+d.workArea.height) throw new Error('Dynamic card dimensions/work area failed: '+JSON.stringify(cardBounds));
    const writeClipboard=clipboard.writeText;
    let copiedText='';
    try {
      clipboard.writeText=async(text:string)=>{await delay(20);copiedText=text;};
      await card.webContents.executeJavaScript(`document.querySelector('.answer-tools button').click()`);
      await until(async()=>await card.webContents.executeJavaScript(`document.querySelector('.composer-notice').textContent`)==='已复制回答','copy success feedback');
      if(copiedText!==fixture.turns[0].answer) throw new Error('Copy action or feedback failed');
      clipboard.writeText=async()=>{throw new Error('模拟复制失败');};
      await card.webContents.executeJavaScript(`document.querySelector('.answer-tools button').click()`);
      await until(async()=>String(await card.webContents.executeJavaScript(`document.querySelector('.composer-notice').textContent`)).includes('模拟复制失败'),'copy failure feedback');
    } finally { clipboard.writeText=writeClipboard; }
    const openLink=shell.openExternal, cardLinks:string[]=[];
    try {
      shell.openExternal=async(url:string)=>{cardLinks.push(url);};
      await card.webContents.executeJavaScript(`document.querySelector('.answer .inline-link').click()`);
      await until(()=>cardLinks.length===1,'answer link');
      if(cardLinks[0]!=='https://example.com/help') throw new Error('Answer opened wrong link');
    } finally { shell.openExternal=openLink; }
    results.push('640px wide dynamic white card; brand and X header; no screenshot DOM; empty inline composer and 40px arrow circle; metadata retained; mocked clipboard feedback and links');
    const showFixture = async (name: string, patch: Partial<CardState>) => {
      card.webContents.send('pingscreen:event',{type:'card',state:null});
      card.webContents.send('pingscreen:event',{type:'card',state:{...fixture,id:fixture.id+'-preview',...patch}});await delay(150);await checkLayout(card,name);await assertCardChrome();await snapshot(card,join(dir,name+'.png'));
    };
    await showFixture('card-custom',{intent:'custom',awaitingQuestion:true,turns:[]});
    await assertCardChrome();
    if(await card.webContents.executeJavaScript(`document.querySelector('.card-scroll').textContent`)!=='') throw new Error('Empty card has explanatory text');
    await showFixture('card-generating',{turns:[{question:'解释这里',answer:'这句话强调好的设计可以降低理解和使用的难度。',status:'generating'}]});
    await showFixture('card-error',{turns:[{question:'解释这里',answer:'',status:'error',error:'无法连接模型服务，请检查服务地址或 API Key 后重试。'}]});
    await showFixture('card-stopped',{turns:[{question:'解释这里',answer:'已生成的内容仍可复制。',status:'stopped'}]});
    await showFixture('card-restored',{});
    await showFixture('card-minimal',{turns:[{question:'解释这里',answer:'好的设计会让信息更容易理解。\n\n将重要内容放在清晰的位置，减少重复说明，让阅读和操作自然发生。',status:'done'}]});
    await assertCardChrome();
    results.push('Minimal white card states: completed, empty custom input, generating, error and stopped; no screenshot preview');
    const readingAnswer = '## 更轻松地阅读回答\n\n正文、列表、代码和表格会跟随你选择的字号。'+ '这段较长的中文回答用于检查换行、滚动和内容完整性。'.repeat(8)
      +'\n\n- 第一项说明\n- 第二项说明\n\n`Alt` + 拖动\n\n```text\n'+ 'wide_code_'.repeat(24)
      +'\n```\n\n| 项目 | 内容 | 说明 | 结果 |\n| --- | --- | --- | --- |\n| 回答 | '+ '连续英文内容'.repeat(10) +' | 可横向滚动 | 正常 |\n\n[查看帮助](https://example.com/help)\n\n回答结束。';
    const readingChecks:unknown[]=[];
    const readingEnvironment={forcedScale:forcedScale||null,offscreen:true,display:{bounds:d.bounds,workArea:d.workArea,scaleFactor:d.scaleFactor}};
    writeFileSync(join(dir,'reading-layout.json'),JSON.stringify({...readingEnvironment,checks:readingChecks},null,2));
    // Permit fixture resizing; production cards remain fixed-size.
    card.setResizable(true);
    if(forcedScale) card.webContents.debugger.attach('1.3');
    for(const [width,height] of [[640,640],[480,480],[320,200]]) {
      card.setSize(width,height);
      if(forcedScale) await card.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:Number(forcedScale),mobile:false});
      for(const fontSize of [14,16,24]) {
        const name=`reading-${width}-${fontSize}`;
        await showFixture(name,{answerFontSize:fontSize,turns:[{question:'解释这里',answer:readingAnswer,status:'done'}]});
        const layout=await card.webContents.executeJavaScript(`(()=>{
          const answer=document.querySelector('.answer'),pane=document.querySelector('.card-scroll'),composer=document.querySelector('.composer'),input=document.querySelector('.composer textarea'),send=document.querySelector('.composer-send'),pre=answer.querySelector('pre'),table=answer.querySelector('table'),header=document.querySelector('.card-header');
          pane.scrollTop=pane.scrollHeight;
          const bottomReached=pane.scrollTop+pane.clientHeight>=pane.scrollHeight-2;
          pane.scrollTop=0;
          return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,font:parseFloat(getComputedStyle(answer).fontSize),heading:parseFloat(getComputedStyle(answer.querySelector('h2')).fontSize),code:parseFloat(getComputedStyle(pre.querySelector('code')).fontSize),table:parseFloat(getComputedStyle(table).fontSize),input:parseFloat(getComputedStyle(input).fontSize),header:header.getBoundingClientRect().height,preScroll:getComputedStyle(pre).overflowX,tableScroll:getComputedStyle(table).overflowX,preWide:pre.scrollWidth>pre.clientWidth,bodyFits:document.documentElement.scrollWidth<=innerWidth,bottomReached,composerBottom:composer.getBoundingClientRect().bottom,sendBottom:send.getBoundingClientRect().bottom,paneHeight:pane.clientHeight,complete:answer.textContent.includes('回答结束。')};
        })()`);
        // Native fractional DPI can round window geometry by one logical pixel.
        const failures=Object.entries({size:Math.abs(layout.width-width)>1||Math.abs(layout.height-height)>1,dpi:!!forcedScale&&Math.abs(layout.dpr-Number(forcedScale))>.01,font:layout.font!==fontSize,heading:Math.abs(layout.heading-fontSize*1.25)>.05,code:Math.abs(layout.code-fontSize*.95)>.05,table:Math.abs(layout.table-fontSize*.95)>.05,input:layout.input!==14,header:layout.header>57,wideCode:!layout.preWide,codeScroll:layout.preScroll!=='auto',tableScroll:layout.tableScroll!=='auto',body:!layout.bodyFits,bottom:!layout.bottomReached,content:!layout.complete,pane:layout.paneHeight<1,composer:layout.composerBottom>layout.height,send:layout.sendBottom>layout.height}).filter(([,failed])=>failed).map(([name])=>name);
        if(failures.length) throw new Error('Reading layout failed: '+JSON.stringify({expected:{fontSize,width,height},failures,layout}));
        readingChecks.push(layout);
        await snapshot(card,join(dir,name+'.png'));
        const scrollable=await card.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.answer pre');el.scrollLeft=el.scrollWidth;return el.scrollLeft>0;})()`);
        if(!scrollable) throw new Error('Wide code is not horizontally reachable');
      }
    }
    if(forcedScale) { await card.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');card.webContents.debugger.detach(); }
    card.setSize(640,640);
    card.setResizable(false);
    await showFixture('card-reading-default',{answerFontSize:16,turns:[{question:'解释这里',answer:readingAnswer,status:'done'}]});
    if(await card.webContents.executeJavaScript(`document.querySelector('.snapshot,.preview')!==null`)) throw new Error('Captured image is exposed by a preview');
    await showFixture('card-no-screenshot',{id:fixture.id+'-no-screenshot',image:'',answerFontSize:24,turns:[{question:'解释这里',answer:readingAnswer,status:'done'}]});
    if(await card.webContents.executeJavaScript(`document.querySelector('.snapshot')!==null`)) throw new Error('Missing screenshot still exposed an entry');
    await showFixture('card-restored',{id:fixture.id});
    results.push('Reading matrix at 14/16/24px and 640x640/480x480/320x200; relative Markdown sizes; wide code scrolling; complete answer reachable; stable inline composer; no screenshots');
    writeFileSync(join(dir,'reading-layout.json'),JSON.stringify({...readingEnvironment,checks:readingChecks},null,2));
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"question",id:' + JSON.stringify(h.getSession()!.id) + ',text:"如何修复？"})');
    await until(() => h.getSession()?.card?.turns.length === 2 && h.getSession()?.card?.turns.at(-1)?.status === 'done', 'follow-up');
    await until(async()=>await card.webContents.executeJavaScript(`document.querySelector('.question-label')?.textContent`)==='如何修复？','user follow-up label preserved');
    if (packets[1].messages.at(-1).content !== '如何修复？' || h.getSession()?.card?.answerFontSize!==16 || await card.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.answer')).fontSize`)!=='16px') throw new Error('Follow-up lost the question or font'); results.push('Streamed card and same screenshot follow-up with stable font and user-authored question retained');
    const translatePoint = (slots: number) => {
      const angle = -Math.PI/2+2*Math.PI/slots;
      return {x:origin.x+Math.round(Math.cos(angle)*90*d.scaleFactor),y:origin.y+Math.round(Math.sin(angle)*90*d.scaleFactor)};
    };
    const scroll = (delta: number, point = translatePoint(5)) => h.handle({type:'wheelScroll',...point,delta,wheel:'ping'});
    const tp = translatePoint(5), beforeTranslation = packets.length;
    // Mode selection/release may arrive before the immutable frame or PNG.
    emit('wheelOpen',origin.x,origin.y); emit('wheelMove',tp.x,tp.y); scroll(120); emit('wheelRelease',tp.x,tp.y);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status === 'done','early line translation');
    const linePacket = packets[beforeTranslation];
    if(!linePacket.messages[1].content[0].text.includes('翻译模式：条') || h.getSession()?.card?.target.kind !== 'point') throw new Error('Line mode changed selection geometry or lost early scroll');
    if(h.getSession()?.card?.translationMode !== 'line') throw new Error('Line card badge missing');
    await snapshot(card,join(dir,'translation-card.png'));
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"question",id:'+JSON.stringify(h.getSession()!.id)+',text:"译成英文"})');
    await until(()=>h.getSession()?.card?.turns.length===2 && h.getSession()?.card?.turns.at(-1)?.status==='done','line follow-up');
    if(!packets.at(-1).messages[1].content[0].text.includes('翻译模式：条') || packets.at(-1).messages.at(-1).content!=='译成英文') throw new Error('Line scope lost on follow-up');
    emit('wheelOpen',origin.x,origin.y); emit('wheelMove',tp.x,tp.y);
    await until(()=>h.getSession()?.stage?.image,'translation wheel ready');
    const translationStage=h.getStage()!;
    if(h.getSession()?.translationMode!=='point') throw new Error('New gesture did not reset to point mode');
    let modePackets=0;
    const originalSend=translationStage.webContents.send.bind(translationStage.webContents);
    translationStage.webContents.send=((channel:string,event:any)=>{if(event.type==='translationMode'){modePackets++;if('image' in event || JSON.stringify(event).length>160)throw new Error('Mode change re-sends image');}originalSend(channel,event);}) as typeof translationStage.webContents.send;
    scroll(30);scroll(30);scroll(30);
    if(h.getSession()?.translationMode!=='point') throw new Error('Precision scroll flipped too early');
    scroll(30);
    if(h.getSession()?.translationMode!=='line') throw new Error('Full scroll did not flip');
    scroll(-120);
    if(h.getSession()?.translationMode!=='point') throw new Error('Reverse scroll did not flip back');
    scroll(120);
    emit('wheelMove',origin.x,origin.y-90); scroll(120,{x:origin.x,y:origin.y-90});
    if(h.getSession()?.translationMode!=='line') throw new Error('Non-translation sector changed translation mode');
    emit('wheelMove',tp.x,tp.y);
    translationStage.webContents.send=originalSend;
    if(modePackets!==3) throw new Error('Unexpected mode update count');
    await delay(120);
    const modeLabel=await translationStage.webContents.executeJavaScript('document.querySelector("[data-action=translate]")?.getAttribute("aria-label")');
    if(modeLabel!=='翻译 · 条') throw new Error('Wheel mode label missing: '+modeLabel);
    if(await translationStage.webContents.executeJavaScript(`!!document.querySelector('.stage-hint') || !document.querySelector('.wheel-caption').textContent.includes('条')`)) throw new Error('Translation banner shown or nearby scope hidden');
    if(await translationStage.webContents.executeJavaScript(`document.querySelectorAll('.wheel text').length`)!==0) throw new Error('Wheel should contain icons only');
    await snapshot(translationStage,join(dir,'translation-wheel.png'));
    h.handle({type:'cancel'}); await delay(180);
    if(h.getSession()) throw new Error('Cancelled translation mode revived');
    const pointPacketIndex=packets.length;
    emit('wheelOpen',origin.x,origin.y);emit('wheelMove',tp.x,tp.y);emit('wheelRelease',tp.x,tp.y);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done','point translation');
    const pointPacket=packets[pointPacketIndex];
    if(!pointPacket.messages[1].content[0].text.includes('翻译模式：点')) throw new Error('Default translation did not use point prompt');
    if(JSON.stringify(pointPacket.messages[1].content.slice(1))!==JSON.stringify(linePacket.messages[1].content.slice(1))) throw new Error('Prompt mode unexpectedly changed the screenshot or detail crop');
    h.store.save({wheelSlots:4}); const four=translatePoint(4);
    emit('wheelOpen',origin.x,origin.y);emit('wheelMove',four.x,four.y);
    await until(()=>h.getSession()?.stage?.image,'four-slot wheel image'); await delay(100);
    if(await h.getStage()!.webContents.executeJavaScript(`!!document.querySelector('.stage-hint') || document.querySelectorAll('.slice').length!==4`)) throw new Error('Four-slot wheel top banner or missing slices');
    await snapshot(h.getStage()!,join(dir,'wheel-four.png'));
    h.handle({type:'cancel'});
    emit('wheelOpen',origin.x,origin.y);emit('wheelMove',four.x,four.y);scroll(120,four);emit('wheelRelease',four.x,four.y);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done','four-slot line translation');
    if(h.getSession()?.card?.translationMode!=='line') throw new Error('Four-slot translation mode failed');
    h.store.save({wheelSlots:5});
    results.push('Point/line prompt switching in four/five-slot wheels; precision and reverse scroll; early release; same image/coordinates; follow-up; cancellation and per-gesture reset; small mode packets');
    // A second gesture cancels the old card and captures a new session.
    emit('wheelOpen',origin.x,origin.y);
    await until(() => h.getSession()?.stage?.mode === 'wheel', 'wheel ready');
    if(h.getSession()?.stage?.image) throw new Error('Wheel unexpectedly waited for PNG');
    const earlyStage=h.getStage()!;
    await delay(30);
    const pendingImage=await earlyStage.webContents.executeJavaScript('document.querySelectorAll(".frozen-screen").length');
    if(pendingImage !== 0) throw new Error('Pending PNG rendered a blank frozen image');
    // Thousands of moves inside one sector should not produce thousands of UI packets.
    emit('wheelMove',origin.x,origin.y-90);
    let cursorPackets=0; const send=earlyStage.webContents.send.bind(earlyStage.webContents);
    earlyStage.webContents.send=((channel: string, event: any)=>{if(event.type==='cursor')cursorPackets++;send(channel,event);}) as typeof earlyStage.webContents.send;
    for(let i=0;i<1000;i++)emit('wheelMove',origin.x+(i%3),origin.y-90);
    emit('wheelMove',origin.x+90,origin.y);
    earlyStage.webContents.send=send;
    if(cursorPackets !== 1) throw new Error('Cursor UI did not coalesce unchanged sectors: '+cursorPackets);
    await until(()=>h.getSession()?.stage?.image, 'frozen PNG arrives'); await delay(150);
    results.push('Wheel visible before PNG; no blank image while pending; 1000 same-sector moves send no redundant UI packets');
    const stage = h.getStage()!;
    if(await stage.webContents.executeJavaScript(`!!document.querySelector('.stage-hint') || !document.querySelector('.wheel-caption')`)) throw new Error('Five-slot banner or missing nearby feedback');
    if(stage.getBounds().width!==d.bounds.width || stage.getBounds().height!==d.bounds.height || card.getBounds().width>640) throw new Error('Settings geometry leaked to another window role');
    await snapshot(stage, join(dir,'wheel.png'));
    // fifth slice: 198 degrees from +x (top + 4*72 degrees).
    emit('wheelRelease',origin.x - Math.round(90*d.scaleFactor),origin.y - Math.round(29*d.scaleFactor));
    await until(() => h.getSession()?.stage?.mode === 'region', 'region mode');
    await until(async()=>await stage.webContents.executeJavaScript(`document.querySelector('.stage-hint')?.textContent.includes('拖动框选')`),'region instruction retained');
    const id = h.getSession()!.id;
    await stage.webContents.executeJavaScript('window.pingscreen.command({type:"region",id:' + JSON.stringify(id) + ',rect:{x:100,y:100,width:250,height:180}})');
    await until(() => h.getSession()?.stage?.mode === 'regionIntent', 'region intent'); await delay(150);
    const slices = await stage.webContents.executeJavaScript('document.querySelectorAll(".slice").length');
    if (slices !== 4) throw new Error('Expected four region intents');
    if(await stage.webContents.executeJavaScript(`!!document.querySelector('.stage-hint')`)) throw new Error('Region intent wheel still shows top banner');
    await snapshot(stage, join(dir,'region.png'));
    await stage.webContents.executeJavaScript('document.querySelector(".slice").dispatchEvent(new MouseEvent("click",{bubbles:true}))');
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'done','region answer');
    if (!packets.at(-1).messages[1].content[0].text.includes('region')) throw new Error('No region sent'); results.push('Five-slot wheel, region selection, four-slot intent wheel and region request');
    emit('wheelOpen',origin.x,origin.y); h.handle({type:'cancel'}); await delay(200);
    if (h.getSession()) throw new Error('Cancelled capture was revived'); results.push('Cancellation invalidates a pending screenshot');
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x,origin.y); await delay(200);
    if (h.getSession()) throw new Error('Centre release did not cancel'); results.push('Centre release cancels');
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x-Math.round(53*d.scaleFactor),origin.y+Math.round(73*d.scaleFactor));
    await until(() => h.getSession()?.card?.awaitingQuestion,'custom question input');
    const customId = h.getSession()!.id;
    const beforeKeyboard=packets.length;
    await card.webContents.executeJavaScript(`(()=>{const el=document.querySelector('.composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'描述这里');el.dispatchEvent(new Event('input',{bubbles:true}));el.focus();el.setSelectionRange(el.value.length,el.value.length);el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));})()`);
    await delay(100);
    if(packets.length!==beforeKeyboard || h.getSession()?.card?.turns.length) throw new Error('IME confirmation incorrectly sent a question');
    card.webContents.sendInputEvent({type:'keyDown',keyCode:'Return',modifiers:['shift']});
    card.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers:['shift']});
    card.webContents.sendInputEvent({type:'keyUp',keyCode:'Return',modifiers:['shift']});
    await until(async()=>String(await card.webContents.executeJavaScript(`document.querySelector('.composer textarea').value`)).includes('\n'),'Shift Enter newline');
    card.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
    card.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'generating','custom generating');
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"stop",id:' + JSON.stringify(customId) + '})');
    await delay(200);
    if(h.getSession()?.card?.turns.at(-1)?.status !== 'stopped') throw new Error('Late model response revived stopped generation');
    results.push('Custom question with actual Enter/Shift Enter input; composing Enter does not send; stopping ignores late response');
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x,origin.y-90);
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'generating','replacement request');
    const replaced = h.getSession()!.id;
    emit('wheelOpen',origin.x,origin.y); h.handle({type:'cancel'}); await delay(200);
    if(h.getSession()) throw new Error('Replaced model response revived '+replaced);
    results.push('New gesture cancels an active request without reviving the old card');
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x,origin.y-90);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done','card before settings');
    await card.webContents.executeJavaScript(`(async()=>{const current=await window.pingscreen.init();await window.pingscreen.command({type:'settings',id:current.card.id});})()`);
    await until(()=>!h.getSession(),'settings closes original answer');
    await editField('#answer-font-size','24');
    await until(()=>h.store.get().answerFontSize===24,'non-default preference saved');
    failNextRequest=true;
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x,origin.y-90);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='error','simulated model failure');
    await until(async()=>await card.webContents.executeJavaScript(`document.querySelector('.error-box')!==null`),'retry UI ready');
    if(h.getSession()?.card?.answerFontSize!==24) throw new Error('Next card did not use the saved 24px preference');
    await card.webContents.executeJavaScript(`document.querySelector('.error-actions button').click()`);
    await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done','retry button recovers');
    await until(async()=>await card.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.answer')).fontSize`)==='24px','retry retains font');
    if(h.getSession()?.card?.turns.length!==1) throw new Error('Retry unexpectedly added another turn');
    results.push('Opening settings ends previous session; next card uses saved 24px; actual model failure/retry keeps the font');
    card.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
    card.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
    await until(()=>!h.getSession(),'Escape closes minimal card');
    results.push('Escape closes the card');
    await runCardLayoutSmoke(h, {dir, display:d, origin, readingAnswer, scale:Number(forcedScale)||1});
    results.push('Dynamic native window height, work area limits, session isolation, scroll preservation, close/abort and fixed controls: see dynamic-layout.json');
    writeFileSync(join(dir,'results.json'),JSON.stringify({passed:results},null,2));
    clearTimeout(deadline); console.log('SMOKE PASSED: ' + results.join('; ')); h.closeSession(); server.close(); app.quit();
  } catch (error) {
    clearTimeout(deadline); progress(String(error)); writeFileSync(join(dir,'results.json'),JSON.stringify({passed:results,error:String(error)},null,2)); console.error(error); server.close(); app.exit(1);
  }
}

async function snapshot(win: BrowserWindow, file: string): Promise<void> {
  // A locked/headless desktop can refuse compositor capture; keep interaction tests running.
  try {
    const png = await Promise.race([win.webContents.capturePage(), delay(1500).then(() => { throw new Error('Compositor capture timeout'); })]);
    writeFileSync(file, png.toPNG());
  } catch (error) { console.log('Preview unavailable: ' + String(error)); }
}
