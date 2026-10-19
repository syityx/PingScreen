import { describe, expect, it } from 'vitest';
import { answerCardBounds, answerCardSize, pickAction, pickGestureAction, rectBetween, toPixels, wheelCenter } from '../src/shared/geometry';
import { parseHelperLine, configCommand } from '../src/shared/protocol';
import { physicalToLocal } from '../src/main/coords';
import { DEFAULTS, endpoint, normalize } from '../src/main/settings';
import { SessionGate } from '../src/main/sessionGate';
import { annotateBitmap } from '../src/main/annotation';
import { defaultWheelActions, visibleActions, type WheelSlot } from '../src/shared/wheel';

describe('content sized answer card', () => {
  it.each([[1920,1032,640,160], [480,800,480,160], [900,120,640,120], [320,200,320,160]])('starts compact in a %s by %s work area', (areaWidth,areaHeight,width,height) => {
    const size=answerCardSize({width:areaWidth,height:areaHeight});
    expect(size).toEqual({width,height});
    expect(size.width).toBeLessThanOrEqual(areaWidth);
    expect(size.height).toBeLessThanOrEqual(areaHeight);
    expect(size.height).toBeLessThanOrEqual(size.width);
  });
  it('grows for content, retains attained height and caps at actual width', () => {
    const area = {width:1920,height:1032};
    expect(answerCardSize(area, 194.2)).toEqual({width:640,height:195});
    expect(answerCardSize(area, 100, 210)).toEqual({width:640,height:210});
    expect(answerCardSize(area, 900)).toEqual({width:640,height:640});
    expect(answerCardSize({width:480,height:800}, 900)).toEqual({width:480,height:480});
    expect(answerCardSize({width:320,height:200}, 900, 640)).toEqual({width:320,height:200});
    expect(answerCardSize({width:900,height:200}, 900, 640)).toEqual({width:640,height:200});
  });
  it('preserves dragged position and only shifts inward at work area edges', () => {
    const area = {x:-1280,y:40,width:1280,height:720};
    expect(answerCardBounds(area,{x:-800,y:150},200)).toEqual({x:-800,y:150,width:640,height:200});
    expect(answerCardBounds(area,{x:-300,y:580},900)).toEqual({x:-640,y:120,width:640,height:640});
  });
});
describe('wheel and positioning', () => {
  it('selects the configured identity for any one to six slot arrangement', () => {
    const center={x:400,y:300};
    for(let n=1;n<=6;n++) {
      const slots=defaultWheelActions().slice(0,n).reverse();
      slots.forEach((slot,i)=>{
        const angle=-Math.PI/2+i*2*Math.PI/n;
        const p={x:center.x+90*Math.cos(angle),y:center.y+90*Math.sin(angle)};
        expect(pickAction(p,center,slots)).toBe(slot.id);
      });
      expect(pickAction(center,center,slots)).toBeNull();
      expect(pickGestureAction({x:0,y:0},{x:0,y:0},{x:128,y:128},slots)).toBeNull();
    }
  });
  it('filters all visible region entries in order without adding hidden slots',()=>{
    const actions:WheelSlot[]=defaultWheelActions();
    actions[1]={id:'region-extra',kind:'builtin',action:'region'};
    expect(visibleActions({wheelSlots:5,wheelActions:actions},true).map(s=>s.id)).toEqual(['slot-1','slot-3','slot-4']);
  });
  it('selects the five intents clockwise starting at the top', () => {
    const center = { x: 500, y: 400 };
    ['explain','translate','rewrite','custom','region'].forEach((action, i) => {
      const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
      expect(pickAction({ x: center.x + Math.cos(a) * 90, y: center.y + Math.sin(a) * 90 }, center, 5)).toBe(action);
    });
    expect(pickAction(center, center, 5)).toBeNull();
  });
  it('supports four slots and keeps the wheel fully inside a screen edge', () => {
    expect(pickAction({ x: 100, y: 0 }, { x: 100, y: 100 }, 4)).toBe('explain');
    expect(pickAction({ x: 0, y: 100 }, { x: 100, y: 100 }, 4)).toBe('custom');
    expect(wheelCenter({ x: 0, y: 0 }, { width: 1920, height: 1080 })).toEqual({ x: 128, y: 128 });
  });
  it('cancels at the original target even when the visible wheel was moved away from the edge', () => {
    expect(pickGestureAction({x:0,y:0},{x:0,y:0},{x:128,y:128},5)).toBeNull();
    expect(pickGestureAction({x:128,y:38},{x:0,y:0},{x:128,y:128},5)).toBe('explain');
  });
  it('clips backwards region drags to one display', () => {
    expect(rectBetween({ x: 100, y: 90 }, { x: -20, y: 20 }, 200, 100)).toEqual({ x: 0, y: 20, width: 100, height: 70 });
  });
  it('uses actual screenshot dimensions, including non-integer scaling', () => {
    expect(toPixels({ kind: 'point', point: { x: 800, y: 400 } }, { width: 1280, height: 720 }, { width: 1920, height: 1080 })).toEqual({ kind: 'point', point: { x: 1200, y: 600 } });
    expect(toPixels({ kind: 'region', rect: { x: 100, y: 50, width: 200, height: 100 } }, { width: 1280, height: 720 }, { width: 2560, height: 1440 })).toEqual({ kind: 'region', rect: { x: 200, y: 100, width: 400, height: 200 } });
  });
  it('maps a negative-coordinate monitor independently of primary DPI', () => {
    expect(physicalToLocal(-1500, 300, [{ id: 2, dip: { x: -1280, y: 0, width: 1280, height: 720 }, phys: { x: -1920, y: 0, width: 1920, height: 1080 }, scale: 1.5 }])).toEqual({ displayId: 2, x: 280, y: 200 });
  });
});
describe('helper and lifecycle', () => {
  it('never claims plain Alt-click or enables the emote wheel', () => {
    expect(configCommand(DEFAULTS, true)).toMatchObject({ clickPing: false, emoteTrigger: 'off', gameCheck: true, trigger: 'alt' });
  });
  it('rejects malformed helper data', () => {
    expect(parseHelperLine('{"type":"wheelOpen","x":"1","y":3}')).toBeNull();
    expect(parseHelperLine('{"type":"wheelRelease","x":-3,"y":10}')).toMatchObject({ type: 'wheelRelease', x: -3 });
    expect(parseHelperLine('invalid')).toBeNull();
  });
  it('invalidates delayed captures and old requests on close/new gesture', () => {
    const gate = new SessionGate(), first = gate.next();
    expect(gate.current(first)).toBe(true); const next = gate.next();
    expect(gate.current(first)).toBe(false); expect(gate.current(next)).toBe(true);
  });
  it('annotates the perimeter without hiding the centre or mutating the source', () => {
    const source = Buffer.alloc(100 * 80 * 4, 255);
    const painted = annotateBitmap(source, 100, 80, { kind: 'point', point: { x: 50, y: 40 } });
    expect(painted.subarray((40*100+50)*4, (40*100+50)*4+4)).toEqual(Buffer.alloc(4,255));
    expect(painted).not.toEqual(source); expect(source.equals(Buffer.alloc(source.length, 255))).toBe(true);
    expect(() => annotateBitmap(source,100,80,{ kind:'point',point:{x:0,y:0} })).not.toThrow();
  });
});
describe('model settings', () => {
  it('accepts base paths and explicit endpoints, rejects unsafe protocols', () => {
    expect(endpoint('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions');
    expect(endpoint('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234/v1/chat/completions');
    expect(() => endpoint('file:///secret')).toThrow(); expect(() => endpoint('https://user:key@example.com')).toThrow();
  });
  it('normalizes corrupt settings into usable defaults', () => {
    expect(normalize({ trigger: 'bogus', wheelSlots: 8, dragThresholdPx: -1 })).toMatchObject({ trigger: 'alt', wheelSlots: 5, dragThresholdPx: 3 });
    expect(normalize({ dragThresholdPx: NaN }).dragThresholdPx).toBe(8);
  });
});
