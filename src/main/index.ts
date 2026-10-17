import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, screen, shell, Tray, type Display } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputBridge } from './inputBridge';
import { physicalToLocal, type DisplayMap } from './coords';
import { SettingsStore } from './settings';
import { configCommand, type HelperEvent } from '../shared/protocol';
import { isIntent, validRect, type CardState, type Intent, type Point, type StageState, type Target, type TranslationMode, type Turn, type UiEvent } from '../shared/types';
import { answerCardBounds, answerCardSize, pickGestureAction, toPixels, wheelCenter } from '../shared/geometry';
import { annotateBitmap } from './annotation';
import { askModel, initialQuestion, messagesFor } from './model';
import { SessionGate } from './sessionGate';
import { mkdirSync } from 'node:fs';
import { runSmoke } from './smoke';
import { CaptureClient } from './capture';
import { focusRect } from './focus';
import { scrollTranslation } from '../shared/translation';

const SMOKE = !app.isPackaged && process.argv.includes('--smoke');
if (SMOKE) { const dir = join(app.getAppPath(), '.tools/smoke/userdata'); mkdirSync(dir, { recursive: true }); app.setPath('userData', dir); }

app.setName('pingscreen');
nativeTheme.themeSource = 'light';
// The capture worker outputs SDR sRGB, including tone-mapped HDR frames.
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.setAppUserModelId('com.pingscreen.app');
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch(error => { dialog.showErrorBox('pingscreen 启动失败', String(error)); app.quit(); });

interface Session {
  token: number; id: string; display: Display; origin: Point; cursor: Point; wheelCenter: Point;
  target: Target; capturedAt: string; shot?: Electron.NativeImage; release?: Point; stage?: StageState; card?: CardState;
  request?: AbortController; requestId: number; intent?: Intent; slots: 4 | 5; image?: string; choosing?: boolean;
  translationMode: TranslationMode; translationRemainder: number;
  modelImages?: { annotated: string; focus: { image: string; rect: import('../shared/types').Rect } };
  cardHeight?: number; cardContentHeight?: number;
}

