import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ANSWER_FONT_SIZE, type PublicSettings, type Status } from '../shared/types';
import { PROVIDERS, providerFor, type ProviderId, type ConnectionProfile } from '../shared/providers';
import { Icon, type IconName } from './Icons';
import { WheelEditor, type WheelEditorHandle } from './WheelEditor';
import { version } from '../../package.json';

const api = window.pingscreen;
type ImmediateSettings = Pick<PublicSettings, 'trigger' | 'dragThresholdPx' | 'wheelSlots' | 'launchAtStartup' | 'answerFontSize'>;
const tabs: { id: string; label: string; icon: IconName }[] = [
  { id: 'model', label: '模型连接', icon: 'model' },
  { id: 'gesture', label: '手势', icon: 'cursor' },
  { id: 'wheel', label: '轮盘', icon: 'region' },
  { id: 'app', label: '应用', icon: 'settings' },
];
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }): React.JSX.Element {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} className={`toggle ${checked ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(!checked)}><span /></button>;
}
export function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [status, setStatus] = useState<Status>({ helper: 'starting', enabled: true });
  const [tab, setTab] = useState('model');
  const [collapsed, setCollapsed] = useState(false);
  const [wheelEditing, setWheelEditing] = useState(false), [wheelBlocking, setWheelBlocking] = useState(false);
  const wheelEditor = useRef<WheelEditorHandle>(null), savedScroll = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigation = useRef<string | null>(null);
  const animation = useRef(0);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [autoMessage, setAutoMessage] = useState(''), [autoFailed, setAutoFailed] = useState(false);
  const enqueue = <T,>(write: () => Promise<T>): Promise<T> => {
    const next = writes.current.then(write); writes.current = next.catch(() => undefined); return next;
  };
  const [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('custom');
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, ConnectionProfile>>>({});
  const [otherModels, setOtherModels] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const unsubscribe = api.onEvent(event => {
      if (event.type === 'status') setStatus(event.state);
      if (event.type === 'settingsClose') {
        const hide = () => { void api.command({ type: 'closeSettings' }); };
        if (wheelEditor.current) wheelEditor.current.leave(hide); else hide();
      }
    });
    void api.init().then(data => { setSettings(data.settings); setProvider(data.settings.provider); if (data.status) setStatus(data.status); }).catch(error => { setMessage(errorText(error)); setFailed(true); });
    return unsubscribe;
  }, []);
  const loaded = settings !== null;
  useLayoutEffect(() => {
    if (!wheelEditing && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
  }, [wheelEditing]);
  useEffect(() => {
    const root = scrollRef.current; if (!root) return;
    let frame = 0;
    let reading: { id: string; offset: number } | undefined;
    let size = { width: root.clientWidth, height: root.clientHeight };
    const cancelAnimation = () => { cancelAnimationFrame(animation.current); animation.current = 0; };
    const track = () => {
      frame = 0;
      if (wheelEditor.current?.active) return;
      const anchor = root.getBoundingClientRect().top + 48;
      const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
      const atBottom = root.scrollTop >= root.scrollHeight - root.clientHeight - 2;
      const current = atBottom ? sections.at(-1) : sections.find(section => section.getBoundingClientRect().bottom > anchor) ?? sections.at(-1);
      if (current?.dataset.section) reading = { id: current.dataset.section, offset: root.scrollTop - current.offsetTop };
      if (navigation.current) setTab(navigation.current);
      else if (current?.dataset.section) setTab(current.dataset.section);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(track); };
    // Short sections can share the same final scroll position. Keep a clicked
    // destination selected until the user takes over scrolling.
    const releaseNavigation = () => { cancelAnimation(); navigation.current = null; schedule(); };
    const scrollbarDown = (event: PointerEvent) => { if (event.target === root) releaseNavigation(); };
    const scrollKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]') || (event.key === ' ' && target.closest('button,a'))) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) releaseNavigation();
    };
    root.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('wheel', releaseNavigation, { passive: true });
    root.addEventListener('touchstart', releaseNavigation, { passive: true });
    root.addEventListener('pointerdown', scrollbarDown);
    root.addEventListener('keydown', scrollKey);
    const resize = new ResizeObserver(() => {
      if (wheelEditor.current?.active) return;
      if (size.width === root.clientWidth && size.height === root.clientHeight) return;
      size = { width: root.clientWidth, height: root.clientHeight };
      cancelAnimation();
      const id = navigation.current ?? reading?.id;
      const section = id && root.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (section) root.scrollTop = section.offsetTop + (navigation.current ? 0 : reading?.offset ?? 0);
      schedule();
    });
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = () => {
      if (!motion.matches || !animation.current) return;
      cancelAnimation();
      const section = root.querySelector<HTMLElement>(`[data-section="${navigation.current}"]`);
      if (section) root.scrollTop = section.offsetTop;
    };
    motion.addEventListener('change', reduceMotion);
    resize.observe(root); schedule();
    return () => {
      root.removeEventListener('scroll', schedule); root.removeEventListener('wheel', releaseNavigation);
      root.removeEventListener('touchstart', releaseNavigation); root.removeEventListener('pointerdown', scrollbarDown);
      root.removeEventListener('keydown', scrollKey); resize.disconnect(); cancelAnimationFrame(frame); cancelAnimation();
      motion.removeEventListener('change', reduceMotion);
    };
  }, [loaded]);
  const navigate = (id: string) => {
    const root = scrollRef.current, section = root?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!root || !section) return;
    cancelAnimationFrame(animation.current); animation.current = 0;
    navigation.current = id; setTab(id);
    const start = root.scrollTop;
    const target = Math.max(0, Math.min(section.offsetTop, root.scrollHeight - root.clientHeight));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - start) < 1) { root.scrollTop = target; return; }
    const started = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / 240);
      root.scrollTop = start + (target - start) * (1 - (1 - progress) ** 3);
      animation.current = progress < 1 ? requestAnimationFrame(step) : 0;
    };
    animation.current = requestAnimationFrame(step);
  };
  if (!settings) return <div className="settings-loading"><Icon name="logo" size={48} className="loading-logo" /><h1>pingscreen</h1><p role="status">{message || '正在读取设置…'}</p></div>;
  const update = (patch: Partial<PublicSettings>) => setSettings(previous => previous ? { ...previous, ...patch } : previous);
  const preset = providerFor(provider);
  const saved = settings.profiles[provider];
  const connection = drafts[provider] ?? saved;
  const otherModel = otherModels[provider] ?? !preset.models.some(model => model.id === connection.model);
  const updateConnection = (patch: Partial<ConnectionProfile>) => {
    setDrafts(previous => ({ ...previous, [provider]: { ...connection, ...patch } }));
    setMessage(''); setFailed(false);
  };
  const changeProvider = (next: ProviderId) => {
    setMessage(key.trim() || clearKey ? '刚才的密钥修改尚未保存，切换后已清空；其他连接草稿仍保留。' : '');
    setFailed(false); setKey(''); setClearKey(false); setProvider(next);
  };
  const autoSave = (patch: Partial<ImmediateSettings>) => {
    update(patch); setAutoMessage(''); setAutoFailed(false);
    void enqueue(() => api.settings(patch)).then(() => { setAutoMessage(''); setAutoFailed(false); }).catch(async error => {
      setAutoMessage(`自动保存失败：${errorText(error)}`); setAutoFailed(true);
      try {
        const persisted = await api.settings();
        setSettings(previous => {
          if (!previous) return previous;
          const rollback: Partial<ImmediateSettings> = {};
          for (const field of Object.keys(patch) as (keyof ImmediateSettings)[]) {
            if (previous[field] === patch[field]) Object.assign(rollback, { [field]: persisted[field] });
          }
          return { ...previous, ...rollback };
        });
      } catch { /* The visible failure remains until the user changes a setting again. */ }
    });
  };
  const trigger = settings.trigger === 'mouse4' ? '鼠标侧键 4' : settings.trigger === 'mouse5' ? '鼠标侧键 5' : settings.trigger.charAt(0).toUpperCase() + settings.trigger.slice(1);
  const gesture = settings.trigger.startsWith('mouse') ? `${trigger}拖动` : `${trigger} + 左键拖动`;
  const ready = status.helper === 'running' && status.enabled;
  const statusTitle = status.helper === 'running' ? status.enabled ? '已就绪' : '已暂停' : status.helper === 'failed' ? '输入助手未启动' : '正在启动';
  const save = async () => {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const next = await enqueue(() => api.settings({ provider, ...connection, apiKey: key, clearKey }));
      update({ provider: next.provider, profiles: next.profiles, baseUrl: next.baseUrl, model: next.model, stream: next.stream, hasKey: next.hasKey, secureStorage: next.secureStorage, keyProblem: next.keyProblem });
      setDrafts(previous => ({ ...previous, [provider]: next.profiles[provider] })); setKey(''); setClearKey(false);
      setMessage('模型配置已保存。');
    } catch (error) { setMessage(errorText(error)); setFailed(true); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const result = await api.test({ provider, ...connection, apiKey: key, clearKey });
      setMessage(`${result.message} 本次测试未保存配置。`);
    } catch (error) { setMessage(errorText(error)); setFailed(true); }
    finally { setBusy(false); }
  };
  const enable = async (enabled: boolean) => {
    try { await api.command({ type: 'setEnabled', enabled }); }
    catch (error) { setMessage(errorText(error)); setFailed(true); }
  };
  const feedback = message && <div className={`save-message ${failed ? 'warning' : 'success'}`} role="status"><Icon name={failed ? 'info' : 'check'} size={16} /><span>{message}</span></div>;
  const autoFeedback = autoFailed && <p className="autosave-message warning" role="status"><Icon name="info" size={14} />{autoMessage}</p>;
  return <main className={`settings-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
    <aside className="settings-sidebar" hidden={wheelEditing} inert={wheelBlocking}>
      <div className="sidebar-header">
      <div className="brand"><span className="brand-mark"><Icon name="logo" size={30} /></span><div><span>pingscreen</span><p>指向，选择，理解。</p></div></div>
      <button type="button" className="sidebar-toggle" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} aria-controls="settings-sidebar-navigation" onClick={() => setCollapsed(value => !value)}><Icon name="chevron" size={18} /></button>
      </div>
      <nav id="settings-sidebar-navigation" aria-label="设置分类">{tabs.map(item => <button key={item.id} data-tab={item.id} aria-label={item.label} title={collapsed ? item.label : undefined} className={`nav-item ${tab === item.id ? 'active' : ''}`} aria-controls={`settings-${item.id}`} aria-current={tab === item.id ? 'location' : undefined} onClick={() => wheelEditor.current?.leave(() => navigate(item.id))}><Icon name={item.icon} size={22} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-help"><p>{gesture}</p><p>Ctrl + Alt + P 暂停 / 恢复</p><p>v{version} · Windows</p></div>
    </aside>
    <div className="settings-content" hidden={wheelEditing} ref={scrollRef} tabIndex={0} aria-label="配置页，向下滚动查看更多设置">
      <section className="settings-page" id="settings-model" data-section="model" aria-label="模型连接">
      <div className="settings-topbar">
      <header className="settings-heading"><h1>设置</h1></header>
      <section className="runtime-status"><span className={`status-dot ${ready ? 'online' : ''}`} /><div><h2>{statusTitle}</h2>{status.helper === 'failed' && <p className="warning">请重启应用后重试</p>}</div><Toggle checked={status.enabled} onChange={value => void enable(value)} label="启用屏幕手势" disabled={status.helper !== 'running'} /></section>
      </div>
        <h2 className="page-section-title">模型连接</h2>
          <section className="settings-panel model-panel">
            <div className="field-row provider-fields">
              <label className="field">服务商<select aria-label="服务商" disabled={busy} value={provider} onChange={event => changeProvider(event.target.value as ProviderId)}>{PROVIDERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              {provider !== 'custom' && <label className="field">模型<select aria-label="模型" disabled={busy} value={otherModel ? '__other__' : connection.model} onChange={event => { const other = event.target.value === '__other__'; setOtherModels(previous => ({ ...previous, [provider]: other })); updateConnection({ model: other ? '' : event.target.value }); }}>{preset.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}<option value="__other__">{provider === 'doubao' ? '填写图片模型 / 部署 ID' : '其他模型（手动填写）'}</option></select></label>}
            </div>
            {provider === 'qwen' && <p className="provider-note">中国大陆地域；其他地域或专属地址请选择自定义。</p>}
            {provider === 'doubao' && <p className="provider-note">填写北京地域的图片模型或部署 ID（ep-…）。</p>}
            {provider === 'custom' && <label className="field provider-url">服务地址<input aria-label="服务地址" type="url" disabled={busy} value={connection.baseUrl} placeholder="https://your-provider.example/v1" onChange={event => updateConnection({ baseUrl: event.target.value })} /></label>}
            <div className="field-row">
              {(provider === 'custom' || otherModel) && <label className="field">{provider === 'custom' ? '模型名称' : '模型 / 部署 ID'}<input aria-label="模型名称" disabled={busy} value={connection.model} placeholder="填写支持图片输入的模型名称" onChange={event => updateConnection({ model: event.target.value })} /></label>}
              <label className="field">API Key<input type="password" disabled={busy} autoComplete="off" value={key} placeholder={clearKey ? '保存后清除现有密钥' : saved.hasKey ? '留空保留现有密钥' : provider === 'custom' ? '本地服务可留空' : '填写服务密钥'} onChange={event => { setKey(event.target.value); setClearKey(false); setMessage(''); }} /></label>
            </div>
            <div className="connection-options"><div className="toggle-label"><Toggle disabled={busy} checked={connection.stream} onChange={stream => updateConnection({ stream })} label="流式显示回答" /><span>流式显示回答</span></div>{saved.hasKey && <button className="text-button" disabled={busy} onClick={() => { setClearKey(!clearKey); setKey(''); setMessage(''); }}>{clearKey ? '撤销清除密钥' : '清除已保存密钥'}</button>}</div>
            {saved.keyProblem && <p className="warning">{saved.keyProblem}</p>}{settings.keyProblem && settings.keyProblem !== saved.keyProblem && <p className="warning">{settings.keyProblem}</p>}{!settings.secureStorage && <p className="warning">系统密钥存储不可用，无法保存 API Key。</p>}
            <div className="settings-buttons"><button disabled={busy || !connection.baseUrl || !connection.model.trim()} onClick={() => void test()}>测试连接</button><button className="primary" disabled={busy || !connection.baseUrl || !connection.model.trim()} onClick={() => void save()}>保存</button></div>
          </section>
        {feedback}
      </section>
      <section className="settings-page" id="settings-gesture" data-section="gesture" aria-label="手势">
          <header className="settings-heading"><h2>手势</h2></header>
          <div className="settings-group">
          <section className="settings-row"><Icon name="cursor" size={20} /><div><h3>触发键</h3></div><select aria-label="触发键" value={settings.trigger} onChange={event => autoSave({ trigger: event.target.value as PublicSettings['trigger'] })}><option value="alt">Alt</option><option value="ctrl">Ctrl</option><option value="shift">Shift</option><option value="mouse4">鼠标侧键 4</option><option value="mouse5">鼠标侧键 5</option></select></section>
          <section className="settings-row threshold-row"><Icon name="move" size={20} /><div><h3>拖动阈值</h3></div><div className="slider-control"><input aria-label="拖动阈值" type="range" min={3} max={40} value={settings.dragThresholdPx} onChange={event => autoSave({ dragThresholdPx: Number(event.target.value) })} /><output>{settings.dragThresholdPx} px</output></div></section>
          </div>
          {autoFeedback}
      </section>
      <section className="settings-page" id="settings-wheel" data-section="wheel" aria-label="轮盘">
          <header className="settings-heading"><h2>轮盘</h2></header>
          <WheelEditor ref={wheelEditor} config={settings} onEditing={active => {
            if (active && !wheelEditing) { savedScroll.current = scrollRef.current?.scrollTop ?? 0; cancelAnimationFrame(animation.current); navigation.current = 'wheel'; setTab('wheel'); }
            setWheelEditing(active);
          }} onBlocking={setWheelBlocking} save={async next => {
            const persisted = await enqueue(() => api.settings(next));
            update({ wheelActions: persisted.wheelActions, wheelSlots: persisted.wheelSlots });
            return persisted;
          }} />
          {autoFeedback}
      </section>
      <section className="settings-page" id="settings-app" data-section="app" aria-label="应用">
          <header className="settings-heading"><h2>应用</h2></header>
          <div className="settings-group">
          <section className="settings-row"><Icon name="power" size={20} /><div><h3>开机启动</h3></div><Toggle checked={settings.launchAtStartup} onChange={launchAtStartup => autoSave({ launchAtStartup })} label="开机启动" /></section>
          <section className="settings-row reading-row"><Icon name="explain" size={20} /><div><h3>回答字号</h3></div><div className="slider-control"><input id="answer-font-size" aria-label="回答字号" type="range" min={ANSWER_FONT_SIZE.min} max={ANSWER_FONT_SIZE.max} step={ANSWER_FONT_SIZE.step} value={settings.answerFontSize} onChange={event => autoSave({ answerFontSize: Number(event.target.value) })} /><output htmlFor="answer-font-size">{settings.answerFontSize} px</output></div></section>
          </div>
          <section className="settings-panel about-panel"><h3>pingscreen {version}</h3><p>Windows 桌面 AI 助手</p></section>
          {autoFeedback}
          <footer className="copyright"><p>© 2026 pingscreen contributors · MIT 协议</p><p><a href="https://github.com/darrenprx/lolPing" onClick={event => { event.preventDefault(); void api.command({ type: 'openLolPing' }).catch(error => { setAutoMessage(errorText(error)); setAutoFailed(true); }); }}>基于 lolPing 开源项目</a> · Copyright © 2026 Danrui Meng</p></footer>
      </section>
    </div>
  </main>;
}
