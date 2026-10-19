import { type BrowserWindow, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Point } from '../shared/types';
import { defaultWheelActions, type WheelSlot } from '../shared/wheel';
import type { Harness } from './smoke';
import { runSettingsInterfaceSmoke } from './smokeSettingsInterface';

const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>unknown|Promise<unknown>,label:string):Promise<void>{
  const start=Date.now();while(!await test()){if(Date.now()-start>8000)throw new Error('Wheel smoke: '+label);await delay(20);}
}
function check(value:unknown,message:string):asserts value {if(!value)throw new Error('Wheel smoke: '+message);}

export async function runWheelSmoke(h:Harness,{dir,packets,origin,display,failNext}:{dir:string;packets:any[];origin:Point;display:Display;failNext:()=>void}):Promise<void>{
  const settings=h.getSettings()!,card=h.getCard()!;
  const original=h.store.get();
  const evidence:Record<string,unknown>={};
  const js=async(code:string):Promise<any>=>{
    const result=await settings.webContents.executeJavaScript(`(async()=>{try{const value=await (${code});return {ok:true,value:value instanceof Element?true:value};}catch(error){return {ok:false,error:String(error),stack:error.stack};}})()`).catch(error=>{throw new Error('Wheel bridge: '+code+' '+error);});
    if(!result.ok)throw new Error('Wheel renderer: '+result.error+' in '+code+' '+result.stack);
    return result.value;
  };
  const screenshot=async(win:BrowserWindow,name:string)=>{await delay(220);writeFileSync(join(dir,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  const reload=async()=>{settings.webContents.reload();await until(()=>!settings.webContents.isLoading(),'settings reload');await until(async()=>!!await js(`document.querySelector('.wheel-overview')`),'editor mounted');};
  const click=async(selector:string)=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(35);};
  const choose=async(index:number,value:string)=>{
    await click(`.wheel-slot-row:nth-child(${index+1}) .slot-edit`);
    await until(async()=>!!await js(`document.querySelector('[aria-label="选择槽位功能"]')`),'focus menu');
    const option=value==='prompt'?5:['explain','translate','rewrite','custom','region'].indexOf(value);
    await click(`.function-options button:nth-child(${option+1})`);
  };
  const enter=async()=>{await click('[aria-label="编辑轮盘"]');await until(async()=>!!await js(`document.querySelector('[data-wheel-page="wheel"]')`),'secondary page');};
  const complete=async()=>{await click('[aria-label="完成自定义编辑"]');};
  const saveAll=async()=>{await click('[aria-label="保存轮盘"]');await until(async()=>!!await js(`document.querySelector('[aria-label="保存轮盘"]:disabled')`),'save completed');};
  const edit=async(selector:string,value:string,blur=true)=>{
    await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(35);
    if(blur){await js(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await delay(50);}
  };
  const command=async(win:BrowserWindow,type:string,extra={})=>win.webContents.executeJavaScript(`window.pingscreen.command(${JSON.stringify({type,id:h.getSession()!.id,...extra})})`);
  const emit=(type:'wheelOpen'|'wheelMove'|'wheelRelease',index=0,count=h.store.get().wheelSlots)=>{
    const angle=-Math.PI/2+index*2*Math.PI/count;
    h.handle({type,wheel:'ping',x:type==='wheelOpen'?origin.x:origin.x+Math.round(90*display.scaleFactor*Math.cos(angle)),y:type==='wheelOpen'?origin.y:origin.y+Math.round(90*display.scaleFactor*Math.sin(angle))});
  };
  const open=async(index:number)=>{emit('wheelOpen');emit('wheelMove',index);emit('wheelRelease',index);await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done','custom completion');await delay(60);};
  const promptA='Analyze this target in English in detail. Output JSON only.\nKeep the requested structure.';
  const promptB='Review the code at this target. Output only actionable findings.';
  try {
    h.closeSession();settings.show();settings.focus();h.store.save({wheelSlots:5,wheelActions:defaultWheelActions()});await reload();
    await click('[data-tab=wheel]');await delay(260);
    await edit('[aria-label="模型名称"]','unsaved-wheel-model',false);
    const initialActions=JSON.stringify(h.store.get().wheelActions);
    const mainPosition=await js(`document.querySelector('.settings-content').scrollTop`);
    check(await js(`document.querySelectorAll('.wheel-overview button').length`)===1,'main wheel has extra controls');
    await enter();
    check(await js(`document.querySelector('.settings-content').hidden`),'main content not replaced');
    check(await js(`getComputedStyle(document.querySelector('.settings-sidebar')).display==='none'&&document.querySelector('.wheel-detail').getBoundingClientRect().width>=innerWidth-1`),'editor did not fill window');
    const animationCount=await js(`document.querySelector('.wheel-detail .preview-motion').getAnimations().length`);
    check(animationCount>0,'preview enter transition missing');
    await choose(0,'prompt');await edit('[aria-label="自定义名称"]',' ');await complete();
    check(h.store.get().wheelActions[0].kind==='builtin','incomplete draft overwrote builtin');
    check(await js(`document.querySelector('[aria-label="自定义名称"]').getAttribute('aria-invalid')`)==='true','missing name validation');
    await edit('[aria-label="自定义名称"]','a'.repeat(21));await complete();
    check(await js(`document.querySelector('[data-wheel-page]').dataset.wheelPage`)==='custom','invalid name completed');
    const longName='英文润色与详细分析任务名称长度测试示例';
    await edit('[aria-label="自定义名称"]',longName);await edit('[aria-label="自定义提示词"]','x'.repeat(8001));await complete();
    check(h.store.get().wheelActions[0].kind==='builtin','long prompt saved');
    await edit('[aria-label="自定义提示词"]',promptA);await click('[aria-label="图标：翻译"]');
    for(const field of ['自定义名称','自定义提示词']){
      const focusStyle=await js(`(()=>{const e=document.querySelector('[aria-label="${field}"]');e.blur();const border=getComputedStyle(e).borderColor;e.focus();const style=getComputedStyle(e);return {border,focused:style.borderColor,outline:style.outlineStyle,shadow:style.boxShadow};})()`);
      check(focusStyle.border===focusStyle.focused&&focusStyle.outline==='none'&&focusStyle.shadow==='none','custom field retains blue focus line');
    }
    await screenshot(settings,'custom-third-page');await complete();
    check(JSON.stringify(h.store.get().wheelActions)===initialActions,'third page completion persisted');
    await choose(5,'prompt');await edit('[aria-label="自定义名称"]','代码审查');await edit('[aria-label="自定义提示词"]',promptB);await click('[aria-label="图标：翻译"]');await complete();
    for(const [n,button] of [[6,3],[4,1],[5,2],[6,3]]){
      await click(`.wheel-detail .layout-options button:nth-child(${button})`);
      check(await js(`document.querySelectorAll('.wheel-detail .wheel-preview .slice').length`)===n,'preview count');
      check(JSON.stringify(h.store.get().wheelActions)===initialActions&&h.store.get().wheelSlots===5,'size or draft persisted before save');
    }
    // Native mouse input must reorder by the nine-square handle, without opening focus.
    const order=()=>js(`[...document.querySelectorAll('.wheel-slot-row')].map(e=>e.dataset.slotId)`);
    const beforeDrag=await order();
    const dragTo=async(from:number,to:number,cancel=false)=>{
      await js(`document.querySelectorAll('.wheel-slot-row')[${from}].scrollIntoView({block:'nearest'})`);await delay(30);
      const points=await js(`(()=>{const rows=document.querySelectorAll('.wheel-slot-row'),a=rows[${from}].querySelector('.slot-drag').getBoundingClientRect(),b=rows[${to}].getBoundingClientRect();return {x:Math.round(a.left+a.width/2),y:Math.round(a.top+a.height/2),target:Math.round(b.top+b.height/2)};})()`);
      settings.webContents.sendInputEvent({type:'mouseMove',x:points.x,y:points.y});settings.webContents.sendInputEvent({type:'mouseDown',x:points.x,y:points.y,button:'left',clickCount:1});
      for(let step=1;step<=6;step++){settings.webContents.sendInputEvent({type:'mouseMove',x:points.x,y:Math.round(points.y+(points.target-points.y)*step/6)});await delay(20);}
      if(cancel){settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(30);}
      settings.webContents.sendInputEvent({type:'mouseUp',x:points.x,y:points.target,button:'left',clickCount:1});await delay(70);
    };
    check(await js(`document.querySelectorAll('.slot-drag .drag-grid i').length`)===54,'drag icon is not nine squares');
    check(await js(`[...document.querySelectorAll('.wheel-slot-row')].every(e=>e.querySelectorAll('button').length===2)`),'row has extra controls');
    await dragTo(5,4);check((await order())[4]===beforeDrag[5],'native drag did not reorder');
    check(!await js(`document.querySelector('[aria-label="选择槽位功能"]')`),'drag opened edit menu');
    await js(`document.querySelectorAll('.slot-drag')[4].focus()`);settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});await delay(50);
    check(JSON.stringify(await order())===JSON.stringify(beforeDrag),'keyboard reorder did not restore');
    check(await js(`document.querySelectorAll('.wheel-slot-row').length&&[...document.querySelectorAll('.wheel-slot-row')].some(row=>row.getAnimations().length)`),'reorder animation missing');
    await delay(230);
    await dragTo(0,2,true);check(JSON.stringify(await order())===JSON.stringify(beforeDrag),'cancel did not restore drag');
    // Hold the pointer at the viewport edge and verify auto-scroll while captured.
    const previousBounds=settings.getBounds();settings.setSize(700,400);await delay(70);
    await js(`document.querySelector('.wheel-slot-list').scrollTop=0`);
    const edge=await js(`(()=>{const a=document.querySelector('.slot-drag').getBoundingClientRect(),b=document.querySelector('.wheel-slot-list').getBoundingClientRect();return {x:Math.round(a.left+a.width/2),y:Math.round(a.top+a.height/2),bottom:Math.round(b.bottom-5)};})()`);
    settings.webContents.sendInputEvent({type:'mouseDown',x:edge.x,y:edge.y,button:'left',clickCount:1});settings.webContents.sendInputEvent({type:'mouseMove',x:edge.x,y:edge.bottom});await delay(320);
    check(await js(`document.querySelector('.wheel-slot-list').scrollTop`)>0,'drag edge did not auto-scroll');
    settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});settings.webContents.sendInputEvent({type:'mouseUp',x:edge.x,y:edge.bottom,button:'left',clickCount:1});await delay(50);
    check(JSON.stringify(await order())===JSON.stringify(beforeDrag),'edge drag cancellation changed order');settings.setSize(previousBounds.width,previousBounds.height);await delay(80);
    check(JSON.stringify(h.store.get().wheelActions)===initialActions,'reorder persisted before save');
    await saveAll();console.log('Wheel draft and drag passed');const configured=h.store.get().wheelActions;
    check(configured[0].kind==='prompt'&&configured[5].kind==='prompt','explicit save missed custom tasks');
    check(h.store.get().model===original.model,'wheel saved model draft');
    check(await js(`document.querySelector('[aria-label="模型名称"]').value`)==='unsaved-wheel-model','wheel replaced model draft');
    // Only the edit button opens the focused chooser; backdrop and Esc restore focus.
    await js(`(()=>{document.querySelector('.wheel-slot-list').scrollTop=0;document.querySelector('.wheel-slot-row').click();})()`);await delay(40);
    check(!await js(`document.querySelector('[aria-label="选择槽位功能"]')`),'row click opened menu');
    await click('.wheel-slot-row .slot-edit');
    check(await js(`document.querySelector('.wheel-detail').inert&&document.querySelector('.settings-sidebar').inert`),'focus background remains active');
    check((await js(`getComputedStyle(document.querySelector('.wheel-focus-backdrop')).backdropFilter`)).includes('blur'),'focus blur missing');
    await screenshot(settings,'custom-wheel-focus');
    settings.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});settings.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(50);
    check(await js(`document.activeElement?.classList.contains('slot-edit')`),'focus not restored');
    console.log('Wheel focus passed');
    await click('.wheel-slot-row .slot-edit');await click('.wheel-focus-backdrop');check(!await js(`document.querySelector('[aria-label="选择槽位功能"]')`),'backdrop did not dismiss');
    // Failure retains the full draft and failed save-and-exit cannot leave.
    await choose(0,'prompt');await edit('[aria-label="自定义提示词"]','failure draft');await complete();
    const save=h.store.save.bind(h.store);
    try {
      h.store.save=(raw:unknown)=>{if((raw as any)?.wheelActions?.[0]?.prompt==='failure draft')throw new Error('模拟轮盘保存失败');return save(raw);};
      await click('[aria-label="保存轮盘"]');await until(async()=>String(await js(`document.querySelector('.wheel-save-error')?.textContent`)).includes('保存失败'),'failure visible');
      check((h.store.get().wheelActions[0] as any).prompt===promptA,'failed save changed task');
      await click('[aria-label="返回配置页"]');await click('.exit-actions button:last-child');await delay(80);
      check(!!await js(`document.querySelector('[aria-label="保存轮盘修改？"]')`),'failed save exited');
      await click('.exit-actions button:first-child');await choose(0,'prompt');
      check(await js(`document.querySelector('[aria-label="自定义提示词"]').value`)==='failure draft','failure lost draft');
      await edit('[aria-label="自定义提示词"]',promptA);await complete();
    } finally {h.store.save=save;}
    console.log('Wheel failure passed');
    // Dirty guards cover return, sidebar navigation and the actual native close event.
    await click('.wheel-detail .layout-options button:first-child');await click('[aria-label="返回配置页"]');await click('.exit-actions button:first-child');
    check(!!await js(`document.querySelector('[data-wheel-page="wheel"]')`),'cancel left editor');
    await click('[data-tab=model]');await click('.exit-actions button:nth-child(2)');await delay(350);
    check(h.store.get().wheelSlots===6&&!await js(`document.querySelector('[data-wheel-page]')`),'discard changed saved config');
    await click('[data-tab=wheel]');await delay(280);await enter();await click('.wheel-detail .layout-options button:nth-child(2)');
    settings.close();await until(async()=>!!await js(`document.querySelector('[aria-label="保存轮盘修改？"]')`),'native close guard');
    check(settings.isVisible(),'native close hid unsaved editor');await screenshot(settings,'custom-wheel-unsaved');await click('.exit-actions button:first-child');
    await click('[aria-label="返回配置页"]');await click('.exit-actions button:last-child');await until(()=>h.store.get().wheelSlots===5,'save and exit');await delay(80);
    check(!await js(`document.querySelector('[data-wheel-page]')`),'save and exit stayed');
    console.log('Wheel exit guards passed');
    // Clean navigation restores scroll position and respects reduced motion.
    const beforeReturn=await js(`document.querySelector('.settings-content').scrollTop`);await enter();await click('[aria-label="返回配置页"]');await delay(80);
    check(Math.abs(await js(`document.querySelector('.settings-content').scrollTop`)-beforeReturn)<2,'main scroll position lost');
    check(await js(`document.querySelector('.wheel-overview .preview-motion').getAnimations().length`)>0,'reverse transition missing');
    settings.webContents.debugger.attach('1.3');
    try {
      await settings.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await enter();
      check(await js(`document.querySelector('.wheel-detail .preview-motion').getAnimations().length`)===0,'reduced-motion animation');await click('[aria-label="返回配置页"]');
    } finally {await settings.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});settings.webContents.debugger.detach();}
    await enter();
    for(const [width,height] of [[900,560],[700,400]]){
      settings.setSize(width,height);await delay(80);
      for(const collapsed of [false,true]){
        if(await js(`document.querySelector('.settings-shell').classList.contains('sidebar-collapsed')`)!==collapsed)await click('.sidebar-toggle');
        const layout=await js(`(()=>{const p=document.querySelector('.wheel-preview-column').getBoundingClientRect(),l=document.querySelector('.wheel-slot-list').getBoundingClientRect(),d=document.querySelector('.wheel-detail');return {left:p.right<=l.left,fits:d.scrollWidth<=d.clientWidth,listWidth:l.width,previewWidth:p.width};})()`);
        check(layout.left&&layout.fits&&layout.listWidth>0&&layout.previewWidth>0,'secondary layout overflow');
        check(await js(`getComputedStyle(document.querySelector('.settings-sidebar')).display==='none'`),'secondary sidebar visible');
        await screenshot(settings,`wheel-editor-${width}-${height}-${collapsed?'icons':'expanded'}`);
      }
    }
    settings.setSize(900,560);if(await js(`document.querySelector('.settings-shell').classList.contains('sidebar-collapsed')`))await click('.sidebar-toggle');await delay(80);
    await click('[aria-label="返回配置页"]');await delay(80);
    settings.close();await until(()=>!settings.isVisible(),'clean native close');settings.show();settings.focus();
    await enter();await click('.wheel-detail .layout-options button:first-child');settings.close();await until(async()=>!!await js(`document.querySelector('[aria-label="保存轮盘修改？"]')`),'dirty native close discard');await click('.exit-actions button:nth-child(2)');await until(()=>!settings.isVisible(),'native discard close');check(h.store.get().wheelSlots===5,'discard-close persisted draft');settings.show();settings.focus();
    // Invalid IPC still cannot corrupt the saved task.
    const beforeBad=h.store.get(),bad=beforeBad.wheelActions.map(slot=>({...slot}));(bad[0] as any).icon='invalid';
    let rejected=false;try{await js(`window.pingscreen.settings(${JSON.stringify({wheelSlots:6,wheelActions:bad})})`);}catch{rejected=true;}
    check(rejected&&JSON.stringify(h.store.get())===JSON.stringify(beforeBad),'invalid icon accepted');
    await runSettingsInterfaceSmoke(settings,dir);
    await click('[data-tab=wheel]');await delay(280);await screenshot(settings,'custom-wheel-settings');
    evidence.editor={sizes:[6,4,5,6],hiddenPreserved:true,independentCustoms:true,nativeMouseDrag:true,keyboardOrder:true,cancelDrag:true,validation:true,failureDraftRetained:true,modelDraftIsolated:true,layeredPages:true,explicitSave:true,closeGuard:true,exitActions:true,blurFocus:true,previewAnimation:true,reducedMotion:true};
    for(const n of [4,5,6] as const){
      h.store.save({wheelSlots:n});emit('wheelOpen');emit('wheelMove',0);await until(()=>h.getSession()?.stage?.image,'wheel image');await delay(80);
      const stage=h.getStage()!;check(await stage.webContents.executeJavaScript(`document.querySelectorAll('.slice').length`)===n,'runtime slices '+n);
      check(!await stage.webContents.executeJavaScript(`!!document.querySelector('.stage-hint')`),'top banner');
      await screenshot(stage,'custom-wheel-'+n);h.closeSession();
    }
    const firstPacket=packets.length;
    // Release before PNG; changing persisted config must not change the task snapshot.
    emit('wheelOpen');emit('wheelRelease',0);
    const changed=h.store.get().wheelActions.map(s=>({...s}));(changed[0] as any).prompt='new configured task';h.store.save({wheelActions:changed});
    await until(()=>h.getSession()?.card?.turns[0]?.status==='done','snapshot execution');
    const packetA=packets[firstPacket];
    check(packetA.messages[1].content[0].text.includes(promptA),'snapshot prompt changed');
    check(packetA.messages[1].content[0].text.includes('point'),'no point context');
    check(packetA.messages[1].content.filter((p:any)=>p.type==='image_url').length===2,'custom images missing');
    check(!/中文|Markdown|2–4/.test(packetA.messages[0].content),'preset style leaked');
    check(!packetA.messages[1].content[0].text.includes('翻译模式'),'translation mode leaked');
    check(!await card.webContents.executeJavaScript(`!!document.querySelector('.question-label')`),'automatic prompt visible');
    h.store.save({wheelActions:configured});await open(5);
    check(packets.at(-1).messages[1].content[0].text.includes(promptB),'same icon executed wrong task');
    await command(card,'question',{text:'Give one concrete example'});await until(()=>h.getSession()?.card?.turns.at(-1)?.status==='done'&&h.getSession()?.card?.turns.length===2,'follow-up');
    check(packets.at(-1).messages.at(-1).content==='Give one concrete example','follow-up replaced');
    check(await card.webContents.executeJavaScript(`document.querySelector('.question-label')?.textContent`)==='Give one concrete example','follow-up hidden');
    const images=JSON.stringify(packets.at(-1).messages[1]);
    check(images===JSON.stringify(packets[firstPacket+1].messages[1]),'follow-up changed initial snapshot');
    failNext();emit('wheelOpen');emit('wheelRelease',0);await until(()=>h.getSession()?.card?.turns[0]?.status==='error','failed prompt');
    await command(card,'retry');await until(()=>h.getSession()?.card?.turns[0]?.status==='done','retry');
    check(packets.at(-1).messages[1].content[0].text.includes(promptA),'retry lost prompt');
    h.store.save({stream:false});await open(0);check(packets.at(-1).stream===false,'non-stream config ignored');h.store.save({stream:true});
    emit('wheelOpen');emit('wheelRelease',0);await until(()=>h.getSession()?.card?.turns[0]?.answer,'first delta');await command(card,'stop');await delay(140);check(h.getSession()?.card?.turns[0]?.status==='stopped','late text revived stopped task');
    emit('wheelOpen');emit('wheelRelease',0);await until(()=>h.getSession()?.card?.turns[0]?.status==='generating','close generating');await command(card,'close');await delay(140);check(!h.getSession(),'closed prompt revived');
    evidence.requests={promptA:packetA.messages[1].content[0].text,promptB,sameImageFollowup:true,retry:true,stop:true,close:true,streamingAndJson:true,system:packetA.messages[0].content};

    h.store.save({wheelSlots:5,wheelActions:configured});emit('wheelOpen');await until(()=>h.getSession()?.stage?.image,'stage commands');const stage=h.getStage()!;
    await command(stage,'intent',{slotId:configured[0].id});check(!h.getSession()?.card,'wrong-stage intent accepted');
    emit('wheelRelease',4,5);await until(()=>h.getSession()?.stage?.mode==='region','region entry');
    const rect={x:100,y:100,width:250,height:180};await command(stage,'region',{rect});await until(()=>h.getSession()?.stage?.mode==='regionIntent','region derived');
    check(h.getSession()!.stage!.actions.map(a=>a.id).join(',')===configured.slice(0,4).map(a=>a.id).join(','),'region reordered or filled hidden slots');
    for(const slotId of [configured[5].id,'unknown',configured[4].id])await command(stage,'intent',{slotId});
    check(!h.getSession()?.card,'hidden or unknown region item accepted');
    await command(stage,'intent',{slotId:configured[0].id});await until(()=>h.getSession()?.card?.turns[0]?.status==='done','region prompt');
    check(packets.at(-1).messages[1].content[0].text.includes('region')&&packets.at(-1).messages[1].content[0].text.includes(promptA),'custom region request');

    const single:WheelSlot[]=configured.map(s=>({id:s.id,kind:'builtin',action:'region'}));single[0]=configured[0];
    h.store.save({wheelSlots:4,wheelActions:single});emit('wheelOpen');emit('wheelRelease',1,4);await until(()=>h.getSession()?.stage?.mode==='region','single region');await command(stage,'region',{rect});await delay(80);
    check(h.getSession()?.stage?.actions.length===1,'single region count');
    check((await stage.webContents.executeJavaScript(`document.querySelector('.slice path').getAttribute('d')`)).includes('A116,116 0 1 1'),'single ring path');
    await screenshot(stage,'custom-region-single');await command(stage,'intent',{slotId:single[0].id});await until(()=>h.getSession()?.card?.turns[0]?.status==='done','single ring execution');
    emit('wheelOpen');emit('wheelRelease',1,4);await until(()=>h.getSession()?.stage?.mode==='region','single region cancel');await command(stage,'region',{rect});await command(stage,'close');check(!h.getSession(),'single cancel');
    const duplicates=defaultWheelActions();duplicates[0]={...duplicates[0],kind:'builtin',action:'translate'};
    h.store.save({wheelSlots:6,wheelActions:duplicates});emit('wheelOpen');emit('wheelMove',0);h.handle({type:'wheelScroll',wheel:'ping',x:origin.x,y:origin.y-Math.round(90*display.scaleFactor),delta:120});check(h.getSession()?.translationMode==='line','moved translation scroll');emit('wheelMove',1);check(h.getSession()?.translationMode==='point','duplicate translation reset');h.closeSession();
    evidence.region={filtersVisibleOnly:true,rejectsInvalidIds:true,customRequest:true,singleRing:true,cancel:true,duplicateTranslationReset:true};
    writeFileSync(join(dir,'wheel-verification.json'),JSON.stringify(evidence,null,2));
  } finally {h.closeSession();h.store.save(original);}
}
