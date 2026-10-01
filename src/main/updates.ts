import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { defaults, type Result, type UpdateState } from '../shared/model';

export class Updates {
  state: UpdateState = { status: 'idle', version: null, progress: 0, error: null };
  private interval: NodeJS.Timeout | null = null;
  private checkTask: Promise<Result> | null = null;
  private started = false;
  private stopped = false;

  constructor(private changed: (state: UpdateState) => void, private fixtureVersion?: string,
    private checkMinutes = defaults.updateCheckMinutes) {}

  start(): void {
    if (this.started || this.stopped) return;
    if (this.fixtureVersion) {
      this.set({ status: 'available', version: this.fixtureVersion, progress: 0, error: null });
      return;
    }
    if (!app.isPackaged || process.platform !== 'win32') return;
    this.started = true;
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
    this.schedule();
    void this.check();
  }

  setCheckInterval(minutes: number): void {
    if (minutes === this.checkMinutes) return;
    this.checkMinutes = minutes;
    if (this.started && !this.stopped) this.schedule();
  }

  private schedule(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => void this.check(), this.checkMinutes * 60_000);
  }

  async check(): Promise<Result> {
    if (this.stopped) return { ok: false, error: '程序正在退出' };
    if (this.checkTask) return this.checkTask;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return { ok: true, value: undefined };
    if (!app.isPackaged || process.platform !== 'win32') return { ok: false, error: '开发版不检查线上更新' };
    this.set({ ...this.state, checking: true });
    this.checkTask = (async (): Promise<Result> => {
      try { await autoUpdater.checkForUpdates(); return { ok: true, value: undefined }; }
      catch (error) {
        console.error('Update check failed:', error);
        return { ok: false, error: error instanceof Error ? error.message : '检查更新失败' };
      }
    })();
    try { return await this.checkTask; }
    finally { this.checkTask = null; this.set({ ...this.state, checking: false }); }
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
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  private set(state: UpdateState): void {
    if (this.stopped) return;
    this.state = state;
    this.changed(state);
  }
}
