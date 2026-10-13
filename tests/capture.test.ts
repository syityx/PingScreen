import { describe, expect, it } from 'vitest';
import { CaptureClient } from '../src/main/capture';
import { focusRect } from '../src/main/focus';
const rect = { x: -1920, y: 0, width: 1920, height: 1080 };
function fixture(program: string): CaptureClient { return new CaptureClient(process.execPath, ['-e', program]); }
describe('capture worker framing', () => {
  it('assembles a large image over hundreds of chunks without corrupting binary boundaries', async () => {
    const client=fixture(`process.stdin.once('data',()=>{
      const bytes=8*1024*1024,chunk=Buffer.alloc(16384);for(let i=0;i<chunk.length;i++)chunk[i]=i%256;
      process.stdout.write(JSON.stringify({event:'frame',id:1,width:3840,height:2160,hdr:false,whiteLevel:1000,backend:'dxgi',format:87,captureMs:12})+'\\n'+JSON.stringify({event:'image',id:1,bytes,totalMs:90})+'\\n');
      let sent=0;function write(){while(sent<bytes){sent+=chunk.length;if(!process.stdout.write(chunk)){process.stdout.once('drain',write);return;}}}write();
    });`);
    try {const result=await client.capture(rect);expect(result.png.length).toBe(8*1024*1024);for(const offset of [0,10,4095,16383,16384,1048599,result.png.length-1])expect(result.png[offset]).toBe(offset%256);} finally {client.close();}
  });
  it('announces immutable frame before PNG and preserves split binary/newline bytes', async () => {
    const client = fixture(`
      const readline=require('node:readline');
      readline.createInterface({input:process.stdin}).on('line',line=>{
        if(line==='quit')return process.exit();const id=Number(line.split(' ')[0]);
        const frame=JSON.stringify({event:'frame',id,width:1920,height:1080,hdr:true,whiteLevel:3850,backend:'dxgi',format:10,captureMs:12})+'\\n';
        process.stdout.write(frame.slice(0,9));setTimeout(()=>{process.stdout.write(frame.slice(9));
          setTimeout(()=>{const png=Buffer.from([137,80,78,71,13,10,26,10,123,125]);process.stdout.write(JSON.stringify({event:'image',id,bytes:png.length,totalMs:88})+'\\n');process.stdout.write(png.subarray(0,4));setTimeout(()=>process.stdout.write(png.subarray(4)),10);},120);
        },10);
      });`);
    let ready = false, settled = false;
    let resolveFrame!: () => void; const frame = new Promise<void>(resolve => { resolveFrame=resolve; });
    try {
      const image=client.capture(rect,info=>{ready=true;expect(info.whiteLevel).toBe(3850);resolveFrame();}).then(result=>{settled=true;return result;});
      await frame; expect(ready).toBe(true); expect(settled).toBe(false);
      const result=await image;expect([...result.png]).toEqual([137,80,78,71,13,10,26,10,123,125]);
      expect(result.totalMs).toBe(88);
    } finally {client.close();}
  });
  it('rejects malformed framing instead of presenting a corrupt screenshot', async () => {
    const client=fixture(`process.stdin.once('data',()=>process.stdout.write('{"event":"image","id":1,"bytes":-1}\\n'));`);
    try { await expect(client.capture(rect)).rejects.toThrow('数据不完整'); } finally {client.close();}
  });
  it('restarts on the next capture after the worker exits', async () => {
    const client=fixture(`process.stdin.once('data',()=>process.exit(2));`);
    try {await expect(client.capture(rect)).rejects.toThrow('退出'); await expect(client.capture(rect)).rejects.toThrow('退出');} finally {client.close();}
  });
  it('settles spawn failures and allows a retry instead of retaining a dead process', async () => {
    const client=new CaptureClient('pingscreen-nonexistent-worker.exe');
    try {await expect(client.capture(rect)).rejects.toThrow();await expect(client.capture(rect)).rejects.toThrow();} finally {client.close();}
  });
});
describe('native-resolution focus detail', () => {
  it('clips point crops at display edges and uses full-image pixel coordinates', () => {
    expect(focusRect({kind:'point',point:{x:0,y:0}},{width:1920,height:1080})).toEqual({x:0,y:0,width:320,height:240});
    expect(focusRect({kind:'point',point:{x:1920,y:1080}},{width:1920,height:1080})).toEqual({x:1600,y:840,width:320,height:240});
  });
  it('adds context around a region without crossing the monitor boundary', () => {
    expect(focusRect({kind:'region',rect:{x:10,y:20,width:100,height:60}},{width:1920,height:1080})).toEqual({x:0,y:0,width:134,height:104});
  });
});
