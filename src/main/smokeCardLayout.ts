import { screen, type BrowserWindow, type Display } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CardState, Point } from '../shared/types';
import type { Harness } from './smoke';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(test: () => unknown | Promise<unknown>, label: string): Promise<void> {
  const start = Date.now();
  while (!await test()) { if (Date.now() - start > 4000) throw new Error('Dynamic card timeout: ' + label); await delay(25); }
}

/** Uses real card IPC/window bounds with local content and synthetic work areas. */
export async function runCardLayoutSmoke(h: Harness, options: { dir: string; display: Display; origin: Point; readingAnswer: string; scale: number }): Promise<void> {
  const { dir, display, origin, readingAnswer, scale } = options;
  const card = h.getCard()!, settings = h.getSettings()!;
  const originalMatching = screen.getDisplayMatching;
  let activeDisplay = display, stage: BrowserWindow | undefined;
  const checks: unknown[] = [];
  const sizes: number[] = [];
  const recordResize = () => sizes.push(card.getBounds().height);
  card.on('resize', recordResize);
  screen.getDisplayMatching = () => activeDisplay;
  if (scale !== 1) {
    card.webContents.debugger.attach('1.3');
    await card.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: scale, mobile: false });
  }
  const emit = (type: 'wheelOpen' | 'wheelRelease', x: number, y: number) => h.handle({ type, x, y, wheel: 'ping' });
  const openBlank = async (font = 16) => {
    h.store.save({ answerFontSize: font });
    emit('wheelOpen', origin.x, origin.y);
    h.getSession()!.display = activeDisplay;
    await until(() => h.getStage(), 'stage exists'); stage = h.getStage();
    emit('wheelRelease', origin.x - Math.round(53 * display.scaleFactor), origin.y + Math.round(73 * display.scaleFactor));
    await until(() => h.getSession()?.card?.awaitingQuestion, 'blank card');
    await until(async () => await card.webContents.executeJavaScript(`document.querySelector('.card-content')?.textContent === ''`), 'blank renderer');
    await delay(160);
    const bounds = card.getBounds();
    if (bounds.width !== Math.min(640, activeDisplay.workArea.width) || bounds.height !== Math.min(160, bounds.width, activeDisplay.workArea.height)) throw new Error('New session did not reset: ' + JSON.stringify(bounds));
    return h.getSession()!.card!;
  };
  const show = async (patch: Partial<CardState>) => {
    const state = h.getSession()!.card!;
    Object.assign(state, patch);
    card.webContents.send('pingscreen:event', { type: 'card', state });
    await delay(160);
  };
  const assertLayout = async (label: string) => {
    const bounds = card.getBounds(), area = activeDisplay.workArea;
    const layout = await card.webContents.executeJavaScript(`(() => {
      const shell=document.querySelector('.card-shell'),pane=document.querySelector('.card-scroll'),input=document.querySelector('.composer textarea'),send=document.querySelector('.composer-send'),close=document.querySelector('.card-close');
      const style=getComputedStyle(shell),rect=el=>el.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,pane:pane.clientHeight,inputTop:rect(input).top,inputBottom:rect(input).bottom,sendBottom:rect(send).bottom,closeTop:rect(close).top,closeBottom:rect(close).bottom,closeLabel:close.getAttribute('aria-label'),closeText:close.textContent,drag:getComputedStyle(close).getPropertyValue('-webkit-app-region'),border:style.borderTopWidth,color:style.borderTopColor,radius:style.borderRadius,overflow:document.documentElement.scrollWidth>innerWidth,previews:document.querySelectorAll('.snapshot,.preview,.intent-badge').length};
    })()`);
    if (bounds.width > 640 || bounds.height > Math.min(bounds.width, area.height) || bounds.x < area.x || bounds.y < area.y || bounds.x + bounds.width > area.x + area.width || bounds.y + bounds.height > area.y + area.height || card.isResizable()
      || layout.overflow || layout.previews || layout.pane < 1 || layout.inputTop < layout.closeBottom || layout.inputBottom > layout.height || layout.sendBottom > layout.height || layout.closeTop < 0
      || layout.closeLabel !== '关闭' || layout.closeText || layout.drag !== 'no-drag' || layout.border !== '2px' || layout.color !== 'rgb(203, 210, 220)' || layout.radius !== '20px' || Math.abs(layout.dpr - scale) > .01) throw new Error(label + ': ' + JSON.stringify({ bounds, area, layout }));
    checks.push({ label, bounds, layout });
  };
  const snapshot = async (name: string) => {
    await delay(80); // Let the compositor paint scroll and focus changes before capture.
    writeFileSync(join(dir, name + '.png'), (await card.webContents.capturePage()).toPNG());
  };
  try {
    for (const font of [14, 16, 24]) {
      await openBlank(font);
      await assertLayout('empty-' + font);
      if (font === 16) await snapshot('card-dynamic-empty');
      const start = sizes.length;
      await show({ intent: 'explain', awaitingQuestion: false, turns: [{ question: '解释这里', answer: '让信息更容易理解。', status: 'generating' }] });
      const intermediate = card.getBounds().height;
      if (intermediate <= 160 || (font === 16 && intermediate >= 640)) throw new Error('No intermediate content height: ' + intermediate);
      if (font === 16) await snapshot('card-dynamic-growing');
      await show({ turns: [{ question: '解释这里', answer: readingAnswer, status: 'generating' }] });
      if (card.getBounds().height !== 640) throw new Error('Long answer did not reach height limit');
      await assertLayout('long-' + font);
      await card.webContents.executeJavaScript(`document.querySelector('.card-scroll').scrollTop=0`);
      await delay(50);
      await show({ turns: [{ question: '解释这里', answer: readingAnswer + '\n\n新增内容。', status: 'generating' }] });
      if (await card.webContents.executeJavaScript(`document.querySelector('.card-scroll').scrollTop`) !== 0) throw new Error('Streaming stole scroll position');
      await card.webContents.executeJavaScript(`(()=>{const pane=document.querySelector('.card-scroll');pane.scrollTop=pane.scrollHeight;})()`);
      await delay(50);
      await show({ turns: [{ question: '解释这里', answer: readingAnswer + '\n\n继续追加。'.repeat(12), status: 'generating' }] });
      if (!await card.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.card-scroll');return p.scrollTop+p.clientHeight>=p.scrollHeight-2;})()`)) throw new Error('Bottom follow lost');
      await show({ turns: [{ question: '解释这里', answer: '短回答。', status: 'stopped' }] });
      await show({ turns: [{ question: '解释这里', answer: '', status: 'error', error: '模拟错误，可重试。' }] });
      await show({ turns: [{ question: '解释这里', answer: '重试后较短。', status: 'done' }, { question: '继续解释', answer: '追问回答。', status: 'done' }] });
      if (card.getBounds().height !== 640 || sizes.slice(start).some((value, index, all) => index > 0 && value < all[index - 1])) throw new Error('Same-session card shrank');
      const resizeCount = sizes.length;
      await delay(200);
      if (sizes.length !== resizeCount) throw new Error('Resize feedback loop');
      if (font === 16) {
        await show({ turns: [{ question: '解释这里', answer: '好的设计会让信息更容易理解。\n\n将重要内容放在清晰的位置，减少重复说明，让阅读和操作自然发生。', status: 'done' }] });
        await card.webContents.executeJavaScript(`document.querySelector('.card-scroll').scrollTop=0`);
        await snapshot('card-dynamic-complete');
      }
    }
    await openBlank();
    const id = h.getSession()!.id, compact = card.getBounds();
    for (const source of [settings, stage!]) await source.webContents.executeJavaScript(`window.pingscreen.command({type:'cardHeight',id:${JSON.stringify(id)},height:640})`);
    for (const value of ['NaN', 'Infinity', '-1', '"240"']) await card.webContents.executeJavaScript(`window.pingscreen.command({type:'cardHeight',id:${JSON.stringify(id)},height:${value}})`);
    await card.webContents.executeJavaScript(`window.pingscreen.command({type:'cardHeight',id:'old-session',height:640})`);
    if (JSON.stringify(compact) !== JSON.stringify(card.getBounds())) throw new Error('Invalid resize command accepted');
    checks.push({ label: 'sender/session/finite-height-validation', passed: true });
    const area = display.workArea;
    card.setPosition(area.x + 32, area.y + area.height - compact.height);
    const dragged = card.getBounds();
    await show({ turns: [{ question: '追问', answer: readingAnswer, status: 'done' }] });
    const grown = card.getBounds();
    if (grown.x !== dragged.x || grown.y + grown.height !== area.y + area.height) throw new Error('Bottom growth lost dragged position');
    await assertLayout('bottom-edge-growth');
    // Simulate moving to a display with less work space using the native moved event.
    activeDisplay = { ...display, workArea: { ...area, width: 320, height: 200 } };
    card.emit('moved'); await delay(160);
    if (card.getBounds().width !== 320 || card.getBounds().height !== 200) throw new Error('Moved display did not constrain bounds');
    await assertLayout('moved-to-small-display');
    activeDisplay = display;
    for (const [width, height] of [[400, 600], [320, 200], [900, 200]]) {
      activeDisplay = { ...display, workArea: { ...area, width, height } };
      for (const font of [14, 16, 24]) {
        await openBlank(font);
        await show({ intent: 'explain', turns: [{ question: '解释这里', answer: readingAnswer, status: 'done' }] });
        await assertLayout(`restricted-${width}-${height}-${font}`);
        if (card.getBounds().height !== Math.min(Math.min(640, width), height)) throw new Error('Restricted height cap mismatch');
      }
    }
    activeDisplay = display;
    // Native mouse activation, keyboard activation, and active request cancellation.
    await openBlank();
    const closePoint = await card.webContents.executeJavaScript(`(()=>{const r=document.querySelector('.card-close').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
    card.webContents.sendInputEvent({ type: 'mouseDown', ...closePoint, button: 'left', clickCount: 1 });
    card.webContents.sendInputEvent({ type: 'mouseUp', ...closePoint, button: 'left', clickCount: 1 });
    await until(() => !h.getSession(), 'mouse X closes blank card');
    await openBlank();
    await show({ turns: [{ question: '问题', answer: '已完成', status: 'done' }] });
    await card.webContents.executeJavaScript(`document.querySelector('.card-close').focus()`);
    card.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    card.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
    card.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    await until(() => !h.getSession(), 'keyboard X closes completed card');
    await openBlank();
    const oldId = h.getSession()!.id;
    await card.webContents.executeJavaScript(`window.pingscreen.command({type:'question',id:${JSON.stringify(oldId)},text:'测试关闭'})`);
    const request = h.getSession()!.request;
    if (!request) throw new Error('Missing active request for close test');
    await card.webContents.executeJavaScript(`document.querySelector('.card-close').click()`);
    await until(() => !h.getSession(), 'X closes generating card');
    if (!request.signal.aborted || card.isVisible()) throw new Error('Close did not abort/hide');
    await card.webContents.executeJavaScript(`window.pingscreen.command({type:'cardHeight',id:${JSON.stringify(oldId)},height:640})`);
    await delay(180);
    if (h.getSession() || card.isVisible()) throw new Error('Late response reopened card');
    await openBlank();
    await card.webContents.executeJavaScript(`window.pingscreen.command({type:'cardHeight',id:${JSON.stringify(oldId)},height:640})`);
    if (card.getBounds().height !== 160) throw new Error('Old resize polluted new session');
    checks.push({ label: 'mouse/keyboard/active-generation-X-and-reuse', passed: true });
    writeFileSync(join(dir, 'dynamic-layout.json'), JSON.stringify({ scale, offscreen: true, display, checks }, null, 2));
  } finally {
    screen.getDisplayMatching = originalMatching;
    card.removeListener('resize', recordResize);
    if (scale !== 1) { await card.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride'); card.webContents.debugger.detach(); }
    h.closeSession();
  }
}
