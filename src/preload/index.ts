import { contextBridge, ipcRenderer } from 'electron';
import type { UiEvent } from '../shared/types';
const api = {
  init: () => ipcRenderer.invoke('pingscreen:init'),
  settings: (raw?: unknown) => ipcRenderer.invoke('pingscreen:settings', raw),
  test: (raw?: unknown) => ipcRenderer.invoke('pingscreen:test', raw),
  command: (raw: unknown) => ipcRenderer.invoke('pingscreen:command', raw),
  onEvent: (callback: (event: UiEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UiEvent) => callback(payload);
    ipcRenderer.on('pingscreen:event', listener);
    return () => { ipcRenderer.removeListener('pingscreen:event', listener); };
  },
};
contextBridge.exposeInMainWorld('pingscreen', api);
export type PingApi = typeof api;
