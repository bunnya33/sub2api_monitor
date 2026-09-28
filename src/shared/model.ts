import { z } from 'zod';

export const settingsSchema = z.object({
  metric: z.enum(['used', 'remaining']), showFive: z.boolean(), autoCollapse: z.boolean(),
  summary: z.enum(['worst', 'both', 'five', 'seven']), barWidth: z.number().int().min(40).max(240),
  nameWidth: z.number().int().min(36).max(200), topWidth: z.number().int().min(120).max(400),
  sideWidth: z.number().int().min(48).max(240), autoRefresh: z.boolean(),
  refreshSeconds: z.number().int().min(5).max(3600), rotateSeconds: z.number().int().min(2).max(60),
  fadeInactive: z.boolean(), inactiveOpacity: z.number().int().min(20).max(100),
  normalColor: z.string().regex(/^#[0-9a-f]{6}$/i), warningColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  criticalColor: z.string().regex(/^#[0-9a-f]{6}$/i), fontSize: z.number().int().min(10).max(20),
  fontBold: z.boolean(), fontName: z.string().max(260), rememberSession: z.boolean(),
  selectedIds: z.array(z.number().int().positive()).max(100), aliases: z.record(z.string(), z.string().max(40)),
  demo: z.boolean()
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  metric: 'used', showFive: true, autoCollapse: true, summary: 'worst', barWidth: 68,
  nameWidth: 62, topWidth: 178, sideWidth: 64, autoRefresh: true, refreshSeconds: 60, rotateSeconds: 4,
  fadeInactive: true, inactiveOpacity: 65, normalColor: '#83cbaa', warningColor: '#ffa600',
  criticalColor: '#ed9c98', fontSize: 12, fontBold: false, fontName: '', rememberSession: true,
  selectedIds: [1, 2], aliases: {}, demo: true
};
export type Edge = 'left' | 'right' | 'top' | 'bottom' | null;
export type Period = 'five' | 'seven';
export interface Rect { x: number; y: number; width: number; height: number }
export interface Account { id: number; name: string; platform: string; type: string; status: string }
export interface QuotaWindow { used: number; resetsAt: number | null }
export interface Quota extends Account {
  five: QuotaWindow | null; seven: QuotaWindow | null; source: string;
  updatedAt: number | null; fetchedAt: number | null; error: string | null;
}
export interface Connection { status: 'demo' | 'disconnected' | 'authenticating' | 'twoFactor' | 'connected' | 'expired' | 'error'; server: string; email: string; message: string }
export interface Snapshot {
  settings: Settings; connection: Connection; available: Account[]; quotas: Quota[];
  busy: boolean; lastRefresh: number | null; nextRefresh: number | null; error: string | null;
  edge: Edge; collapsed: boolean; rotatingIndex: number; visible: boolean; detailPinned: boolean;
}
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
export const loginSchema = z.object({ server: z.string().min(1).max(2048), email: z.email(), password: z.string().min(1).max(4096) });
export type LoginInput = z.infer<typeof loginSchema>;
export interface DesktopAPI {
  getState(): Promise<Snapshot>;
  subscribe(listener: (state: Snapshot) => void): () => void;
  updateSettings(patch: Partial<Settings>): Promise<Result>;
  login(input: LoginInput): Promise<Result>;
  verify(code: string): Promise<Result>;
  logout(): Promise<Result>;
  refresh(): Promise<Result>;
  importFont(): Promise<Result<string>>;
  removeFont(): Promise<Result>;
  drag(start: boolean, x?: number, y?: number): void;
  dragMove(x: number, y: number): void;
  hover(surface: 'floating' | 'detail', inside: boolean): void;
  pinDetail(): void;
  closeDetail(): void;
  openContextMenu(x: number, y: number): void;
  menuAction(action: 'settings' | 'refresh' | 'visibility' | 'quit'): void;
  closeSettings(): void;
}
export function alias(account: Account, settings: Settings): string {
  return settings.aliases[String(account.id)]?.trim() || account.name;
}
export function shortName(account: Account, settings: Settings, index: number): string {
  const custom = settings.aliases[String(account.id)]?.trim();
  return custom || (account.name.length <= 3 ? account.name : `${account.platform === 'anthropic' ? 'C' : account.platform === 'openai' ? 'O' : 'A'}${index + 1}`);
}
export function severity(used: number): 'normal' | 'warning' | 'critical' {
  return used >= 80 ? 'critical' : used > 50 ? 'warning' : 'normal';
}
export function color(used: number, settings: Settings): string {
  return settings[`${severity(used)}Color`];
}
export function metric(used: number, settings: Settings): number {
  return settings.metric === 'used' ? used : Math.max(0, 100 - used);
}
export function percent(window: QuotaWindow | null, settings: Settings): string {
  return window ? `${Math.round(metric(window.used, settings))}%` : '--';
}
export function ink(hex: string): string {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const l = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  return (l + .05) / .05 > 1.05 / (l + .05) ? '#000000' : '#ffffff';
}
export function summaryPeriods(account: Quota, settings: Settings): Period[] {
  if (!settings.showFive) return ['seven'];
  if (settings.summary === 'both') return ['five', 'seven'];
  if (settings.summary !== 'worst') return [settings.summary];
  return [(account.five?.used ?? -1) >= (account.seven?.used ?? -1) ? 'five' : 'seven'];
}
export function emptyQuota(account: Account): Quota {
  return { ...account, five: null, seven: null, source: 'unknown', updatedAt: null, fetchedAt: null, error: null };
}
