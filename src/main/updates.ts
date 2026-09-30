import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/model';

const CHECK_INTERVAL = 12 * 60 * 60 * 1000;

export class Updates {
  state: UpdateState = { status: 'idle', version: null, progress: 0, error: null };
  private startupTimer: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(private changed: (state: UpdateState) => void, private fixtureVersion?: string) {}

  start(): void {
    if (this.fixtureVersion) {
      this.set({ status: 'available', version: this.fixtureVersion, progress: 0, error: null });
      return;
    }
    if (!app.isPackaged || process.platform !== 'win32') return;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('update-available', info => {
      if (this.state.status !== 'downloaded') this.set({ status: 'available', version: info.version, progress: 0, error: null });
    });
    autoUpdater.on('update-not-available', () => {
      if (this.state.status === 'idle' || this.state.status === 'available') this.set({ status: 'idle', version: null, progress: 0, error: null });
    });
    autoUpdater.on('download-progress', progress => {
      if (this.state.status === 'downloading') this.set({ ...this.state, progress: Math.round(progress.percent) });
    });
    autoUpdater.on('update-downloaded', info => this.set({ status: 'downloaded', version: info.version, progress: 100, error: null }));
    autoUpdater.on('error', error => {
      if (this.state.status === 'downloading') this.set({ ...this.state, status: 'available', error: error.message });
      else console.error('Update check failed:', error);
    });
    this.startupTimer = setTimeout(() => void this.check(), 60_000);
    this.interval = setInterval(() => void this.check(), CHECK_INTERVAL);
  }

  async check(): Promise<void> {
    if (this.checking || this.state.status === 'downloading' || this.state.status === 'downloaded' || !app.isPackaged) return;
    this.checking = true;
    try { await autoUpdater.checkForUpdates(); }
    catch (error) { console.error('Update check failed:', error); }
    finally { this.checking = false; }
  }

  async confirm(): Promise<void> {
    if (this.state.status === 'downloaded' && !this.fixtureVersion) {
      autoUpdater.quitAndInstall(false, true);
      return;
    }
    if (this.state.status !== 'available') return;
    this.set({ ...this.state, status: 'downloading', progress: 0, error: null });
    if (this.fixtureVersion) return;
    try { await autoUpdater.downloadUpdate(); }
    catch (error) {
      this.set({ ...this.state, status: 'available', error: error instanceof Error ? error.message : '下载更新失败' });
    }
  }

  stop(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.interval) clearInterval(this.interval);
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.changed(state);
  }
}
