/** Local integration runner. Only reached with --smoke in an unpackaged build. */
import { app, screen, shell, type BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HelperEvent } from '../shared/protocol';
import type { CardState, Point, StageState, TranslationMode } from '../shared/types';
import type { SettingsStore } from './settings';
import { version } from '../../package.json';
interface SmokeSession { id: string; card?: CardState; stage?: StageState; origin: Point; wheelCenter: Point; release?: Point; translationMode: TranslationMode }
interface Harness { handle(event: HelperEvent): void; getSession(): SmokeSession | undefined; getSettings(): BrowserWindow | undefined; getCard(): BrowserWindow | undefined; getStage(): BrowserWindow | undefined; store: SettingsStore; closeSession(): void }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown, label: string, timeout = 8000): Promise<void> {
  const start = Date.now(); while (!test()) { if (Date.now() - start > timeout) throw new Error('Timed out: ' + label); await delay(25); }
}
export async function runSmoke(h: Harness): Promise<void> {
  const dir = join(app.getAppPath(), '.tools/smoke'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir,'progress.log'), 'Starting smoke\n');
  const progress = (text: string) => appendFileSync(join(dir,'progress.log'), text + '\n');
  const deadline = setTimeout(() => { progress('Global timeout'); app.exit(1); }, 60000);
  const results: string[] = [];
  const packets: any[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const packet = JSON.parse(body); packets.push(packet);
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
    h.store.save({ baseUrl: `http://127.0.0.1:${address.port}/v1`, model: 'smoke-vision', clearKey: true, wheelSlots: 5, trigger: 'alt', dragThresholdPx: 8, launchAtStartup: false, stream: true });
    progress('Fixture settings saved');
    await until(() => h.getSettings()?.webContents.isLoading() === false, 'settings loaded'); await delay(200);
    progress('Settings loaded');
    const settings = h.getSettings()!;
    const title = await Promise.race([settings.webContents.executeJavaScript('document.querySelector("h1")?.textContent'), delay(3000).then(() => { throw new Error('Settings renderer evaluation timed out'); })]);
    progress('Settings evaluated: ' + title);
    if (title !== '设置') throw new Error('Settings failed to render');
    await snapshot(settings, join(dir,'settings.png')); results.push('Settings renderer and sandboxed preload');
    const checkLayout = async (win: BrowserWindow, label: string) => {
      const layout = await win.webContents.executeJavaScript(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,contentFits:!document.querySelector('.settings-content')||document.querySelector('.settings-content').scrollWidth<=document.querySelector('.settings-content').clientWidth,icons:[...document.querySelectorAll('.icon')].every(el=>getComputedStyle(el).maskImage!=='none'&&el.getBoundingClientRect().width>0),background:getComputedStyle(document.querySelector('.settings-content')||document.querySelector('.card-shell')).backgroundColor})`);
      if (layout.scrollWidth > layout.width || !layout.icons || !layout.contentFits) throw new Error('UI overflow / missing assets in '+label+': '+JSON.stringify(layout));
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
    if(!/^y(?: proximity)?$/.test(scrollStyles.snap)||scrollStyles.sections!==4) throw new Error('Missing continuous snap layout: '+JSON.stringify(scrollStyles));
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
    await settings.webContents.executeJavaScript(`(()=>{const root=document.querySelector('.settings-content');root.dispatchEvent(new WheelEvent('wheel'));root.scrollTo({top:document.querySelector('[data-section=gesture]').offsetTop,behavior:'instant'});})()`);await delay(120);
    if(await settings.webContents.executeJavaScript(`document.querySelector('.nav-item.active').dataset.tab`)!=='gesture') throw new Error('Scrolling did not update sidebar');
    // Wheel input near a section boundary should settle on its native CSS snap point.
    await navigateSettings('model');
    const gestureTop=await settings.webContents.executeJavaScript(`document.querySelector('[data-section=gesture]').offsetTop`);
    settings.webContents.sendInputEvent({type:'mouseWheel',x:800,y:400,deltaX:0,deltaY:-gestureTop+30,canScroll:true});await delay(1200);
    const wheelScroll=await settings.webContents.executeJavaScript(`({active:document.querySelector('.nav-item.active').dataset.tab,top:document.querySelector('.settings-content').scrollTop,target:document.querySelector('[data-section=gesture]').offsetTop})`);
    if(wheelScroll.active!=='gesture'||Math.abs(wheelScroll.top-wheelScroll.target)>2) throw new Error('Wheel scroll snap failed: '+JSON.stringify(wheelScroll));
    settings.setSize(500,720); await delay(100);
    for(const tab of ['model','gesture','wheel','app']){await navigateSettings(tab);await checkLayout(settings,'narrow '+tab);}
    await settings.webContents.executeJavaScript(`document.querySelector('.settings-content').scrollTo({top:document.querySelector('.settings-content').scrollHeight,behavior:'instant'})`);await delay(100);
    const footerFits=await settings.webContents.executeJavaScript(`document.querySelector('.copyright').getBoundingClientRect().bottom<=document.querySelector('.settings-content').getBoundingClientRect().bottom+2`);
    if(!footerFits) throw new Error('Tall section trapped the copyright footer');
    const bottomGap=await settings.webContents.executeJavaScript(`document.querySelector('.settings-content').getBoundingClientRect().bottom-document.querySelector('.copyright').getBoundingClientRect().bottom`);
    if(bottomGap>17) throw new Error('Extra blank space after copyright: '+bottomGap);
    settings.webContents.sendInputEvent({type:'mouseWheel',x:350,y:600,deltaX:0,deltaY:-1000,canScroll:true});await delay(120);
    if(await settings.webContents.executeJavaScript(`Math.abs(document.querySelector('.settings-content').scrollTop-(document.querySelector('.settings-content').scrollHeight-document.querySelector('.settings-content').clientHeight))`)>2) throw new Error('Scrolling passed the bottom boundary');
    await snapshot(settings,join(dir,'settings-narrow.png')); settings.setSize(1000,900);await delay(100);
    await navigateSettings('model');
    results.push('Compact natural-height settings without section gaps; two-line about; removed session note; clicked lolPing GitHub link; smooth navigation, native snap, automatic sidebar, narrow footer and bottom boundary');
    progress('Settings preview attempted');
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
    if (!(await card.webContents.executeJavaScript('document.querySelector(".answer")?.textContent')).includes('定位区域')) throw new Error('No answer UI');
    const markdown = await card.webContents.executeJavaScript('({bold:document.querySelector(".answer strong")?.textContent,items:document.querySelectorAll(".answer li").length,code:document.querySelector(".answer pre code")?.textContent,images:document.querySelectorAll(".answer img").length,link:document.querySelector(".answer .inline-link")?.textContent,question:document.querySelector(".question-label")?.textContent})');
    if(markdown.bold !== '定位区域' || markdown.items !== 2 || !markdown.code?.includes('示例内容') || markdown.images !== 0 || markdown.link !== '查看帮助' || markdown.question !== '解释这里') throw new Error('Markdown/concise task label failed: '+JSON.stringify(markdown));
    results.push('Markdown bold, lists, code and clickable links; remote images disabled; concise question label and focus detail');
    await snapshot(card, join(dir,'card.png'));
    await checkLayout(card,'answer card');
    const fixture = h.getSession()!.card!;
    const showFixture = async (name: string, patch: Partial<CardState>) => {
      card.webContents.send('pingscreen:event',{type:'card',state:{...fixture,...patch}});await delay(150);await checkLayout(card,name);await snapshot(card,join(dir,name+'.png'));
    };
    await showFixture('card-custom',{intent:'custom',awaitingQuestion:true,turns:[]});
    await showFixture('card-generating',{turns:[{question:'解释这里',answer:'这句话强调好的设计可以降低理解和使用的难度。',status:'generating'}]});
    await showFixture('card-error',{turns:[{question:'解释这里',answer:'',status:'error',error:'无法连接模型服务，请检查服务地址或 API Key 后重试。'}]});
    await showFixture('card-stopped',{turns:[{question:'解释这里',answer:'已生成的内容仍可复制。',status:'stopped'}]});
    await showFixture('card-restored',{});
    await card.webContents.executeJavaScript(`document.querySelector('.snapshot').open=true`);await snapshot(card,join(dir,'card-preview.png'));
    await card.webContents.executeJavaScript(`document.querySelector('.snapshot').open=false`);
    results.push('White answer card states: completed, custom input, generating, error, stopped and expanded snapshot');
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"question",id:' + JSON.stringify(h.getSession()!.id) + ',text:"如何修复？"})');
    await until(() => h.getSession()?.card?.turns.length === 2 && h.getSession()?.card?.turns.at(-1)?.status === 'done', 'follow-up');
    if (packets[1].messages.at(-1).content !== '如何修复？') throw new Error('Follow-up lost'); results.push('Streamed card and follow-up on the same snapshot');
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
    await snapshot(stage, join(dir,'wheel.png'));
    // fifth slice: 198 degrees from +x (top + 4*72 degrees).
    emit('wheelRelease',origin.x - Math.round(90*d.scaleFactor),origin.y - Math.round(29*d.scaleFactor));
    await until(() => h.getSession()?.stage?.mode === 'region', 'region mode');
    const id = h.getSession()!.id;
    await stage.webContents.executeJavaScript('window.pingscreen.command({type:"region",id:' + JSON.stringify(id) + ',rect:{x:100,y:100,width:250,height:180}})');
    await until(() => h.getSession()?.stage?.mode === 'regionIntent', 'region intent'); await delay(150);
    const slices = await stage.webContents.executeJavaScript('document.querySelectorAll(".slice").length');
    if (slices !== 4) throw new Error('Expected four region intents');
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
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"question",id:' + JSON.stringify(customId) + ',text:"描述这里"})');
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'generating','custom generating');
    await card.webContents.executeJavaScript('window.pingscreen.command({type:"stop",id:' + JSON.stringify(customId) + '})');
    await delay(200);
    if(h.getSession()?.card?.turns.at(-1)?.status !== 'stopped') throw new Error('Late model response revived stopped generation');
    results.push('Custom question entry and stopping ignores late response');
    emit('wheelOpen',origin.x,origin.y); emit('wheelRelease',origin.x,origin.y-90);
    await until(() => h.getSession()?.card?.turns.at(-1)?.status === 'generating','replacement request');
    const replaced = h.getSession()!.id;
    emit('wheelOpen',origin.x,origin.y); h.handle({type:'cancel'}); await delay(200);
    if(h.getSession()) throw new Error('Replaced model response revived '+replaced);
    results.push('New gesture cancels an active request without reviving the old card');
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
