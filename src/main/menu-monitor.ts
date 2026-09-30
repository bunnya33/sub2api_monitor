import { screen, utilityProcess, type BrowserWindow } from 'electron';
import path from 'node:path';

// A separate process keeps Windows hook callbacks out of Electron's window/quit loop.
export function watchMenu(window: BrowserWindow, dismiss: () => void, signal: AbortSignal): Promise<(() => void) | null> {
  if (process.platform !== 'win32' || signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const child = utilityProcess.fork(path.join(__dirname, 'menu-monitor-worker.js'), [], { serviceName: 'Tray Menu Monitor', stdio: 'pipe' });
    child.stderr?.on('data', data => console.error('Tray menu watcher:', String(data)));
    let active = true, ready = false;
    const stop = () => {
      if (!active) return;
      active = false;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      child.kill(); // Windows releases the process's hooks immediately, including during app.quit().
    };
    const cancel = () => { stop(); resolve(null); };
    const timeout = setTimeout(() => { console.error('Tray menu watcher did not initialize'); stop(); resolve(null); }, 2500);
    signal.addEventListener('abort', cancel, { once: true });
    child.on('message', (event: { type: string; x?: number; y?: number; error?: string }) => {
      if (!active || window.isDestroyed()) return;
      if (event.type === 'ready') {
        ready = true;
        clearTimeout(timeout);
        resolve(stop);
      } else if (event.type === 'mouse-down' && ready) {
        const point = screen.screenToDipPoint({ x: event.x!, y: event.y! });
        const rect = window.getBounds();
        if (point.x < rect.x || point.x >= rect.x + rect.width || point.y < rect.y || point.y >= rect.y + rect.height) dismiss();
      } else if (event.type === 'dismiss' && ready) dismiss();
      else if (event.type === 'error') {
        console.error('Unable to watch tray menu:', event.error);
        stop(); resolve(null);
      }
    });
    child.once('spawn', () => {
      const handle = window.getNativeWindowHandle();
      child.postMessage({ handle: (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString() });
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      if (!active) return;
      active = false;
      if (ready) dismiss(); else resolve(null);
    });
  });
}
