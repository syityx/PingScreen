import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Rect } from '../shared/types';
export interface FrameInfo { id: number; width: number; height: number; hdr: boolean; whiteLevel: number; backend: string; format: number; captureMs: number }
export interface CaptureResult { png: Buffer; frame: FrameInfo; totalMs: number }
interface Job { id: number; rect: Rect; onFrame: (frame: FrameInfo) => void; resolve: (result: CaptureResult) => void; reject: (error: Error) => void; frame?: FrameInfo; timer: ReturnType<typeof setTimeout> }
/** Persistent capture worker. The pipe carries metadata + PNG; no images are written to disk. */
export class CaptureClient {
  private child?: ChildProcessWithoutNullStreams;
  private incoming: Buffer = Buffer.alloc(0);
  private body?: { id: number; bytes: number; totalMs: number; png: Buffer; received: number };
  private readonly jobs = new Map<number, Job>();
  private serial = 0;
  private closed = false;
  constructor(private readonly command: string, private readonly args: string[] = []) {}
  start(): void {
    if (this.child || this.closed) return;
    const child = spawn(this.command, this.args, { stdio: ['pipe','pipe','pipe'], windowsHide: true }); this.child = child;
    child.stdout.on('data', (data: Buffer) => { if (this.child === child) { this.incoming = this.incoming.length ? Buffer.concat([this.incoming,data]) : data; this.parse(); } });
    child.stdin.on('error', () => { if (this.child === child) this.restart('截图助手连接中断，请重试。'); });
    child.on('error', () => { if (this.child === child) this.restart('截图助手未能启动，请检查安装文件。'); });
    child.on('exit', () => { if (this.child === child) { this.child = undefined; this.fail('截图助手退出，请重试。'); } });
    child.stderr.resume();
  }
  prepare(rect: Rect): void {
    this.start(); this.child?.stdin.write(`prepare ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}\n`);
  }
  capture(rect: Rect, onFrame: (frame: FrameInfo) => void = () => {}): Promise<CaptureResult> {
    if (this.closed) return Promise.reject(new Error('截图助手已关闭。'));
    this.start(); const id = ++this.serial;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => this.restart('截图超时，请重试。'), 5000);
      this.jobs.set(id,{id,rect,onFrame,resolve,reject,timer});
      this.child!.stdin.write(`${id} ${Math.round(rect.x)} ${Math.round(rect.y)} ${Math.round(rect.width)} ${Math.round(rect.height)}\n`);
    });
  }
  private parse(): void {
    try {
      while (this.incoming.length) {
        if (this.body) {
          const body = this.body;
          const count = Math.min(this.incoming.length, body.bytes - body.received);
          this.incoming.copy(body.png, body.received, 0, count);
          body.received += count; this.incoming = this.incoming.subarray(count);
          if (body.received < body.bytes) return;
          const png = body.png; this.body = undefined;
          const job = this.jobs.get(body.id);
          if(job) { clearTimeout(job.timer); this.jobs.delete(job.id); if(!job.frame) job.reject(new Error('截图缺少尺寸信息。')); else job.resolve({png,frame:job.frame,totalMs:body.totalMs}); }
          continue;
        }
        const end = this.incoming.indexOf(10); if(end<0) { if(this.incoming.length>4096) throw new Error('Invalid capture header'); return; }
        const event = JSON.parse(this.incoming.subarray(0,end).toString('utf8')); this.incoming = this.incoming.subarray(end+1);
        const job = this.jobs.get(event.id);
        if(event.event==='frame' && job) {
          if(!Number.isInteger(event.width) || !Number.isInteger(event.height) || event.width<1 || event.height<1 || event.width>16384 || event.height>16384) throw new Error('Invalid capture dimensions');
          job.frame=event; job.onFrame(event);
        }
        if(event.event==='image') {
          if(!Number.isInteger(event.bytes) || event.bytes<8 || event.bytes>128*1024*1024) throw new Error('Invalid image size');
          this.body={id:event.id,bytes:event.bytes,totalMs:event.totalMs,png:Buffer.allocUnsafe(event.bytes),received:0};
        }
        if(event.event==='error' && job) { clearTimeout(job.timer); this.jobs.delete(job.id); job.reject(new Error('无法截取当前画面。请关闭其他屏幕捕获程序后重试。')); }
      }
    } catch { this.restart('截图助手返回的数据不完整，请重试。'); }
  }
  private restart(message: string): void { const child = this.child; this.child = undefined; this.fail(message); child?.kill(); }
  private fail(message: string): void {
    for(const job of this.jobs.values()) { clearTimeout(job.timer); job.reject(new Error(message)); }
    this.jobs.clear(); this.incoming=Buffer.alloc(0); this.body=undefined;
  }
  close(): void { this.closed=true; this.fail('截图助手已关闭。'); this.child?.stdin.end('quit\n'); this.child?.kill(); }
}
