import React from 'react';
import { DEAD_ZONE, WHEEL_RADIUS } from '../shared/geometry';
import type { Point, TranslationMode } from '../shared/types';
import type { WheelItem } from '../shared/wheel';
import { Icon } from './Icons';

export function Wheel({ actions, activeId, center, translationMode, onPick }: {
  actions: WheelItem[]; activeId?: string | null; center?: Point; translationMode?: TranslationMode; onPick?: (id: string | null) => void;
}): React.JSX.Element {
  const n=actions.length, step=2*Math.PI/n;
  const polar=(radius:number,angle:number)=>[radius*Math.cos(angle),radius*Math.sin(angle)];
  const sector=(a:number,b:number)=>{
    const p=polar(DEAD_ZONE,a),q=polar(WHEEL_RADIUS,a),r=polar(WHEEL_RADIUS,b),s=polar(DEAD_ZONE,b);
    return `M${p} L${q} A${WHEEL_RADIUS},${WHEEL_RADIUS} 0 ${b-a>Math.PI?1:0} 1 ${r} L${s} A${DEAD_ZONE},${DEAD_ZONE} 0 ${b-a>Math.PI?1:0} 0 ${p} Z`;
  };
  const single=`M0,-${WHEEL_RADIUS} A${WHEEL_RADIUS},${WHEEL_RADIUS} 0 1 1 0,${WHEEL_RADIUS} A${WHEEL_RADIUS},${WHEEL_RADIUS} 0 1 1 0,-${WHEEL_RADIUS} M0,-${DEAD_ZONE} A${DEAD_ZONE},${DEAD_ZONE} 0 1 0 0,${DEAD_ZONE} A${DEAD_ZONE},${DEAD_ZONE} 0 1 0 0,-${DEAD_ZONE} Z`;
  const keyPick=(event:React.KeyboardEvent,id:string|null)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onPick?.(id);}};
  return <svg className={`wheel ${center?'':'wheel-preview'}`} width="256" height="256" viewBox="-128 -128 256 256" style={center?{left:center.x-128,top:center.y-128}:undefined} aria-label="选择功能">
    <circle r="119" className="wheel-rim" />
    {actions.map((item,i)=>{
      const angle=-Math.PI/2+i*step,[x,y]=polar(77,angle);
      const translation=item.action==='translate'&&translationMode!==undefined;
      const label=translation?`${item.name} · ${translationMode==='line'?'条':'点'}`:item.name;
      return <g key={item.id} data-slot={item.id} data-action={item.action??'prompt'} className={`slice ${activeId===item.id?'active':''}`} role={onPick?'button':undefined} tabIndex={onPick?0:undefined} aria-label={label} onClick={()=>onPick?.(item.id)} onKeyDown={e=>keyPick(e,item.id)}>
        <title>{label}{translation?' · 滚轮切换点 / 条':''}</title>
        <path d={n===1?single:sector(angle-step/2+0.015,angle+step/2-0.015)} />
        <foreignObject x={x-12} y={y-12} width="24" height="24"><Icon name={item.icon} size={24}/></foreignObject>
        {translation&&<foreignObject x={x+16} y={y-8} width="16" height="16"><Icon name="scroll" size={16}/></foreignObject>}
      </g>;
    })}
    <g className="wheel-cancel" role={onPick?'button':undefined} tabIndex={onPick?0:undefined} aria-label="取消" onClick={()=>onPick?.(null)} onKeyDown={e=>keyPick(e,null)}><title>取消</title><circle r="30"/><foreignObject x="-9" y="-9" width="18" height="18"><Icon name="close" size={18}/></foreignObject></g>
  </svg>;
}
