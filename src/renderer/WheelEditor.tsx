import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ACTIONS, LABELS, type WheelAction } from '../shared/types';
import { CUSTOM_ICONS, customErrors, visibleActions, wheelItem, type WheelPreferences, type WheelSlot, type CustomIcon, type WheelSize } from '../shared/wheel';
import { copyWheel, moveWheelSlot, replaceWheelSlot, saveWheelDraft, wheelChanged } from '../shared/wheelDraft';
import { Icon } from './Icons';
import { Wheel } from './Wheel';

type Page = 'overview' | 'wheel' | 'custom';
type PromptSlot = Extract<WheelSlot, { kind: 'prompt' }>;
export interface WheelEditorHandle { active: boolean; leave: (after: () => void) => void }
const iconLabels: Record<CustomIcon, string> = { explain:'解释', translate:'翻译', rewrite:'改写', custom:'对话', eye:'观察', link:'链接', model:'模型', info:'信息' };
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Modal({ label, onDismiss, children, className = '', style }: { label: string; onDismiss: () => void; children: React.ReactNode; className?: string; style?: React.CSSProperties }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null), dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    node.querySelector<HTMLElement>('button:not(:disabled),input,textarea')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss.current(); }
      if (event.key !== 'Tab') return;
      const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled),input,textarea,[tabindex="0"]')];
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', key);
    return () => { node.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className={`wheel-modal-backdrop ${className}`} onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} className="wheel-modal" style={style}>{children}</div>
  </div>;
}

