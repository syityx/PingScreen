import type { BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Exercises real renderer layout and navigation without editing persisted connection data. */
export async function runSettingsInterfaceSmoke(win: BrowserWindow, dir: string): Promise<void> {
  const js = (source: string) => win.webContents.executeJavaScript(source);
  const checks: unknown[] = [];
  const fonts = await js(`(async()=>{await Promise.all([400,500,600].map(weight=>document.fonts.load(weight+' 15px "Glow Sans SC"','配置页面 PingScreen 0123456789')));await document.fonts.ready;return {family:getComputedStyle(document.body).fontFamily,faces:[...document.fonts].filter(face=>face.family.replaceAll('"','')==='Glow Sans SC').map(face=>({weight:face.weight,status:face.status}))};})()`);
  if (!fonts.family.startsWith('"Glow Sans SC"') || fonts.faces.length!==3 || fonts.faces.some((face: any)=>face.status!=='loaded') || fonts.faces.map((face: any)=>face.weight).sort().join(',')!=='400,500,600') throw new Error('Bundled Glow Sans fonts failed to load: '+JSON.stringify(fonts));
  checks.push({fonts});
  const navigate = async (id: string) => {
    await js(`document.querySelector('[data-tab=${id}]').click()`);
    for (let i = 0; i < 100; i++) {
      if (await js(`(()=>{const root=document.querySelector('.settings-content'),section=document.querySelector('[data-section=${id}]');return Math.abs(root.scrollTop-Math.min(section.offsetTop,root.scrollHeight-root.clientHeight))<2&&document.querySelector('.nav-item.active').dataset.tab==='${id}';})()`)) return;
      await delay(15);
    }
    throw new Error('Settings navigation timeout: ' + id);
  };
  const snapshot = async (name: string) => {
    await delay(150); // Capture settled hover/selection styles, including zero-distance navigation.
    const capture = await win.webContents.capturePage();
    writeFileSync(join(dir, name + '.png'), capture.toPNG());
  };
  const draft = await js(`document.querySelector('[aria-label="模型名称"]').value`);
  if (await js(`document.querySelector('.sidebar-toggle').getAttribute('aria-expanded')`) !== 'true') throw new Error('Sidebar must initially be expanded');

  for (const [width, height] of [[900, 560], [700, 400]]) {
    win.setSize(width, height); await delay(100);
    for (const collapsed of [false, true]) {
      if (await js(`document.querySelector('.settings-shell').classList.contains('sidebar-collapsed')`) !== collapsed) {
        await js(`document.querySelector('.sidebar-toggle').click()`); await delay(80);
      }
      const sidebar = await js(`(()=>{const side=document.querySelector('.settings-sidebar'),toggle=document.querySelector('.sidebar-toggle'),items=[...document.querySelectorAll('.nav-item')];return {width:side.getBoundingClientRect().width,expanded:toggle.getAttribute('aria-expanded'),label:toggle.getAttribute('aria-label'),items:items.map(el=>({title:el.title,label:el.getAttribute('aria-label'),text:getComputedStyle(el.lastElementChild).display})),draft:document.querySelector('[aria-label="模型名称"]').value};})()`);
      if (sidebar.expanded !== String(!collapsed) || !sidebar.label || sidebar.draft !== draft || (collapsed && (sidebar.width > 70 || sidebar.items.some((item: any) => !item.title || !item.label || item.text !== 'none')))) throw new Error('Sidebar accessibility/draft failed: ' + JSON.stringify(sidebar));
      const rows = await js(`(()=>{const items=[...document.querySelectorAll('.settings-row')];return items.map(row=>{const rect=row.getBoundingClientRect();return {label:row.querySelector('h3').textContent,height:rect.height,aligned:[...row.children].every(child=>{const b=child.getBoundingClientRect();return Math.abs((b.top+b.bottom-rect.top-rect.bottom)/2)<1;})};});})()`);
      if (rows.length!==4 || rows.some((row: any) => Math.abs(row.height-56)>.5 || !row.aligned)) throw new Error('Single-line settings rows differ in height/alignment: '+JSON.stringify(rows));
      checks.push({width,height,collapsed,singleLineRows:rows});
      for (const id of ['model', 'gesture', 'wheel', 'app']) {
        await navigate(id);
        const layout = await js(`(()=>{const root=document.querySelector('.settings-content'),section=document.querySelector('[data-section=${id}]'),rect=root.getBoundingClientRect();return {id:'${id}',width:innerWidth,height:innerHeight,collapsed:${collapsed},fits:root.scrollWidth<=root.clientWidth&&document.documentElement.scrollWidth<=innerWidth,fields:[...section.querySelectorAll('input:not([type=range]),textarea,select,.settings-buttons button,.layout-options button,.slot-select,.slot-move,.icon-picker button')].every(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.left>=rect.left&&b.right<=rect.right;}),font:[...document.querySelectorAll('.settings-row h3,.field,.field input,.field select,.field textarea,.settings-row select')].every(el=>getComputedStyle(el).fontSize==='15px'),titles:[...document.querySelectorAll('.page-section-title,.settings-heading h2')].every(el=>getComputedStyle(el).fontSize==='20px'),footer:${id === 'app'}?document.querySelector('.copyright').getBoundingClientRect().bottom<=rect.bottom+2:true};})()`);
        if (!layout.fits || !layout.fields || !layout.font || !layout.titles || !layout.footer) throw new Error('Settings layout failed: ' + JSON.stringify(layout));
        checks.push(layout);
        await snapshot(`settings-${width}-${height}-${collapsed ? 'icons' : 'expanded'}-${id}`);
      }
      // Trusted keyboard activation must work with both visible and icon-only labels.
      await js(`document.querySelector('[data-tab=gesture]').focus()`);
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      await delay(300);
      if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'gesture') throw new Error('Keyboard sidebar navigation failed: ' + JSON.stringify(await js(`({focus:document.activeElement?.outerHTML,active:document.querySelector('.nav-item.active').dataset.tab,width:innerWidth,collapsed:document.querySelector('.settings-shell').className})`)));
    }
  }
  win.setSize(650, 350); await delay(80);
  if (win.getBounds().width < 700 || win.getBounds().height < 400) throw new Error('Window ignored minimum dimensions');
  win.setSize(900, 560); await delay(80);
  if (await js(`document.querySelector('.settings-shell').classList.contains('sidebar-collapsed')`)) await js(`document.querySelector('.sidebar-toggle').click()`);
  await delay(80); await navigate('model');

  // A click locks the intended category even while passing intervening sections.
  await js(`document.querySelector('[data-tab=app]').click()`); await delay(40);
  if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'app') throw new Error('Navigation highlight flickered');
  await js(`document.querySelector('[data-tab=gesture]').click()`); await delay(300);
  if (!await js(`(()=>{const root=document.querySelector('.settings-content');return document.querySelector('.nav-item.active').dataset.tab==='gesture'&&Math.abs(root.scrollTop-Math.min(document.querySelector('[data-section=gesture]').offsetTop,root.scrollHeight-root.clientHeight))<2;})()`)) throw new Error('Newest navigation target did not win');

  // All manual input sources must cancel the animation rather than just unlock highlighting.
  for (const source of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    await navigate('model');
    await js(`document.querySelector('[data-tab=app]').click()`); await delay(45);
    const stopped = await js(`(()=>{const root=document.querySelector('.settings-content');root.dispatchEvent(${source === 'wheel' ? "new WheelEvent('wheel',{deltaY:30,bubbles:true})" : source === 'pointerdown' ? "new PointerEvent('pointerdown',{bubbles:true})" : source === 'keydown' ? "new KeyboardEvent('keydown',{key:'PageDown',bubbles:true})" : "new Event('touchstart',{bubbles:true})"});root.scrollTop=75;return root.scrollTop;})()`);
    await delay(300);
    if (Math.abs(await js(`document.querySelector('.settings-content').scrollTop`) - stopped) > 1) throw new Error('Old animation continued after ' + source);
  }
  const editing = await js(`(()=>{const field=document.querySelector('[aria-label="模型名称"]');field.focus();const event=new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true});field.dispatchEvent(event);return {prevented:event.defaultPrevented,value:field.value};})()`);
  if (editing.prevented || editing.value !== draft) throw new Error('Navigation intercepted input editing');

  await navigate('model');
  const position = await js(`(()=>{const root=document.querySelector('.settings-content');root.dispatchEvent(new WheelEvent('wheel'));root.scrollTop=document.querySelector('[data-section=gesture]').offsetTop-30;return root.scrollTop;})()`);
  await delay(350);
  if (Math.abs(await js(`document.querySelector('.settings-content').scrollTop`) - position) > 1) throw new Error('Manual scrolling snapped to a section');
  await js(`(()=>{const root=document.querySelector('.settings-content');root.dispatchEvent(new WheelEvent('wheel'));root.scrollTop=document.querySelector('[data-section=gesture]').offsetTop;})()`); await delay(50);
  if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'gesture') throw new Error('Manual reading highlight not tracked');
  await navigate('wheel'); await delay(100);
  if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'wheel') throw new Error('Short section lost navigation selection');
  await js(`document.querySelector('.sidebar-toggle').click()`); await delay(100);
  if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'wheel') throw new Error('Collapse lost current category');
  win.setSize(700, 400); await delay(100);
  if (await js(`document.querySelector('.nav-item.active').dataset.tab`) !== 'wheel') throw new Error('Resize lost selected category');

  win.webContents.debugger.attach('1.3');
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    if (!await js(`(()=>{document.querySelector('[data-tab=model]').click();return document.querySelector('.settings-content').scrollTop===0;})()`)) throw new Error('Reduced motion did not jump immediately');
  } finally {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    win.webContents.debugger.detach();
  }
  await js(`document.querySelector('.sidebar-toggle').click()`); win.setSize(900, 560); await delay(100); await navigate('model');
  writeFileSync(join(dir, 'settings-interface.json'), JSON.stringify({ layouts: checks, latestTarget: true, manualCancelSources: ['wheel', 'touchstart', 'pointerdown', 'keydown'], nativeKeyboard: true, reducedMotion: true, manualFeel: 'Pending user mouse/touchpad acceptance' }, null, 2));
}
