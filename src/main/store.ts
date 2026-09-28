import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaults, migrateLegacyPalette, settingsSchema, type Edge, type Settings } from '../shared/model';
import type { SavedSession, SessionVault } from './api';

export interface Configuration { settings: Settings; server: string; email: string; position: { x: number; y: number; edge: Edge } | null }
export class Store implements SessionVault {
  private configPath = path.join(app.getPath('userData'), 'settings.json');
  private sessionPath = path.join(app.getPath('userData'), 'session.dpapi');
  private fontPath = path.join(app.getPath('userData'), 'custom.ttf');
  loadConfig(): Configuration {
    if (!existsSync(this.configPath)) return { settings: defaults, server: '', email: '', position: null };
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8'));
      const parsed = settingsSchema.parse({ ...defaults, ...raw.settings });
      const settings = raw.paletteVersion === 2 ? parsed : migrateLegacyPalette(parsed);
      const point = raw.position;
      const position = point && Number.isFinite(point.x) && Number.isFinite(point.y) && [null, 'left', 'right', 'top', 'bottom'].includes(point.edge)
        ? { x: point.x, y: point.y, edge: point.edge as Edge } : null;
      return { settings, server: typeof raw.server === 'string' ? raw.server : '', email: typeof raw.email === 'string' ? raw.email : '', position };
    } catch {
      return { settings: defaults, server: '', email: '', position: null };
    }
  }
  saveConfig(value: Configuration): void {
    const temporary = this.configPath + '.tmp';
    writeFileSync(temporary, JSON.stringify({ ...value, paletteVersion: 2 }, null, 2));
    renameSync(temporary, this.configPath);
  }
  save(value: SavedSession): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 安全存储不可用，无法记住登录');
    const temporary = this.sessionPath + '.tmp';
    writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(value)));
    renameSync(temporary, this.sessionPath);
  }
  load(): SavedSession | null {
    if (!existsSync(this.sessionPath) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      const data = JSON.parse(safeStorage.decryptString(readFileSync(this.sessionPath)));
      return typeof data.server === 'string' && typeof data.email === 'string' && typeof data.refreshToken === 'string' ? data : null;
    } catch { return null; }
  }
  clear(): void { rmSync(this.sessionPath, { force: true }); }
  fontFile(): string | null { return existsSync(this.fontPath) ? this.fontPath : null; }
  fontDestination(): string { return this.fontPath; }
  removeFont(): void { rmSync(this.fontPath, { force: true }); }
}
