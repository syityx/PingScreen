import { describe, expect, it } from 'vitest';
import { scrollTranslation } from '../src/shared/translation';
import { parseHelperLine } from '../src/shared/protocol';
import { initialQuestion, messagesFor, TRANSLATION_PROMPTS } from '../src/main/model';
describe('translation wheel mode', () => {
  it('flips in both scroll directions and keeps full multi-notch parity', () => {
    expect(scrollTranslation('point',0,120)).toEqual({mode:'line',remainder:0});
    expect(scrollTranslation('line',0,-120)).toEqual({mode:'point',remainder:0});
    expect(scrollTranslation('point',0,240)).toEqual({mode:'point',remainder:0});
  });
  it('accumulates precision-wheel movement and cancels opposite partial steps', () => {
    let selection=scrollTranslation('point',0,30);
    for(let i=0;i<3;i++)selection=scrollTranslation(selection.mode,selection.remainder,30);
    expect(selection).toEqual({mode:'line',remainder:0});
    expect(scrollTranslation('point',90,-90)).toEqual({mode:'point',remainder:0});
    expect(scrollTranslation('point',0,-150)).toEqual({mode:'line',remainder:-30});
  });
  it('validates signed wheel deltas without accepting malformed helper events', () => {
    expect(parseHelperLine('{"type":"wheelScroll","x":-100,"y":200,"delta":-120}')).toMatchObject({type:'wheelScroll',delta:-120,x:-100});
    for(const delta of ['120',0,0.5,Infinity,50000])expect(parseHelperLine(JSON.stringify({type:'wheelScroll',x:0,y:0,delta}))).toBeNull();
  });
  it('changes only translation instructions, preserving image payloads and point coordinates', () => {
    const image='full-screen',target={kind:'point' as const,point:{x:800,y:400}},size={width:1920,height:1080};
    const detail={image:'same-detail',rect:{x:480,y:160,width:640,height:480}};
    const point=messagesFor(image,size,target,[{question:initialQuestion('translate',''),answer:'',status:'generating'}],detail,'point');
    const line=messagesFor(image,size,target,[{question:initialQuestion('translate','','line'),answer:'',status:'generating'}],detail,'line');
    const pointParts=point[1].content as any[],lineParts=line[1].content as any[];
    expect(pointParts[0].text).toContain(TRANSLATION_PROMPTS.point);expect(lineParts[0].text).toContain(TRANSLATION_PROMPTS.line);
    expect(pointParts[0].text).toContain(JSON.stringify(target));expect(lineParts[0].text).toContain(JSON.stringify(target));
    expect(lineParts.slice(1)).toEqual(pointParts.slice(1));
    expect(initialQuestion('explain','','line')).toBe('解释这里');
  });
  it('retains line scope across follow-ups and leaves rectangular translation unchanged', () => {
    const turns=[{question:'翻译这里的一行文字',answer:'译文',status:'done' as const},{question:'改成英文',answer:'',status:'generating' as const}];
    const messages=messagesFor('screen',{width:1920,height:1080},{kind:'point',point:{x:50,y:50}},turns,undefined,'line');
    expect(JSON.stringify(messages[1])).toContain('翻译模式：条');expect(messages.at(-1)?.content).toBe('改成英文');
    const region=messagesFor('screen',{width:1920,height:1080},{kind:'region',rect:{x:10,y:20,width:100,height:50}},turns,undefined,'line');
    expect(JSON.stringify(region)).not.toContain('翻译模式：条');
  });
});
