import React, { useEffect, useRef, useState } from 'react';
import type { PublicSettings, Status } from '../shared/types';
import { Icon, type IconName } from './Icons';
import wheelFive from './assets/wheels/wheel-5-idle.svg';
import wheelFour from './assets/wheels/wheel-4-idle.svg';
import { version } from '../../package.json';

const api = window.pingscreen;
type ImmediateSettings = Pick<PublicSettings, 'trigger' | 'dragThresholdPx' | 'wheelSlots' | 'launchAtStartup'>;
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
function Note({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return <aside className="note"><Icon name="info" size={18} /><div><h3>{title}</h3><p>{children}</p></div></aside>;
}
export function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [demo, setDemo] = useState(false);
  const [status, setStatus] = useState<Status>({ helper: 'starting', enabled: true });
  const [tab, setTab] = useState('model');
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigation = useRef<string | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const [autoMessage, setAutoMessage] = useState('修改即自动保存'), [autoFailed, setAutoFailed] = useState(false);
  const enqueue = <T,>(write: () => Promise<T>): Promise<T> => {
    const next = writes.current.then(write); writes.current = next.catch(() => undefined); return next;
  };
  const [key, setKey] = useState(''), [clearKey, setClearKey] = useState(false);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const unsubscribe = api.onEvent(event => { if (event.type === 'status') setStatus(event.state); });
    void api.init().then(data => { setSettings(data.settings); setDemo(data.demo === true); if (data.status) setStatus(data.status); }).catch(error => { setMessage(errorText(error)); setFailed(true); });
    return unsubscribe;
  }, []);
  const loaded = settings !== null;
  useEffect(() => {
    const root = scrollRef.current; if (!root) return;
    let frame = 0;
    const track = () => {
      frame = 0;
      if (navigation.current) { setTab(navigation.current); return; }
      const anchor = root.getBoundingClientRect().top + 48;
      const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-section]'));
      const atBottom = root.scrollTop >= root.scrollHeight - root.clientHeight - 2;
      const current = atBottom ? sections.at(-1) : sections.find(section => section.getBoundingClientRect().bottom > anchor) ?? sections.at(-1);
      if (current?.dataset.section) setTab(current.dataset.section);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(track); };
    // Short sections can share the same final scroll position. Keep a clicked
    // destination selected until the user starts scrolling or resizing.
    const releaseNavigation = () => { navigation.current = null; schedule(); };
    const scrollbarDown = (event: PointerEvent) => { if (event.target === root) releaseNavigation(); };
    const scrollKey = (event: KeyboardEvent) => {
      if (event.target === root && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) releaseNavigation();
    };
    root.addEventListener('scroll', schedule, { passive: true });
    root.addEventListener('wheel', releaseNavigation, { passive: true });
    root.addEventListener('touchstart', releaseNavigation, { passive: true });
    root.addEventListener('pointerdown', scrollbarDown);
    root.addEventListener('keydown', scrollKey);
    const resize = new ResizeObserver(releaseNavigation); resize.observe(root); schedule();
    return () => {
      root.removeEventListener('scroll', schedule); root.removeEventListener('wheel', releaseNavigation);
      root.removeEventListener('touchstart', releaseNavigation); root.removeEventListener('pointerdown', scrollbarDown);
      root.removeEventListener('keydown', scrollKey); resize.disconnect(); cancelAnimationFrame(frame);
    };
  }, [loaded]);
  const navigate = (id: string) => {
    const root = scrollRef.current, section = root?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (!root || !section) return;
    navigation.current = id; setTab(id);
    const target = root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTo({ top: Math.min(target, root.scrollHeight - root.clientHeight), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  if (!settings) return <div className="settings-loading"><Icon name="logo" size={48} className="loading-logo" /><h1>pingscreen</h1><p role="status">{message || '正在读取设置…'}</p></div>;
  const update = (patch: Partial<PublicSettings>) => setSettings(previous => previous ? { ...previous, ...patch } : previous);
  const autoSave = (patch: Partial<ImmediateSettings>) => {
    update(patch); setAutoMessage('正在自动保存…'); setAutoFailed(false);
    void enqueue(() => api.settings(patch)).then(() => { setAutoMessage('已自动保存'); }).catch(async error => {
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
      const next = await enqueue(() => api.settings({ baseUrl: settings.baseUrl, model: settings.model, stream: settings.stream, apiKey: key, clearKey }));
      update({ baseUrl: next.baseUrl, model: next.model, stream: next.stream, hasKey: next.hasKey, secureStorage: next.secureStorage, keyProblem: next.keyProblem }); setKey(''); setClearKey(false);
      setMessage('模型配置已保存。');
    } catch (error) { setMessage(errorText(error)); setFailed(true); }
    finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const result = await api.test({ baseUrl: settings.baseUrl, model: settings.model, stream: settings.stream, apiKey: key, clearKey });
      setMessage(`${result.message} 本次测试未保存配置。`);
    } catch (error) { setMessage(errorText(error)); setFailed(true); }
    finally { setBusy(false); }
  };
  const enable = async (enabled: boolean) => {
    try { await api.command({ type: 'setEnabled', enabled }); }
    catch (error) { setMessage(errorText(error)); setFailed(true); }
  };
  const feedback = message && <div className={`save-message ${failed ? 'warning' : 'success'}`} role="status"><Icon name={failed ? 'info' : 'check'} size={16} /><span>{message}</span></div>;
  const autoFeedback = <p className={`autosave-message ${autoFailed ? 'warning' : ''}`} role="status"><Icon name={autoFailed ? 'info' : 'check'} size={14} />{autoMessage}</p>;
  return <main className="settings-shell">
    <aside className="settings-sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="logo" size={36} /></span><div><span>pingscreen</span><p>指向，选择，理解。</p></div></div>
      <nav aria-label="设置分类">{tabs.map(item => <button key={item.id} data-tab={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} aria-controls={`settings-${item.id}`} aria-current={tab === item.id ? 'location' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon} size={22} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-help"><p>{gesture}</p><p>Ctrl + Alt + P 暂停 / 恢复</p><p>v{version} · Windows{demo ? ' · UI Demo' : ''}</p></div>
    </aside>
    <div className="settings-content" ref={scrollRef} tabIndex={0} aria-label="配置页，向下滚动查看更多设置">
      <section className="settings-page" id="settings-model" data-section="model" aria-label="模型连接">
      <header className="settings-heading"><h1>设置</h1><p>模型连接 · 让屏幕内容成为问题的起点</p></header>
      <section className="runtime-status"><span className={`status-dot ${ready ? 'online' : ''}`} /><div><h2>{statusTitle}</h2><p>{status.helper === 'failed' ? '请重启应用后重试' : !status.enabled ? '恢复后即可在任意应用中标点' : `按住${gesture}，拖向意图后松开提交`}</p></div><span className="status-action-label">{status.enabled ? '开启' : '关闭'}</span><Toggle checked={status.enabled} onChange={value => void enable(value)} label="启用屏幕手势" disabled={status.helper !== 'running'} /></section>
        <h2 className="page-section-title">模型连接</h2>
          <section className="settings-panel model-panel"><div className="panel-heading"><h3>连接你的多模态模型</h3><p>支持图片输入的 Chat Completions 兼容接口</p></div>
            <label className="field">服务地址<input type="url" disabled={busy} value={settings.baseUrl} placeholder="https://your-provider.example/v1" onChange={event => update({ baseUrl: event.target.value })} /></label>
            <div className="field-row"><label className="field">模型名称<input disabled={busy} value={settings.model} placeholder="填写支持图片输入的模型名称" onChange={event => update({ model: event.target.value })} /></label><label className="field">API Key<input type="password" disabled={busy} autoComplete="off" value={key} placeholder={clearKey ? '保存后清除现有密钥' : settings.hasKey ? '留空保留现有密钥' : '填写服务密钥'} onChange={event => { setKey(event.target.value); setClearKey(false); }} /><span className="field-note">{settings.hasKey && !clearKey ? '已安全保存 · 本地服务可留空' : '本地服务可留空'}</span></label></div>
            <div className="connection-options"><div className="toggle-label"><Toggle disabled={busy} checked={settings.stream} onChange={stream => update({ stream })} label="流式显示回答" /><span>流式显示回答</span></div>{settings.hasKey && <button className="text-button" disabled={busy} onClick={() => { setClearKey(!clearKey); setKey(''); }}>{clearKey ? '撤销清除密钥' : '清除已保存密钥'}</button>}</div>
            {settings.keyProblem && <p className="warning">{settings.keyProblem}</p>}{!settings.secureStorage && <p className="warning">系统密钥存储不可用，无法保存 API Key。</p>}
            <div className="settings-buttons"><button disabled={busy || !settings.baseUrl || !settings.model} onClick={() => void test()}>测试连接</button><button className="primary" disabled={busy} onClick={() => void save()}>保存</button></div>
          </section>
          <p className="subtle test-note">连接测试使用生成的图片，不上传你的桌面。</p>
          <Note title="只在你发起手势时读取画面">AI 会收到目标显示器的完整截图、定位信息与局部细节图。截图与对话仅保留在当前会话中。</Note>
        {feedback}
      </section>
      <section className="settings-page" id="settings-gesture" data-section="gesture" aria-label="手势">
          <header className="settings-heading"><h2>手势</h2><p>选择顺手的触发方式，让标点自然发生。</p></header>
          <section className="settings-row"><Icon name="cursor" size={24} /><div><h3>触发键</h3><p>按住此键和鼠标左键拖动；也支持鼠标侧键</p></div><select aria-label="触发键" value={settings.trigger} onChange={event => autoSave({ trigger: event.target.value as PublicSettings['trigger'] })}><option value="alt">Alt</option><option value="ctrl">Ctrl</option><option value="shift">Shift</option><option value="mouse4">鼠标侧键 4</option><option value="mouse5">鼠标侧键 5</option></select></section>
          <section className="settings-row threshold-row"><Icon name="move" size={24} /><div><h3>拖动阈值</h3><p>移动达到阈值后才显示轮盘 · 3–40 px</p></div><div className="slider-control"><input aria-label="拖动阈值" type="range" min={3} max={40} value={settings.dragThresholdPx} onChange={event => autoSave({ dragThresholdPx: Number(event.target.value) })} /><output>{settings.dragThresholdPx} px</output></div></section>
          <Note title="单击继续交给原应用">触发键 + 单击不会提问。手势会替代其他应用的同键拖动；Ctrl + Alt + P 可随时暂停。</Note>
          {autoFeedback}
      </section>
      <section className="settings-page" id="settings-wheel" data-section="wheel" aria-label="轮盘">
          <header className="settings-heading"><h2>轮盘</h2><p>选择意图，松开提交。</p></header>
          <section className="settings-panel wheel-layout"><div><h3>轮盘布局</h3><p>五项包含框选；四项用于快速标点。</p><div className="layout-options" role="group" aria-label="轮盘布局"><button aria-pressed={settings.wheelSlots === 5} className={settings.wheelSlots === 5 ? 'primary' : ''} onClick={() => autoSave({ wheelSlots: 5 })}>五项 · 包含框选</button><button aria-pressed={settings.wheelSlots === 4} className={settings.wheelSlots === 4 ? 'primary' : ''} onClick={() => autoSave({ wheelSlots: 4 })}>四项 · 快速标点</button></div><p className="wheel-help">翻译扇区内，滚轮切换「点 / 条」。<br />点：光标指向的文字；条：所在行的一段文字。</p><p>中心松开、Esc、右键或提前松开触发键取消。</p></div><img src={settings.wheelSlots === 5 ? wheelFive : wheelFour} width="206" height="206" alt={settings.wheelSlots === 5 ? '五项图标轮盘' : '四项图标轮盘'} /></section>
          <Note title="聚焦目标，不改变定位">点与条发送相同截图和定位坐标，仅改变模型理解翻译范围的提示词。新手势默认点模式，追问沿用本次选择。</Note>
          {autoFeedback}
      </section>
      <section className="settings-page" id="settings-app" data-section="app" aria-label="应用">
          <header className="settings-heading"><h2>应用</h2><p>常驻桌面，随时理解屏幕上的内容。</p></header>
          <section className="settings-row"><Icon name="power" size={24} /><div><h3>开机启动</h3><p>启动后常驻系统托盘</p></div><Toggle checked={settings.launchAtStartup} onChange={launchAtStartup => autoSave({ launchAtStartup })} label="开机启动" /></section>
          <section className="settings-panel about-panel"><h3>pingscreen {version}</h3><p>Windows 桌面 AI 助手{demo ? ' · UI Demo' : ''}</p></section>
          <section className="settings-panel security-panel"><Icon name="shield" size={22} /><div><h3>API Key 使用 Windows 系统加密</h3><p>模型服务会按照其自身政策处理请求。</p><p>只发送目标所在显示器；框选仍保留整屏上下文。</p></div></section>
          {autoFeedback}
          <footer className="copyright"><p>© 2026 pingscreen contributors · MIT 协议</p><p><a href="https://github.com/darrenprx/lolPing" onClick={event => { event.preventDefault(); void api.command({ type: 'openLolPing' }).catch(error => { setAutoMessage(errorText(error)); setAutoFailed(true); }); }}>基于 lolPing 开源项目</a> · Copyright © 2026 Danrui Meng</p></footer>
      </section>
    </div>
  </main>;
}