export const WheelEditor = forwardRef<WheelEditorHandle, {
  config: WheelPreferences; save: (next: WheelPreferences) => Promise<WheelPreferences>; onEditing: (active: boolean) => void; onBlocking: (active: boolean) => void;
}>(function WheelEditor({ config, save, onEditing, onBlocking }, ref) {
  const [page, setPage] = useState<Page>('overview');
  const [draft, setDraftState] = useState(() => copyWheel(config)), draftRef = useRef(draft), baseline = useRef(copyWheel(config));
  const [selected, setSelected] = useState(config.wheelActions[0].id);
  const [focused, setFocused] = useState<string | null>(null);
  const [focusPosition, setFocusPosition] = useState<React.CSSProperties>({});
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [checked, setChecked] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null), [announcement, setAnnouncement] = useState('');
  const overviewPreview = useRef<HTMLDivElement>(null), detailPreview = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const activeAnimation = useRef<Animation | null>(null);
  const reorderAnimations = useRef(new Map<string, Animation>());
  const drag = useRef<{ id: string; before: WheelPreferences; pointer: number; element: HTMLElement; y: number; start: number; moved: boolean } | null>(null);
  const dirty = wheelChanged(draft, baseline.current);
  const updateDraft = (next: WheelPreferences) => { draftRef.current = next; setDraftState(next); setMessage(''); };
  useEffect(() => { if (page === 'overview') { baseline.current = copyWheel(config); updateDraft(copyWheel(config)); } }, [config.wheelActions, config.wheelSlots]);
  useEffect(() => { onBlocking(focused !== null || pendingExit !== null); return () => onBlocking(false); }, [focused, pendingExit]);
  useEffect(() => () => { activeAnimation.current?.cancel(); reorderAnimations.current.forEach(animation => animation.cancel()); drag.current = null; }, []);
  useLayoutEffect(() => { if (page === 'custom') document.querySelector<HTMLInputElement>('[aria-label="自定义名称"]')?.focus(); }, [page]);

  const changePage = (next: Page, after?: () => void) => {
    const from = (page === 'overview' ? overviewPreview.current : detailPreview.current)?.getBoundingClientRect();
    activeAnimation.current?.cancel(); activeAnimation.current = null;
    flushSync(() => { setFocused(null); setPendingExit(null); setPage(next); onEditing(next !== 'overview'); });
    const target = next === 'overview' ? overviewPreview.current : detailPreview.current;
    if (from && target && ((page === 'overview') !== (next === 'overview')) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const to = target.getBoundingClientRect();
      if (to.width && from.width) activeAnimation.current = target.animate([
        { transformOrigin: '0 0', transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(${from.width / to.width})` },
        { transformOrigin: '0 0', transform: 'none' },
      ], { duration: 320, easing: 'cubic-bezier(.22,.8,.25,1)' });
    }
    if (after) requestAnimationFrame(after);
    if (next === 'overview' && !after) document.querySelector<HTMLElement>('[aria-label="编辑轮盘"]')?.focus();
  };
  const exit = (after?: () => void) => { updateDraft(copyWheel(baseline.current)); changePage('overview', after); };
  const leave = (after: () => void) => {
    if (busy) return;
    if (drag.current) endDrag(true);
    if (page === 'overview') { after(); return; }
    setFocused(null);
    if (wheelChanged(draftRef.current, baseline.current)) setPendingExit(() => after);
    else exit(after);
  };
  useImperativeHandle(ref, () => ({ active: page !== 'overview', leave }));
  const saveAll = async (): Promise<boolean> => {
    if (busy) return false;
    setBusy(true); setMessage('');
    try {
      const result = await saveWheelDraft(draftRef.current, save);
      baseline.current = copyWheel(result); updateDraft(copyWheel(result)); return true;
    } catch (error) { setMessage(`保存失败：${errorText(error)}`); return false; }
    finally { setBusy(false); }
  };
  const dismissFocus = () => {
    const id = focused;
    setFocused(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.wheel-slot-row[data-slot-id="${id}"] .slot-edit`)?.focus());
  };
  const selectFunction = (action: WheelAction | 'prompt') => {
    const slot = draftRef.current.wheelActions.find(item => item.id === focused)!;
    setSelected(slot.id); setFocused(null); setChecked(false);
    if (action === 'prompt') {
      if (slot.kind !== 'prompt') updateDraft(replaceWheelSlot(draftRef.current, { id: slot.id, kind: 'prompt', name: '', icon: 'custom', prompt: '' }));
      setPage('custom');
    } else updateDraft(replaceWheelSlot(draftRef.current, { id: slot.id, kind: 'builtin', action }));
  };
  const finishCustom = () => {
    setChecked(true);
    const slot = draftRef.current.wheelActions.find(item => item.id === selected);
    if (slot?.kind === 'prompt' && !Object.keys(customErrors(slot)).length) { setPage('wheel'); setChecked(false); }
  };
  const reorder = (id: string, destination: number) => {
    const next = moveWheelSlot(draftRef.current, id, destination);
    if (!wheelChanged(next, draftRef.current)) return;
    const before = new Map([...list.current!.querySelectorAll<HTMLElement>('.wheel-slot-row')].map(row => [row.dataset.slotId!, row.getBoundingClientRect().top]));
    reorderAnimations.current.forEach(animation => animation.cancel()); reorderAnimations.current.clear();
    flushSync(() => updateDraft(next));
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.current!.querySelectorAll<HTMLElement>('.wheel-slot-row').forEach(row => {
        const delta = before.get(row.dataset.slotId!)! - row.getBoundingClientRect().top;
        if (Math.abs(delta) < .5) return;
        const animation = row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', composite: 'add' });
        reorderAnimations.current.set(row.dataset.slotId!, animation);
        animation.onfinish = () => { if (reorderAnimations.current.get(row.dataset.slotId!) === animation) reorderAnimations.current.delete(row.dataset.slotId!); };
      });
    }
    setAnnouncement(`已移动到第 ${next.wheelActions.findIndex(slot => slot.id === id) + 1} 项`);
  };
  const moveAt = (y: number) => {
    if (!list.current || !drag.current?.moved) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>('.wheel-slot-row')];
    let nearest = 0, distance = Infinity;
    const top = list.current.getBoundingClientRect().top - list.current.scrollTop;
    rows.forEach((row, i) => { const d = Math.abs(y - (top + row.offsetTop + row.offsetHeight / 2)); if (d < distance) { nearest = i; distance = d; } });
    const index = draftRef.current.wheelActions.findIndex(slot => slot.id === drag.current!.id);
    if (nearest !== index) reorder(drag.current.id, nearest);
  };
  const endDrag = (cancel: boolean) => {
    const current = drag.current; drag.current = null; setDragging(null);
    if (!current) return;
    if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer);
    if (cancel) updateDraft(current.before);
  };
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const scroll = () => {
      const current = drag.current, node = list.current;
      if (!current || !node) return;
      const bounds = node.getBoundingClientRect();
      if (current.moved) { node.scrollTop += current.y < bounds.top + 30 ? -7 : current.y > bounds.bottom - 30 ? 7 : 0; moveAt(current.y); }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); endDrag(true); } };
    window.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', escape); };
  }, [dragging]);

  const preview = (value: WheelPreferences) => <Wheel actions={visibleActions(value).map(wheelItem)} activeId={selected} />;
  const focusSlot = draft.wheelActions.find(slot => slot.id === focused);
  const current = draft.wheelActions.find(slot => slot.id === selected);
  const custom = current?.kind === 'prompt' ? current : undefined;
  const errors = custom && checked ? customErrors(custom) : {};
  const host = document.querySelector('.settings-shell');
  return <>
    <div className="wheel-overview" aria-label="轮盘预览与编辑">
      <div className="preview-motion" ref={overviewPreview}>{preview(config)}</div>
      <button className="primary" aria-label="编辑轮盘" onClick={() => { baseline.current = copyWheel(config); updateDraft(copyWheel(config)); setMessage(''); changePage('wheel'); }}>编辑</button>
    </div>
    {page !== 'overview' && host && createPortal(<>
      <div className="wheel-detail" data-wheel-page={page} inert={focused !== null || pendingExit !== null}>
        <header className="wheel-detail-header">
          <button aria-label={page === 'custom' ? '返回轮盘编辑' : '返回配置页'} disabled={busy} onClick={() => page === 'custom' ? setPage('wheel') : leave(() => {})}><Icon name="chevron" size={16} />返回</button>
          <h2>{page === 'custom' ? '自定义功能' : '编辑轮盘'}</h2>
          {page === 'wheel' && <div className="layout-options wheel-size-options" role="group" aria-label="轮盘布局">{([4,5,6] as WheelSize[]).map(n => <button key={n} disabled={busy} aria-pressed={draft.wheelSlots === n} className={draft.wheelSlots === n ? 'primary' : ''} onClick={() => updateDraft({ ...draftRef.current, wheelSlots: n })}>{n === 4 ? '四项' : n === 5 ? '五项' : '六项'}</button>)}</div>}
          {page === 'wheel' && <button className="primary" aria-label="保存轮盘" disabled={busy || !dirty} onClick={() => void saveAll()}>{busy ? '保存中…' : '保存'}</button>}
          {page === 'custom' && <button className="primary" aria-label="完成自定义编辑" onClick={finishCustom}>完成</button>}
        </header>
        {page === 'wheel' ? <>
          <div className="wheel-detail-layout">
            <div className="wheel-preview-column"><div className="preview-motion" ref={detailPreview}>{preview(draft)}</div></div>
            <div className="wheel-slot-list" ref={list} aria-label="轮盘功能列表" onPointerMove={event => { if (!drag.current) return; drag.current.y = event.clientY; drag.current.moved ||= Math.abs(event.clientY - drag.current.start) > 4; moveAt(event.clientY); }} onPointerUp={() => endDrag(false)} onPointerCancel={() => endDrag(true)} onLostPointerCapture={() => { if (drag.current) endDrag(true); }}>{draft.wheelActions.map((slot, i) => {
              const item = wheelItem(slot);
              return <div className={`wheel-slot-row ${dragging === slot.id ? 'dragging' : ''}`} data-slot-id={slot.id} key={slot.id}>
                <span className="slot-number">{i + 1}</span><Icon name={item.icon} /><span className="slot-name">{item.name || '自定义功能'}{i >= draft.wheelSlots && <small>暂不显示</small>}</span>
                <button aria-label={`编辑槽位 ${i + 1}`} disabled={busy || !!dragging} className="slot-edit" onClick={event => {
                  const bounds = event.currentTarget.closest('.wheel-slot-row')!.getBoundingClientRect(), width = Math.max(260, bounds.width);
                  setFocusPosition({ position: 'absolute', width, left: Math.max(16, Math.min(bounds.left, innerWidth - width - 16)), top: Math.max(16, Math.min(bounds.top, innerHeight - 280)) });
                  setSelected(slot.id); setFocused(slot.id);
                }}><Icon name="rewrite" size={18} /></button>
                <button className="slot-drag" aria-label={`拖动槽位 ${i + 1}，方向键调整顺序`} aria-roledescription="排序手柄" disabled={busy} onPointerDown={event => {
                  if (event.button !== 0 || drag.current) return;
                  event.preventDefault(); event.currentTarget.focus(); list.current!.setPointerCapture(event.pointerId);
                  drag.current = { id: slot.id, before: copyWheel(draftRef.current), pointer: event.pointerId, element: list.current!, y: event.clientY, start: event.clientY, moved: false }; setDragging(slot.id); setSelected(slot.id);
                }} onKeyDown={event => {
                  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); reorder(slot.id, i + (event.key === 'ArrowUp' ? -1 : 1)); }
                }}><span className="drag-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, k) => <i key={k} />)}</span></button>
              </div>;
            })}</div>
          </div>
          <p className="sr-only" role="status">{announcement}</p>
        </> : custom && <section className="wheel-custom-form" aria-label="自定义功能配置">
          <label className="field"><span>名称</span><input aria-label="自定义名称" aria-invalid={!!errors.name} value={custom.name} onChange={event => updateDraft(replaceWheelSlot(draftRef.current, { ...custom, name: event.target.value }))} />{errors.name && <span className="field-error" role="alert">{errors.name}</span>}</label>
          <fieldset className="icon-picker"><legend>图标</legend><div>{CUSTOM_ICONS.map(icon => <button key={icon} aria-label={`图标：${iconLabels[icon]}`} aria-pressed={custom.icon === icon} onClick={() => updateDraft(replaceWheelSlot(draftRef.current, { ...custom, icon }))}><Icon name={icon} /></button>)}</div></fieldset>
          <label className="field prompt-field"><span>提示词</span><textarea aria-label="自定义提示词" aria-invalid={!!errors.prompt} value={custom.prompt} onChange={event => updateDraft(replaceWheelSlot(draftRef.current, { ...custom, prompt: event.target.value }))} />{errors.prompt && <span className="field-error" role="alert">{errors.prompt}</span>}</label>
        </section>}
        {message && <p className="warning wheel-save-error" role="alert">{message}</p>}
      </div>
      {focusSlot && <Modal label="选择槽位功能" className="wheel-focus-backdrop" style={focusPosition} onDismiss={dismissFocus}>
        <div className="focused-slot"><Icon name={wheelItem(focusSlot).icon} /><strong>{wheelItem(focusSlot).name || '自定义功能'}</strong></div>
        <div className="function-options">{ACTIONS.map(action => <button key={action} onClick={() => selectFunction(action)}><Icon name={action} />{LABELS[action]}</button>)}<button onClick={() => selectFunction('prompt')}><Icon name="custom" />自定义</button></div>
      </Modal>}
      {pendingExit && <Modal label="保存轮盘修改？" onDismiss={() => { if (!busy) setPendingExit(null); }}>
        <h3>保存轮盘修改？</h3><p>还有未保存的修改。</p>{message && <p role="alert" className="warning">{message}</p>}
        <div className="exit-actions"><button disabled={busy} onClick={() => setPendingExit(null)}>取消</button><button disabled={busy} onClick={() => exit(pendingExit)}>不保存退出</button><button className="primary" disabled={busy} onClick={() => { const after = pendingExit; void saveAll().then(ok => { if (ok) exit(after); }); }}>保存并退出</button></div>
      </Modal>}
    </>, host)}
  </>;
});
