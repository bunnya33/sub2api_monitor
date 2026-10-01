import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults, settingsSchema } from '../src/shared/model';

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true },
  updater: { autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: true,
    on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
}));
vi.mock('electron', () => ({ app: mocks.app }));
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }));
import { Updates } from '../src/main/updates';

describe.runIf(process.platform === 'win32')('update check scheduling', () => {
  let updates: Updates;
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    mocks.app.isPackaged = true;
    mocks.updater.checkForUpdates.mockResolvedValue(null);
    updates = new Updates(vi.fn());
  });
  afterEach(() => { updates.stop(); vi.useRealTimers(); });

  it('checks immediately and then every ten minutes without downloading', async () => {
    updates.start(); updates.start();
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(mocks.updater.autoDownload).toBe(false);
    expect(mocks.updater.autoInstallOnAppQuit).toBe(false);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(3);
  });
  it('uses the saved interval at startup', async () => {
    updates = new Updates(vi.fn(), undefined, 3);
    updates.start();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('replaces the previous schedule immediately when the setting changes', async () => {
    updates.start();
    await vi.advanceTimersByTimeAsync(240_000);
    updates.setCheckInterval(2);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(4);
  });
  it('keeps the existing deadline when the same interval is saved', async () => {
    updates.start();
    await vi.advanceTimersByTimeAsync(300_000);
    updates.setCheckInterval(10);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('does not overlap a pending network request', async () => {
    let complete!: () => void;
    mocks.updater.checkForUpdates.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    updates.start();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it('stops timers and ignores later setting changes after shutdown', async () => {
    updates.start(); updates.stop(); updates.setCheckInterval(1);
    await vi.advanceTimersByTimeAsync(1_200_000);
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it('keeps development previews off the real update service', async () => {
    mocks.app.isPackaged = false;
    updates.start(); updates.setCheckInterval(1);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(mocks.updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it('reports manual checks in progress and shares the request with automatic checks', async () => {
    let complete!: () => void;
    mocks.updater.checkForUpdates.mockReturnValueOnce(new Promise<void>(resolve => { complete = resolve; }));
    updates.start();
    expect(updates.state.checking).toBe(true);
    const manual = updates.check();
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledTimes(1);
    complete();
    expect(await manual).toEqual({ ok: true, value: undefined });
    expect(updates.state.checking).toBe(false);
    expect(updates.state.status).toBe('idle');
  });
  it('publishes a discovered version without downloading it', async () => {
    updates.start(); await vi.advanceTimersByTimeAsync(0);
    const available = mocks.updater.on.mock.calls.find(([event]) => event === 'update-available')![1];
    mocks.updater.checkForUpdates.mockImplementationOnce(async () => { available({ version: '9.9.9' }); });
    expect(await updates.check()).toEqual({ ok: true, value: undefined });
    expect(updates.state).toMatchObject({ status: 'available', version: '9.9.9', checking: false });
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled();
  });
  it('returns a failed check to the menu and allows a later retry', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      updates.start(); await vi.advanceTimersByTimeAsync(0);
      mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error('network unavailable'));
      expect(await updates.check()).toEqual({ ok: false, error: 'network unavailable' });
      expect(updates.state.checking).toBe(false);
      expect(await updates.check()).toEqual({ ok: true, value: undefined });
    } finally { logged.mockRestore(); }
  });
});

it('defaults to ten minutes and accepts a positive whole-minute interval', () => {
  expect(defaults.updateCheckMinutes).toBe(10);
  expect(settingsSchema.partial().parse({ updateCheckMinutes: 1 }).updateCheckMinutes).toBe(1);
  for (const value of [0, -1, .5, 10081]) expect(settingsSchema.partial().safeParse({ updateCheckMinutes: value }).success).toBe(false);
});
