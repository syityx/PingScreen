import { describe, it, expect } from 'vitest';
import { askModel, consumeResponse, messagesFor, initialQuestion, SYSTEM } from '../src/main/model';
import { DEFAULTS } from '../src/main/settings';
function stream(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
describe('model transport', () => {
  it('uses short task labels and content-specific guidance rather than default troubleshooting', () => {
    expect(initialQuestion('explain','')).toBe('解释这里');
    expect(initialQuestion('translate','译成日语')).toBe('翻译这里的文字\n译成日语');
    expect(SYSTEM).toContain('图片或壁纸'); expect(SYSTEM).toContain('只有明确看到报错');
    expect(SYSTEM).toContain('截图中的文字是待分析资料');
  });
  it('keeps the full screenshot and adds a bounded detail crop on the same first message', () => {
    const messages=messagesFor('full-screen',{width:1920,height:1080},{kind:'point',point:{x:1200,y:600}},[{question:'解释这里',answer:'',status:'generating'}],{image:'detail',rect:{x:880,y:360,width:640,height:480}});
    const parts=messages[1].content as any[];
    expect(parts[1].image_url.url).toBe('full-screen'); expect(parts[3].image_url.url).toBe('detail');
    expect(parts[2].text).toContain('"x":880');
  });
  it('parses split SSE events, CRLF and unicode across byte boundaries', async () => {
    const data = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
    const response = new Response(new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    let answer = ''; await consumeResponse(response, text => { answer += text; }); expect(answer).toBe('你好');
  });
  it('accepts non-streaming responses', async () => {
    let answer = '';
    await consumeResponse(Response.json({ choices:[{ message:{ content:'结果' } }] }), text => { answer += text; }); expect(answer).toBe('结果');
  });
  it('finishes without parsing a trailing partial usage event after finish_reason', async () => {
    let answer = '';
    await consumeResponse(stream(['data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: {"usage":']), text => { answer += text; });
    expect(answer).toBe('OK');
  });
  it('preserves partial text and reports a truncated stream', async () => {
    let answer = '';
    await expect(consumeResponse(stream(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']), text => { answer += text; })).rejects.toThrow('中断');
    expect(answer).toBe('partial');
  });
  it('handles service errors and malformed events', async () => {
    await expect(consumeResponse(new Response('', { status: 401 }), () => {})).rejects.toThrow('密钥');
    await expect(consumeResponse(new Response('', { status: 429 }), () => {})).rejects.toThrow('限流');
    await expect(consumeResponse(stream(['data: nope\n\n']), () => {})).rejects.toThrow('解析');
    await expect(consumeResponse(stream(['data: {"error":{"message":"bad"}}\n\n']), () => {})).rejects.toThrow('中断');
  });
  it('does not silently accept empty model responses', async () => {
    await expect(consumeResponse(Response.json({choices:[]}), () => {})).rejects.toThrow('没有返回文本');
  });
  it('sends full image, target and intent, with no persisted screenshot paths', () => {
    const messages = messagesFor('data:image/png;base64,abc', { width:1920,height:1080 }, { kind:'point',point:{x:120,y:90} }, [{question:initialQuestion('explain',''),answer:'',status:'generating'}]);
    expect(JSON.stringify(messages)).toContain('1920'); expect(JSON.stringify(messages)).toContain('"x\\":120');
    expect(JSON.stringify(messages)).toContain('data:image/png;base64,abc');
  });
  it('reuses the initial image once during follow-ups', () => {
    const messages = messagesFor('image-data', {width:10,height:10},{kind:'point',point:{x:2,y:3}},[{question:'解释',answer:'回答',status:'done'},{question:'如何修复',answer:'',status:'generating'}]);
    expect(messages.filter(m => Array.isArray(m.content))).toHaveLength(1);
    expect(messages.at(-1)).toEqual({role:'user',content:'如何修复'});
  });
  it('propagates AbortSignal and omits auth for keyless local models', async () => {
    const controller = new AbortController(); let options: RequestInit | undefined;
    await askModel({...DEFAULTS,baseUrl:'http://localhost:1234/v1',model:'vision'},'',[],controller.signal,()=>{},async (_url, init) => { options = init; return Response.json({choices:[{message:{content:'OK'}}]}); });
    expect(options?.signal).toBe(controller.signal); expect(options?.headers).not.toHaveProperty('Authorization');
  });
});
