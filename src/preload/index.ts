import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI, LoginInput, Settings, Snapshot } from '../shared/model';

const api: DesktopAPI = {
  getState: () => ipcRenderer.invoke('state:get'),
  subscribe: listener => {
    const handler = (_: Electron.IpcRendererEvent, state: Snapshot) => listener(state);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  updateSettings: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:update', patch),
  login: (input: LoginInput) => ipcRenderer.invoke('auth:login', input),
  verify: (code: string) => ipcRenderer.invoke('auth:verify', code),
  logout: () => ipcRenderer.invoke('auth:logout'),
  refresh: () => ipcRenderer.invoke('quota:refresh'),
  importFont: () => ipcRenderer.invoke('font:import'),
  removeFont: () => ipcRenderer.invoke('font:remove'),
  drag: (start: boolean, x?: number, y?: number) => ipcRenderer.send('drag', start, x, y),
  dragMove: (x, y) => ipcRenderer.send('drag:move', x, y),
  hover: (surface, inside) => ipcRenderer.send('hover', surface, inside),
  openContextMenu: (x, y) => ipcRenderer.send('context-menu', x, y),
  menuAction: action => ipcRenderer.send('menu:action', action),
  menuHover: inside => ipcRenderer.send('menu:hover', inside),
  closeSettings: () => ipcRenderer.send('settings:close')
};
contextBridge.exposeInMainWorld('desktop', api);
