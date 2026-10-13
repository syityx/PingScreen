import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACTIONS, LABELS, type CardState, type Point, type StageState, type UiEvent, type WheelAction } from '../shared/types';
import { DEAD_ZONE, pickAction, pickGestureAction, rectBetween, WHEEL_RADIUS } from '../shared/geometry';
import { Icon } from './Icons';
import { Settings } from './Settings';
import './style.css';

const api = window.pingscreen;
const Answer = lazy(() => import('./Answer'));
const role = new URLSearchParams(location.search).get('role') ?? 'settings';
document.body.dataset.role = role;
function useEvents(callback: (event: UiEvent) => void): void {
  const ref = useRef(callback); ref.current = callback;
  useEffect(() => api.onEvent(event => ref.current(event)), []);
}
function Brand({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-mark"><Icon name="logo" size={compact ? 24 : 28} /></span><div><span>pingscreen</span>{!compact && <p>指向，选择，理解。</p>}</div></div>;
}
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Wheel({ state, cursor, onPick }: { state: StageState; cursor: Point; onPick?: (action: WheelAction | null) => void }): React.JSX.Element {
  const n = state.wheelSlots, step = 2 * Math.PI / n;
  const active = state.mode === 'wheel' ? pickGestureAction(cursor, state.origin, state.wheelCenter, n) : pickAction(cursor, state.wheelCenter, n);
  const polar = (radius: number, angle: number) => [radius * Math.cos(angle), radius * Math.sin(angle)];
  const sector = (a: number, b: number) => {
    const p = polar(DEAD_ZONE, a), q = polar(WHEEL_RADIUS, a), r = polar(WHEEL_RADIUS, b), s = polar(DEAD_ZONE, b);
    return `M${p} L${q} A${WHEEL_RADIUS},${WHEEL_RADIUS} 0 0 1 ${r} L${s} A${DEAD_ZONE},${DEAD_ZONE} 0 0 0 ${p} Z`;
  };
  return <svg className="wheel" width="256" height="256" viewBox="-128 -128 256 256" style={{ left: state.wheelCenter.x - 128, top: state.wheelCenter.y - 128 }} aria-label="选择意图">
    <circle r="119" className="wheel-rim" />
    {ACTIONS.slice(0, n).map((action, index) => {
      const angle = -Math.PI / 2 + index * step;
      const [x, y] = polar(77, angle);
      const translation = action === 'translate' && state.mode === 'wheel';
      const label = translation ? `翻译 · ${state.translationMode === 'line' ? '条' : '点'}` : LABELS[action];
      return <g key={action} data-action={action} className={`slice ${active === action ? 'active' : ''}`} role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} aria-label={label} onClick={() => onPick?.(action)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick?.(action); } }}>
        <title>{label}{translation ? ' · 滚轮切换点 / 条' : ''}</title>
        <path d={sector(angle - step / 2 + 0.015, angle + step / 2 - 0.015)} />
        <foreignObject x={x - 12} y={y - 12} width="24" height="24"><Icon name={action} size={24} /></foreignObject>
        {translation && <foreignObject x={x + 16} y={y - 8} width="16" height="16"><Icon name="scroll" size={16} /></foreignObject>}
      </g>;
    })}
    <g className="wheel-cancel" role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined} aria-label="取消" onClick={() => onPick?.(null)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick?.(null); } }}><title>取消</title><circle r="30" /><foreignObject x="-9" y="-9" width="18" height="18"><Icon name="close" size={18} /></foreignObject></g>
  </svg>;
}