function start(): void {
  if (process.platform !== 'win32') { dialog.showErrorBox('pingscreen', '首版仅支持 Windows。'); app.quit(); return; }
  const store = new SettingsStore(SMOKE ? join(app.getAppPath(), '.tools/smoke/config') : join(app.getPath('appData'), 'pingscreen'), safeStorage);
  const helperPath = app.isPackaged ? join(process.resourcesPath, 'hook-helper.exe') : join(app.getAppPath(), 'native/hook-helper/build/hook-helper.exe');
  const bridge = new InputBridge({ command: helperPath, args: SMOKE ? ['--simulate'] : [] });
  const captureClient = new CaptureClient(app.isPackaged ? join(process.resourcesPath, 'capture-helper.exe') : join(app.getAppPath(), 'native/hook-helper/build/capture-helper.exe'));
  const gate = new SessionGate();
  const stages = new Map<number, BrowserWindow>();
  let maps = screen.getAllDisplays().map(d => ({ id: d.id, dip: d.bounds, phys: screen.dipToScreenRect(null, d.bounds), scale: d.scaleFactor }));
  const ready = new Map<BrowserWindow, Promise<void>>();
  let session: Session | undefined;
  let enabled = true, quitting = false, testing = false;
  let settingsWindow: BrowserWindow | undefined, cardWindow: BrowserWindow | undefined;
  let resizingCard = false;

  function createWindow(role: 'stage' | 'card' | 'settings', display?: Display): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workArea;
    const win = new BrowserWindow({
      ...(display ? display.bounds : role === 'card' ? answerCardSize(workArea) : { width: Math.min(1000, workArea.width), height: Math.min(900, workArea.height) }),
      show: false, frame: role === 'settings', transparent: role !== 'settings', backgroundColor: role === 'settings' ? '#f7f8fa' : '#00000000',
      resizable: role === 'settings', movable: role !== 'stage', minimizable: role === 'settings', maximizable: role === 'settings',
      focusable: role !== 'stage', skipTaskbar: role !== 'settings', alwaysOnTop: role !== 'settings', hasShadow: role !== 'stage', fullscreenable: false,
      title: 'pingscreen', icon: join(app.getAppPath(), 'build/icon.png'),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: SMOKE ? false : role !== 'stage', spellcheck: false, webSecurity: true, offscreen: SMOKE },
    });
    win.setMenu(null);
    if (role === 'stage') { win.setIgnoreMouseEvents(true); win.setAlwaysOnTop(true, 'screen-saver'); }
    if (role === 'card') win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const loading = devUrl ? win.loadURL(`${devUrl}/?role=${role}`) : win.loadFile(join(__dirname, '../renderer/index.html'), { query: { role } });
    ready.set(win, loading);
    loading.catch(() => { if (!quitting) dialog.showErrorBox('pingscreen', '界面无法加载，请重新启动应用。'); });
    win.on('focus', syncSuspension); win.on('blur', () => setTimeout(syncSuspension, 0));
    win.on('closed', () => { ready.delete(win); syncSuspension(); });
    if (role === 'card') win.on('close', event => { if (!quitting) { event.preventDefault(); closeSession(); } });
    if (role === 'card') win.on('moved', () => { if (!resizingCard && session?.card) resizeCard(session); });
    if (role === 'settings') win.on('close', event => { if (!quitting) { event.preventDefault(); win.hide(); syncSuspension(); } });
    return win;
  }
  function stageFor(d: Display): BrowserWindow {
    let win = stages.get(d.id);
    if (!win || win.isDestroyed()) { win = createWindow('stage', d); stages.set(d.id, win); }
    return win;
  }
  function syncSuspension(): void {
    if (quitting) return;
    const focused = BrowserWindow.getFocusedWindow();
    bridge.send({ type: 'suspend', on: focused === cardWindow || focused === settingsWindow || session?.stage?.mode === 'region' || session?.stage?.mode === 'regionIntent' });
  }
  function send(win: BrowserWindow | undefined, event: UiEvent): void { if (win && !win.isDestroyed()) win.webContents.send('pingscreen:event', event); }
  function status(): void {
    const event: UiEvent = { type: 'status', state: { helper: bridge.status, enabled } };
    send(settingsWindow, event); send(cardWindow, event); refreshTray();
  }
  function hideStages(): void {
    for (const win of stages.values()) {
      if (win.isDestroyed()) continue;
      win.hide(); win.setIgnoreMouseEvents(true); win.setFocusable(false); send(win, { type: 'stage', state: null });
    }
  }
  function closeSession(): void {
    gate.next();
    const old = session; session = undefined;
    old?.request?.abort();
    hideStages(); cardWindow?.hide(); send(cardWindow, { type: 'card', state: null }); syncSuspension();
  }
  function live(s: Session): boolean { return session === s && gate.current(s.token); }
  function resizeCard(s: Session): void {
    if (!live(s) || !s.card || !cardWindow || cardWindow.isDestroyed()) return;
    const current = cardWindow.getBounds();
    const area = screen.getDisplayMatching(current).workArea;
    const next = answerCardBounds(area, current, s.cardContentHeight, s.cardHeight);
    s.cardHeight = next.height;
    if (current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height) return;
    resizingCard = true;
    try { cardWindow.setResizable(true); cardWindow.setBounds(next); }
    finally { cardWindow.setResizable(false); resizingCard = false; }
  }
  function displayMaps(): DisplayMap[] {
    return maps;
  }
  function local(s: Session, p: Point): Point {
    const converted = physicalToLocal(p.x, p.y, displayMaps(), s.display.id);
    return converted ? { x: converted.x, y: converted.y } : s.cursor;
  }
  async function capture(s: Session): Promise<void> {
    const frameReady = () => { if (live(s) && !s.release) void showWheel(s); };
    if (SMOKE) {
      // Deliberately separate immutable frame acquisition from slow PNG delivery.
      await new Promise(resolve => setTimeout(resolve, 25)); frameReady();
      await new Promise(resolve => setTimeout(resolve, 140));
      if (!live(s)) return;
      s.shot = nativeImage.createFromBitmap(Buffer.alloc(1200 * 800 * 4, 240), { width: 1200, height: 800 });
      s.image = s.shot.toDataURL();
    } else {
      const result = await captureClient.capture(screen.dipToScreenRect(null, s.display.bounds), frameReady);
      if (!live(s)) return;
      s.shot = nativeImage.createFromBuffer(result.png);
      s.image = `data:image/png;base64,${result.png.toString('base64')}`;
    }
    if (!live(s)) return;
    const size = s.shot.getSize();
    if (size.width < 10 || size.height < 10) throw new Error('截图尺寸无效，请重试。');
    if (s.release) { await choose(s, s.release); return; }
    if (s.stage?.mode === 'wheel') { s.stage.image = s.image; send(stages.get(s.display.id), { type: 'stage', state: s.stage }); }
  }
  async function showWheel(s: Session): Promise<void> {
    s.stage = { id: s.id, image: s.image ?? '', width: s.display.bounds.width, height: s.display.bounds.height, origin: s.origin, wheelCenter: s.wheelCenter, cursor: s.cursor, mode: 'wheel', target: s.target, wheelSlots: s.slots, translationMode: s.translationMode };
    const win = stageFor(s.display); await ready.get(win);
    if (!live(s)) return;
    if (s.release || s.card || s.stage?.mode !== 'wheel') return;
    send(win, { type: 'stage', state: s.stage }); win.showInactive(); win.setBounds(s.display.bounds);
  }
  function moveCursor(s: Session, point: Point) {
    const previous = pickGestureAction(s.cursor, s.origin, s.wheelCenter, s.slots);
    s.cursor = local(s, point);
    const action = pickGestureAction(s.cursor, s.origin, s.wheelCenter, s.slots);
    if (action !== previous) s.translationRemainder = 0;
    if (s.stage) {
      s.stage.cursor = s.cursor;
      if (action !== previous) send(stages.get(s.display.id), { type: 'cursor', id: s.id, point: s.cursor });
    }
    return action;
  }
  function handle(ev: HelperEvent): void {
    if (ev.type === 'wheelOpen' && enabled) {
      closeSession(); settingsWindow?.hide();
      const point = physicalToLocal(ev.x, ev.y, displayMaps());
      const display = point && screen.getAllDisplays().find(d => d.id === point.displayId);
      if (!point || !display) return;
      const origin = { x: point.x, y: point.y };
      const s: Session = { token: gate.next(), id: randomUUID(), display, origin, cursor: origin, wheelCenter: wheelCenter(origin, display.bounds), target: { kind: 'point', point: origin }, capturedAt: new Date().toISOString(), requestId: 0, slots: store.get().wheelSlots, translationMode: 'point', translationRemainder: 0 };
      session = s;
      void capture(s).catch(error => { if (live(s)) void showCard(s, 'explain', String((error as Error).message)); });
    } else if (ev.type === 'wheelScroll' && session && !session.card && !session.release && !session.choosing && (!session.stage || session.stage.mode === 'wheel')) {
      const s = session;
      if (moveCursor(s, ev) !== 'translate') return;
      const next = scrollTranslation(s.translationMode, s.translationRemainder, ev.delta);
      s.translationRemainder = next.remainder;
      if (s.translationMode === next.mode) return;
      s.translationMode = next.mode;
      if (s.stage) { s.stage.translationMode = next.mode; send(stages.get(s.display.id), { type: 'translationMode', id: s.id, mode: next.mode }); }
    } else if ((ev.type === 'wheelMove' || ev.type === 'wheelRelease') && session && !session.card && !session.choosing && (!session.stage || session.stage.mode === 'wheel')) {
      const s = session;
      const action = moveCursor(s, ev);
      if (ev.type === 'wheelRelease') {
        s.release = s.cursor;
        if (!action) { closeSession(); return; }
        stages.get(s.display.id)?.hide();
        if (s.shot) void choose(s, s.cursor);
      }
    } else if (ev.type === 'cancel' && session && (!session.stage || session.stage.mode === 'wheel') && !session.card) closeSession();
    else if (ev.type === 'toggled') { enabled = ev.enabled; if (!enabled) closeSession(); status(); }
  }
  async function choose(s: Session, cursor: Point): Promise<void> {
    if (!live(s) || s.card || s.choosing || (s.stage && s.stage.mode !== 'wheel')) return;
    s.choosing = true;
    const action = pickGestureAction(cursor, s.origin, s.wheelCenter, s.slots);
    if (!action) { closeSession(); return; }
    if (action === 'region') {
      s.translationMode = 'point'; s.translationRemainder = 0;
      s.stage = { id: s.id, image: s.image!, width: s.display.bounds.width, height: s.display.bounds.height, origin: s.origin, wheelCenter: s.wheelCenter, cursor, mode: 'region', target: s.target, wheelSlots: 4 };
      const win = stageFor(s.display); await ready.get(win); if (!live(s)) return;
      bridge.send({ type: 'suspend', on: true }); win.setFocusable(true); win.setIgnoreMouseEvents(false);
      send(win, { type: 'stage', state: s.stage }); win.show(); win.focus();
    } else { await showCard(s, action); if (live(s) && action !== 'custom') void request(s, initialQuestion(action, '', s.translationMode)); }
  }
  async function showCard(s: Session, intent: Intent, error?: string): Promise<void> {
    if (!live(s)) return;
    s.intent = intent;
    s.card = { id: s.id, image: s.image ?? '', target: s.shot ? toPixels(s.target, s.display.bounds, s.shot.getSize()) : s.target, intent, capturedAt: s.capturedAt, turns: error ? [{ question: '读取屏幕', answer: '', status: 'error', error }] : [], awaitingQuestion: intent === 'custom' && !error, translationMode: s.translationMode, answerFontSize: store.get().answerFontSize };
    hideStages(); s.stage = undefined;
    cardWindow ??= createWindow('card');
    await ready.get(cardWindow); if (!live(s)) return;
    const area = s.display.workArea;
    const anchor = s.target.kind === 'point' ? s.origin : s.target.rect;
    const bounds = answerCardBounds(area, { x: s.display.bounds.x + anchor.x + 24, y: s.display.bounds.y + anchor.y + 24 });
    s.cardHeight = bounds.height; s.cardContentHeight = 160;
    // Fixed-size Windows windows need their native size constraint released for a new work area.
    resizingCard = true;
    try { cardWindow.setResizable(true); cardWindow.setBounds(bounds); }
    finally { cardWindow.setResizable(false); resizingCard = false; }
    send(cardWindow, { type: 'card', state: s.card });
    if (intent === 'custom' && !error) { cardWindow.show(); cardWindow.focus(); }
    else cardWindow.showInactive();
    syncSuspension();
  }
  function updateCard(s: Session): void { if (live(s) && s.card) send(cardWindow, { type: 'card', state: { ...s.card, image: '' } }); }
  function stop(s: Session): void {
    s.requestId++; s.request?.abort(); s.request = undefined;
    const turn = s.card?.turns.at(-1); if (turn?.status === 'generating') turn.status = 'stopped'; updateCard(s);
  }
  async function request(s: Session, question: string, retry = false): Promise<void> {
    if (!live(s) || !s.card || !s.shot) return;
    stop(s);
    const run = ++s.requestId;
    const controller = new AbortController(); s.request = controller;
    if (retry && s.card.turns.length) s.card.turns.pop();
    const turn: Turn = { question, answer: '', status: 'generating' }; s.card.turns.push(turn); s.card.awaitingQuestion = false; updateCard(s);
    const current = () => live(s) && s.requestId === run;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 90_000);
    // Throttle UI packets so a full screenshot is not re-sent for every token.
    let uiTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const size = s.shot.getSize();
      const target = toPixels(s.target, s.display.bounds, size);
      if (!s.modelImages) {
        const annotated = nativeImage.createFromBitmap(annotateBitmap(s.shot.toBitmap(), size.width, size.height, target), { ...size, scaleFactor: 1 }).toDataURL();
        const rect = focusRect(target, size);
        s.modelImages = { annotated, focus: { image: s.shot.crop(rect).toDataURL(), rect } };
      }
      await askModel(store.get(), store.key(), messagesFor(s.modelImages.annotated, size, target, s.card.turns, s.modelImages.focus, s.intent === 'translate' && target.kind === 'point' ? s.translationMode : undefined), controller.signal, text => {
        if (!current()) return;
        turn.answer += text;
        if (!uiTimer) uiTimer = setTimeout(() => { uiTimer = undefined; if (current()) updateCard(s); }, 60);
      });
      if (current()) turn.status = 'done';
    } catch (error) {
      if (current()) {
        turn.status = 'error';
        turn.error = timedOut ? '模型响应超时，请重试。' : controller.signal.aborted ? '生成已停止。' : error instanceof TypeError ? '无法连接模型服务，请检查地址和网络。' : (error as Error).message;
      }
    } finally {
      clearTimeout(timer); clearTimeout(uiTimer);
      if (current()) { s.request = undefined; updateCard(s); }
    }
  }
  async function openSettings(): Promise<void> {
    closeSession(); settingsWindow ??= createWindow('settings');
    await ready.get(settingsWindow); if (quitting) return;
    settingsWindow.show(); settingsWindow.focus(); status();
  }
  app.on('second-instance', () => void openSettings());
  app.on('window-all-closed', () => { /* Keep the tray app alive. */ });
  const tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'build/tray.png')));
  tray.setToolTip('pingscreen · Alt + 左键拖动');
  tray.on('click', () => void openSettings());
  function refreshTray(): void {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '模型与手势设置', click: () => void openSettings() },
      { label: enabled ? '暂停' : '恢复', click: () => { enabled = !enabled; bridge.send({ type: 'setEnabled', enabled }); if (!enabled) closeSession(); status(); } },
      { label: `输入助手：${bridge.status}`, enabled: false },
      { label: '重启输入助手', click: () => { closeSession(); bridge.retry(); } },
      { type: 'separator' }, { label: '退出', click: () => app.quit() },
    ]));
  }
  function authorized(sender: Electron.WebContents, role: 'stage' | 'card' | 'settings'): boolean {
    if (role === 'settings') return sender === settingsWindow?.webContents;
    if (role === 'card') return sender === cardWindow?.webContents;
    return !!session && sender === stages.get(session.display.id)?.webContents;
  }
  ipcMain.handle('pingscreen:init', event => {
    if (authorized(event.sender, 'settings')) return { role: 'settings', settings: store.public(), status: { helper: bridge.status, enabled } };
    if (authorized(event.sender, 'card')) return { role: 'card', card: session?.card ?? null };
    if ([...stages.values()].some(win => win.webContents === event.sender)) return { role: 'stage', stage: session?.stage ?? null };
    throw new Error('未知窗口。');
  });
  ipcMain.handle('pingscreen:settings', (event, raw) => {
    if (!authorized(event.sender, 'settings')) throw new Error('无权修改设置。');
    if (raw === undefined) return store.public();
    const result = store.save(raw);
    closeSession(); bridge.send(configCommand(store.get(), enabled)); syncSuspension();
    if (!SMOKE && Object.hasOwn(raw, 'launchAtStartup')) app.setLoginItemSettings({ name: 'pingscreen', openAtLogin: result.launchAtStartup, args: ['--hidden'] }); return result;
  });
  ipcMain.handle('pingscreen:test', async (event, raw: unknown) => {
    if (!authorized(event.sender, 'settings')) throw new Error('无权测试连接。');
    if (testing) throw new Error('连接测试正在进行。');
    if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw new Error('测试配置格式无效。');
    const draft = (raw ?? {}) as Record<string, unknown>;
    if (draft.apiKey !== undefined && (typeof draft.apiKey !== 'string' || draft.apiKey.length > 8192)) throw new Error('测试密钥格式无效。');
    const { config, key } = store.testConnection(draft);
    testing = true;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const pixels = Buffer.alloc(32 * 32 * 4, 255);
      const image = nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }).toDataURL();
      let answer = '';
      await askModel(config, key, [{ role: 'user', content: [{ type: 'text', text: '这是一张连接测试图片。请只回复 OK。' }, { type: 'image_url', image_url: { url: image } }] }], controller.signal, text => { answer += text; });
      return { ok: true, message: '连接成功，模型能够接收图片。' };
    } finally { testing = false; clearTimeout(timer); }
  });
  ipcMain.handle('pingscreen:command', async (event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const command = raw as Record<string, unknown>;
    if (authorized(event.sender, 'settings') && command.type === 'openLolPing') {
      await shell.openExternal('https://github.com/darrenprx/lolPing'); return;
    }
    if (authorized(event.sender, 'settings') && command.type === 'setEnabled' && typeof command.enabled === 'boolean') {
      enabled = command.enabled; bridge.send({ type: 'setEnabled', enabled });
      if (!enabled) closeSession(); status(); return;
    }
    const isCard = authorized(event.sender, 'card'), isStage = authorized(event.sender, 'stage');
    if (!isCard && !isStage) return;
    const s = session;
    if (!s || command.id !== s.id) return;
    if (command.type === 'close') { closeSession(); return; }
    if (command.type === 'region' && isStage && s.stage?.mode === 'region' && validRect(command.rect)) {
      const r = command.rect;
      if (r.x < 0 || r.y < 0 || r.x + r.width > s.display.bounds.width + 0.5 || r.y + r.height > s.display.bounds.height + 0.5) return;
      s.target = { kind: 'region', rect: r }; s.stage.target = s.target; s.stage.mode = 'regionIntent'; s.stage.wheelSlots = 4;
      s.stage.wheelCenter = wheelCenter({ x: r.x + r.width / 2, y: r.y + r.height / 2 }, s.display.bounds);
      send(stages.get(s.display.id), { type: 'stage', state: s.stage }); return;
    }
    if (command.type === 'intent' && isStage && s.stage?.mode === 'regionIntent' && isIntent(command.intent)) {
      await showCard(s, command.intent); if (live(s) && command.intent !== 'custom') void request(s, initialQuestion(command.intent, '')); return;
    }
    if (!isCard || !s.card) return;
    if (command.type === 'cardHeight') {
      if (typeof command.height !== 'number' || !Number.isFinite(command.height) || command.height < 0) return;
      s.cardContentHeight = command.height; resizeCard(s); return;
    }
    if (command.type === 'stop') stop(s);
    if (command.type === 'question' && typeof command.text === 'string' && command.text.trim() && command.text.length <= 8000 && !s.request) {
      void request(s, s.card.turns.length ? command.text.trim() : initialQuestion(s.intent!, command.text));
    }
    if (command.type === 'retry') {
      if (!s.shot) { closeSession(); return; }
      const turn = s.card.turns.at(-1); if (turn && !s.request) void request(s, turn.question, true);
    }
    if (command.type === 'settings') void openSettings();
    if (command.type === 'copy' && Number.isInteger(command.index)) {
      const turn = s.card.turns[command.index as number]; if (turn?.answer) await clipboard.writeText(turn.answer);
    }
    if (command.type === 'link' && typeof command.url === 'string') {
      let url: URL; try { url = new URL(command.url); } catch { return; }
      const found = s.card.turns.some(turn => turn.answer.includes(command.url as string));
      if (found && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) await shell.openExternal(url.href);
    }
  });
  function displaysChanged(): void {
    closeSession();
    maps = screen.getAllDisplays().map(d => ({ id: d.id, dip: d.bounds, phys: screen.dipToScreenRect(null, d.bounds), scale: d.scaleFactor }));
    for (const win of stages.values()) if (!win.isDestroyed()) win.destroy(); stages.clear();
    for (const d of screen.getAllDisplays()) stageFor(d);
    if (!SMOKE) for (const d of screen.getAllDisplays()) captureClient.prepare(screen.dipToScreenRect(null, d.bounds));
  }
  screen.on('display-added', displaysChanged); screen.on('display-removed', displaysChanged); screen.on('display-metrics-changed', displaysChanged);
  bridge.on('event', handle);
  bridge.on('status', () => { if (bridge.status !== 'running') closeSession(); status(); });
  bridge.on('event', (event: HelperEvent) => { if (event.type === 'ready') syncSuspension(); });
  bridge.send(configCommand(store.get(), enabled));
  for (const d of screen.getAllDisplays()) stageFor(d);
  cardWindow = createWindow('card');
  if (!SMOKE) { captureClient.start(); for (const d of screen.getAllDisplays()) captureClient.prepare(screen.dipToScreenRect(null, d.bounds)); }
  bridge.start(); refreshTray();
  if (!process.argv.includes('--hidden')) void openSettings();
  app.on('before-quit', () => {
    quitting = true; closeSession(); tray.destroy();
    captureClient.close();
    void bridge.stop(); for (const win of BrowserWindow.getAllWindows()) win.destroy();
  });
  if (SMOKE) void runSmoke({ handle, getSession: () => session, getSettings: () => settingsWindow, getCard: () => cardWindow, getStage: () => session ? stages.get(session.display.id) : undefined, store, closeSession });
}
