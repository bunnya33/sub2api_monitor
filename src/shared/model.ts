import { z } from 'zod';

export const settingsSchema = z.object({
  metric: z.enum(['used', 'remaining']), showFive: z.boolean(), showSeven: z.boolean(),
  showResetCount: z.boolean(), showResetTime: z.boolean(), autoCollapse: z.boolean(),
  summary: z.enum(['worst', 'both', 'five', 'seven']), barWidth: z.number().int().min(40).max(240),
  nameWidth: z.number().int().min(36).max(200), topWidth: z.number().int().min(120).max(400),
  sideWidth: z.number().int().min(48).max(240), autoRefresh: z.boolean(),
  refreshSeconds: z.number().int().min(5).max(3600), rotateSeconds: z.number().int().min(2).max(60),
  fadeInactive: z.boolean(), inactiveOpacity: z.number().int().min(20).max(100),
  normalColor: z.string().regex(/^#[0-9a-f]{6}$/i), warningColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  criticalColor: z.string().regex(/^#[0-9a-f]{6}$/i), textOutline: z.boolean(), fontSize: z.number().int().min(10).max(20),
  fontBold: z.boolean(), fontName: z.string().max(260), rememberSession: z.boolean(),
  selectedIds: z.array(z.number().int().positive()).max(100), aliases: z.record(z.string(), z.string().max(40)),
  demo: z.boolean()
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  metric: 'used', showFive: true, showSeven: true, showResetCount: true, showResetTime: true, autoCollapse: true, summary: 'worst', barWidth: 68,
  nameWidth: 62, topWidth: 178, sideWidth: 64, autoRefresh: true, refreshSeconds: 60, rotateSeconds: 4,
  fadeInactive: true, inactiveOpacity: 65, normalColor: '#22c55e', warningColor: '#f59e0b',
  criticalColor: '#ef4444', textOutline: false, fontSize: 12, fontBold: false, fontName: '', rememberSession: true,
  selectedIds: [1, 2], aliases: {}, demo: true
};
export type Edge = 'left' | 'right' | 'top' | 'bottom' | null;
export type Period = 'five' | 'seven';
export interface Rect { x: number; y: number; width: number; height: number }
export interface Account { id: number; name: string; platform: string; type: string; status: string; planType?: string; subscriptionExpiresAt?: number | null }
export interface QuotaWindow { used: number; resetsAt: number | null }
export interface ResetCredits { available: number; refreshedAt: number | null }
export interface Quota extends Account {
  five: QuotaWindow | null; seven: QuotaWindow | null; source: string;
  updatedAt: number | null; fetchedAt: number | null; error: string | null;
  resetCredits: ResetCredits | null; resetCreditsError: string | null;
}
export interface Connection { status: 'demo' | 'disconnected' | 'authenticating' | 'twoFactor' | 'connected' | 'expired' | 'error'; server: string; email: string; message: string }
export interface Snapshot {
  settings: Settings; connection: Connection; available: Account[]; quotas: Quota[];
  busy: boolean; lastRefresh: number | null; nextRefresh: number | null; error: string | null;
  edge: Edge; collapsed: boolean; rotatingIndex: number; visible: boolean;
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
  openContextMenu(x: number, y: number): void;
  menuAction(action: 'settings' | 'refresh' | 'visibility' | 'quit'): void;
  menuHover(inside: boolean): void;
  closeSettings(): void;
}
export function alias(account: Account, settings: Settings): string {
  return settings.aliases[String(account.id)]?.trim() || account.name;
}
export function shortName(account: Account, settings: Settings, index: number): string {
  const custom = settings.aliases[String(account.id)]?.trim();
  return custom || (account.name.length <= 3 ? account.name : `${account.platform === 'anthropic' ? 'C' : account.platform === 'openai' ? 'O' : 'A'}${index + 1}`);
}
export function migrateLegacyPalette(settings: Settings): Settings {
  return {
    ...settings,
    normalColor: settings.normalColor === '#83cbaa' ? defaults.normalColor : settings.normalColor,
    warningColor: settings.warningColor === '#ffa600' ? defaults.warningColor : settings.warningColor,
    criticalColor: settings.criticalColor === '#ed9c98' ? defaults.criticalColor : settings.criticalColor
  };
}
export function severity(used: number, settings: Settings): 'normal' | 'warning' | 'critical' {
  if (settings.metric === 'remaining') {
    const remaining = metric(used, settings);
    return remaining <= 20 ? 'critical' : remaining <= 50 ? 'warning' : 'normal';
  }
  return used >= 90 ? 'critical' : used >= 75 ? 'warning' : 'normal';
}
export function color(used: number, settings: Settings): string {
  return settings[`${severity(used, settings)}Color`];
}
export function metric(used: number, settings: Settings): number {
  return settings.metric === 'used' ? used : Math.max(0, 100 - used);
}
export function percent(window: QuotaWindow | null, settings: Settings): string {
  return window ? `${Math.round(metric(window.used, settings))}%` : '--';
}
function luminance(rgb: number[]): number {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
  });
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}
function rgb(hex: string): number[] { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
export function needsLightInk(hex: string): boolean { return luminance(rgb(hex)) < .18; }
export function ink(hex: string): string {
  const channels = rgb(hex);
  const background = luminance(channels), darken = !needsLightInk(hex);
  const tone = (portion: number) => channels.map(channel => Math.round(darken ? channel * portion : channel + (255 - channel) * portion));
  let low = 0, high = 1;
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) / 2, foreground = luminance(tone(middle));
    const contrast = darken ? (background + .05) / (foreground + .05) : (foreground + .05) / (background + .05);
    if ((contrast >= 4.5) === darken) low = middle; else high = middle;
  }
  return `#${tone(darken ? low : high).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}
export function outlineInk(textColor: string): string {
  return `#${rgb(textColor).map(channel => Math.round(channel * .35).toString(16).padStart(2, '0')).join('')}`;
}
export function supportsFive(account: Account): boolean {
  const plan = account.planType?.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!plan) return true;
  return !(/^(?:(?:chatgpt)?pro(?:\d+x)?|\d+xpro|(?:claude)?max(?:\d+x)?)$/.test(plan)
    || ['team', 'business', 'enterprise', 'ultra', 'free'].includes(plan));
}
export function visiblePeriods(account: Account, settings: Settings): Period[] {
  const periods: Period[] = [];
  if (settings.showFive && supportsFive(account)) periods.push('five');
  if (settings.showSeven) periods.push('seven');
  return periods;
}
export function summaryPeriods(account: Quota, settings: Settings): Period[] {
  const available = visiblePeriods(account, settings);
  if (available.length < 2 || settings.summary === 'both') return available;
  if (settings.summary !== 'worst') return available.includes(settings.summary) ? [settings.summary] : available;
  return [(account.five?.used ?? -1) >= (account.seven?.used ?? -1) ? 'five' : 'seven'];
}
export function emptyQuota(account: Account): Quota {
  return { ...account, five: null, seven: null, source: 'unknown', updatedAt: null, fetchedAt: null, error: null, resetCredits: null, resetCreditsError: null };
}