function Stage(): React.JSX.Element | null {
  const [state, setState] = useState<StageState | null>(null);
  const [cursor, setCursor] = useState<Point>({ x: 0, y: 0 });
  const [start, setStart] = useState<Point | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const command = (type: string, extra = {}) => { const s = stateRef.current; if (s) void api.command({ type, id: s.id, ...extra }); };
  useEvents(event => {
    if (event.type === 'stage') { setState(event.state); if (event.state) setCursor(event.state.cursor); else setStart(null); }
    if (event.type === 'cursor' && stateRef.current?.id === event.id) setCursor(event.point);
    if (event.type === 'translationMode') setState(previous => previous?.id === event.id ? { ...previous, translationMode: event.mode } : previous);
  });
  useEffect(() => {
    void api.init().then(data => { if (data.stage) { setState(data.stage); setCursor(data.stage.cursor); } });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') command('close'); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  if (!state) return null;
  const position = (event: React.PointerEvent) => ({ x: event.clientX, y: event.clientY });
  const rect = state.target.kind === 'region' ? state.target.rect : start ? rectBetween(start, cursor, state.width, state.height) : null;
  const native = state.mode === 'wheel';
  const translating = native && pickGestureAction(cursor, state.origin, state.wheelCenter, state.wheelSlots) === 'translate';
  const active = state.mode === 'wheel' ? pickGestureAction(cursor, state.origin, state.wheelCenter, state.wheelSlots) : pickAction(cursor, state.wheelCenter, state.wheelSlots);
  return <div className={`stage stage-${state.mode}`} onContextMenu={event => { event.preventDefault(); command('close'); }}
    onPointerDown={event => { if (state.mode === 'region' && event.button === 0) { const p = position(event); setStart(p); setCursor(p); event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerMove={event => { if (!native) setCursor(position(event)); }}
    onPointerUp={event => {
      if (state.mode !== 'region' || !start || event.button !== 0) return;
      const selected = rectBetween(start, position(event), state.width, state.height); setStart(null);
      if (selected.width >= 3 && selected.height >= 3) command('region', { rect: selected });
    }}>
    {state.image && <><img className="frozen-screen" src={state.image} draggable={false} /><div className="screen-shade" /></>}
    <div className="stage-hint"><span className="hint-dot" />{translating ? `${state.translationMode === 'line' ? '条：翻译标点所在行的一段文字' : '点：翻译标点指向的内容'} · 滚轮切换` : state.mode === 'wheel' ? '拖向意图，松开提交' : state.mode === 'region' ? '拖动框选你关注的区域' : '点击轮盘选择意图'}<span className="hint-key">Esc 取消</span></div>
    {rect ? <div className="selection-box" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} /> : <div className="target-ring" style={{ left: state.origin.x, top: state.origin.y }} />}
    {native && Math.hypot(state.origin.x - state.wheelCenter.x, state.origin.y - state.wheelCenter.y) > 1 && <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}><line x1={state.origin.x} y1={state.origin.y} x2={state.wheelCenter.x} y2={state.wheelCenter.y} stroke="#2878e8" strokeWidth="1" strokeDasharray="3 5" /></svg>}
    {state.mode !== 'region' && <Wheel state={state} cursor={cursor} onPick={state.mode === 'regionIntent' ? action => action ? command('intent', { intent: action }) : command('close') : undefined} />}
    {state.mode !== 'region' && <div className="wheel-caption" style={{ left: state.wheelCenter.x, top: Math.min(state.height - 44, state.wheelCenter.y + 132) }}><Icon name={active ?? 'close'} size={16} />{active ? `${LABELS[active]}${translating ? ` · ${state.translationMode === 'line' ? '条' : '点'}` : ''}` : '中心松开取消'}</div>}
    {state.mode === 'region' && <div className="selection-crosshair" style={{ left: cursor.x, top: cursor.y }}>＋</div>}
  </div>;
}

function Preview({ state }: { state: CardState }): React.JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const target = state.target;
  const x = target.kind === 'point' ? target.point.x : target.rect.x;
  const y = target.kind === 'point' ? target.point.y : target.rect.y;
  const percent = { left: `${100 * x / size.width}%`, top: `${100 * y / size.height}%` };
  return <div className="preview"><img ref={imageRef} src={state.image} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
    {target.kind === 'point' ? <span className="preview-dot" style={percent} /> : <span className="preview-rect" style={{ ...percent, width: `${100 * target.rect.width / size.width}%`, height: `${100 * target.rect.height / size.height}%` }} />}
  </div>;
}
function Card(): React.JSX.Element | null {
  const [state, setState] = useState<CardState | null>(null);
  const [question, setQuestion] = useState(''), [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const command = useCallback(async (type: string, extra = {}) => {
    const s = stateRef.current; if (!s) return;
    try { await api.command({ id: s.id, type, ...extra }); } catch (error) { setNotice(errorText(error)); }
  }, []);
  const onLink = useCallback((url: string) => { void command('link', { url }); }, [command]);
  useEvents(event => {
    if (event.type !== 'card') return;
    setState(previous => {
      if (!event.state) { setQuestion(''); setNotice(''); return null; }
      if (previous?.id !== event.state.id) { setQuestion(''); setNotice(''); }
      return { ...event.state, image: event.state.image || (previous?.id === event.state.id ? previous.image : '') };
    });
  });
  useEffect(() => {
    void import('./Answer');
    void api.init().then(data => { if (data.card) setState(data.card); });
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') void command('close'); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (state?.awaitingQuestion) inputRef.current?.focus(); }, [state?.id, state?.awaitingQuestion]);
  useEffect(() => { const el = scrollRef.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 180) el.scrollTop = el.scrollHeight; }, [state?.turns.at(-1)?.answer]);
  if (!state) return null;
  const last = state.turns.at(-1), busy = last?.status === 'generating';
  const submit = () => { if (!question.trim() || busy) return; void command('question', { text: question.trim() }); setQuestion(''); setNotice(''); };
  return <div className="card-shell">
    <header className="card-header"><Brand compact /><div className="header-actions"><button title="模型设置" aria-label="模型设置" onClick={() => void command('settings')}><Icon name="settings" size={18} /></button><button title="关闭" aria-label="关闭" onClick={() => void command('close')}><Icon name="close" size={18} /></button></div></header>
    <div className="card-context"><span className="intent-badge"><Icon name={state.intent} size={14} />{LABELS[state.intent]}{state.intent === 'translate' && state.target.kind === 'point' ? ` · ${state.translationMode === 'line' ? '条' : '点'}` : ''}</span><span>快照 · {new Date(state.capturedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></div>
    <div className="card-scroll" ref={scrollRef}>
      {state.image && <details className="snapshot"><summary><Icon name="eye" size={16} /><span className="snapshot-title">查看 AI 所见画面</span><span>整屏 + 定位</span><Icon name="chevron" size={14} /></summary><Preview state={state} /></details>}
      {state.awaitingQuestion && <div className="empty-state"><span className="empty-symbol"><Icon name="custom" size={28} /></span><h2>你想问这里什么？</h2><p>用一句话描述你的问题，<br />AI 会结合整屏与标点理解。</p></div>}
      {state.turns.map((turn, index) => <section className="turn" key={index}>
        <div className="question-label">{turn.question}</div>
        {turn.answer && <Suspense fallback={<div className="answer">{turn.answer}</div>}><Answer text={turn.answer} onLink={onLink} /></Suspense>}
        {turn.status === 'generating' && <div className="thinking"><span className="thinking-dot" />{turn.answer ? '继续生成中' : '正在理解画面…'}</div>}
        {turn.status === 'error' && <div className="error-box"><strong><Icon name="info" size={16} />{state.image ? '请求未完成' : '无法读取屏幕'}</strong><p>{turn.error}</p><div className="error-actions"><button onClick={() => void command('retry')}><Icon name="refresh" size={14} />{state.image ? '重试' : '关闭并重新标点'}</button><button onClick={() => void command('settings')}>检查设置</button></div></div>}
        {turn.status === 'stopped' && <span className="muted stopped-label"><Icon name="info" size={14} />生成已停止</span>}
        {turn.answer && <div className="answer-tools"><button onClick={() => { void command('copy', { index }).then(() => { setNotice('已复制回答'); setTimeout(() => setNotice(''), 1800); }); }}><Icon name="copy" size={16} />复制回答</button></div>}
      </section>)}
    </div>
    <div className="composer"><textarea ref={inputRef} maxLength={8000} rows={2} placeholder={state.awaitingQuestion ? '描述你的问题…' : '继续问这张画面…'} value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} />
      <div className="composer-footer"><span role="status" className={notice === '已复制回答' ? 'copy-notice' : ''}>{notice || 'Enter 发送 · Shift + Enter 换行'}</span>{busy ? <button className="stop" onClick={() => void command('stop')}><Icon name="stop" size={14} />停止生成</button> : <button className="primary small" disabled={!question.trim() || !state.image} onClick={submit}>发送<Icon name="send" size={16} /></button>}</div>
    </div>
  </div>;
}

createRoot(document.getElementById('root')!).render(role === 'stage' ? <Stage /> : role === 'card' ? <Card /> : <Settings />);
