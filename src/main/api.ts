import { z } from 'zod';
import { emptyQuota, type Account, type LoginInput, type Quota, type QuotaWindow } from '../shared/model';

const accountSchema = z.object({ id: z.number().int().positive(), name: z.string(), platform: z.string(), type: z.string(), status: z.string().default('active'),
  credentials: z.record(z.string(), z.unknown()).nullish(), parent_plan_type: z.string().nullish() });
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.number().optional() });
const userSchema = z.object({ role: z.string(), email: z.string().optional() });
export interface SavedSession { server: string; email: string; refreshToken: string }
export interface SessionVault { save(value: SavedSession): void; load(): SavedSession | null; clear(): void }
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class ApiError extends Error {
  constructor(message: string, public status = 0, public retryAfterMs = 0) { super(message); }
}
export function normalizeServer(value: string): string {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError('服务器地址必须是 HTTP 或 HTTPS 地址，且不能包含凭据或查询参数');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return url.toString().replace(/\/$/, '');
}
function windowData(value: unknown, now: number): QuotaWindow | null {
  const result = z.object({ utilization: z.number().finite().nonnegative(), resets_at: z.string().nullable().optional(), remaining_seconds: z.number().optional() }).safeParse(value);
  if (!result.success) return null;
  const reset = result.data.resets_at ? Date.parse(result.data.resets_at) : NaN;
  return { used: result.data.utilization, resetsAt: Number.isFinite(reset) ? reset : result.data.remaining_seconds !== undefined ? now + Math.max(0, result.data.remaining_seconds) * 1000 : null };
}
export function mapUsage(account: Account, raw: unknown, now = Date.now()): Quota {
  const data = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!data.success) throw new ApiError('服务器返回的额度格式无法识别');
  const value = data.data, updated = typeof value.updated_at === 'string' ? Date.parse(value.updated_at) : NaN;
  return { ...emptyQuota(account), five: windowData(value.five_hour, now), seven: windowData(value.seven_day, now),
    source: value.source === 'passive' ? 'passive' : value.source === 'active' ? 'active' : 'snapshot',
    updatedAt: Number.isFinite(updated) ? updated : null, fetchedAt: now,
    error: typeof value.error === 'string' && value.error ? value.error.slice(0, 300) : null };
}
export class Sub2ApiClient {
  readonly server: string;
  private accessToken = '';
  private refreshToken = '';
  private temporaryToken = '';
  private expiresAt = 0;
  private refreshTask: Promise<void> | null = null;
  private email = '';
  constructor(server: string, private vault: SessionVault, private remember: boolean, private fetcher: Fetcher = fetch) { this.server = normalizeServer(server); }
  private async raw(path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(20000);
      response = await this.fetcher(this.server + '/api/v1' + path, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError('无法连接服务器，请检查地址、网络或证书');
    }
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new ApiError('服务器响应过大');
    let envelope: { code?: number; message?: string; data?: unknown } = {};
    try { envelope = JSON.parse(text); } catch { if (response.ok) throw new ApiError('服务器没有返回 JSON，请检查服务器地址'); }
    if (!response.ok || (envelope.code !== undefined && envelope.code !== 0 && envelope.code !== 200)) {
      const retry = response.headers.get('retry-after'), seconds = retry ? Number(retry) : NaN;
      const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 0;
      throw new ApiError(typeof envelope.message === 'string' ? envelope.message.slice(0, 300) : `请求失败 (${response.status})`, response.status, retryAfter);
    }
    return envelope.data ?? envelope;
  }
  private acceptTokens(raw: unknown): void {
    const token = tokenSchema.parse(raw);
    this.accessToken = token.access_token;
    this.refreshToken = token.refresh_token ?? this.refreshToken;
    this.expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : Infinity;
  }
  private persist(): void {
    if (this.remember && this.refreshToken) this.vault.save({ server: this.server, email: this.email, refreshToken: this.refreshToken });
    else this.vault.clear();
  }
  private async authorize(signal?: AbortSignal): Promise<void> {
    const user = userSchema.parse(await this.raw('/auth/me', undefined, this.accessToken, signal));
    if (user.role !== 'admin') { this.accessToken = ''; this.refreshToken = ''; this.vault.clear(); throw new ApiError('该账号没有管理员权限，无法查看上游账号额度', 403); }
    this.email = user.email ?? this.email;
    this.persist();
  }
  async login(input: LoginInput, signal?: AbortSignal): Promise<'twoFactor' | 'connected'> {
    this.email = input.email;
    const result = await this.raw('/auth/login', { email: input.email, password: input.password }, undefined, signal);
    const challenge = z.object({ requires_2fa: z.literal(true), temp_token: z.string().min(1) }).safeParse(result);
    if (challenge.success) { this.temporaryToken = challenge.data.temp_token; return 'twoFactor'; }
    this.acceptTokens(result); await this.authorize(signal); return 'connected';
  }
  async verify(code: string, signal?: AbortSignal): Promise<void> {
    if (!this.temporaryToken) throw new ApiError('验证会话已失效，请重新登录');
    if (!/^\d{6}$/.test(code)) throw new ApiError('请输入 6 位验证码');
    const result = await this.raw('/auth/login/2fa', { temp_token: this.temporaryToken, totp_code: code }, undefined, signal);
    this.acceptTokens(result); await this.authorize(signal); this.temporaryToken = '';
  }
  async restore(session: SavedSession, signal?: AbortSignal): Promise<void> {
    this.email = session.email; this.refreshToken = session.refreshToken;
    await this.refreshTokens('', signal); await this.authorize(signal);
  }
  private async refreshTokens(attempted: string, signal?: AbortSignal): Promise<void> {
    if (this.refreshTask) { await this.refreshTask; return; }
    if (this.accessToken !== attempted) return;
    if (!this.refreshToken) throw new ApiError('登录已过期，请重新登录', 401);
    this.refreshTask = (async () => {
      this.acceptTokens(await this.raw('/auth/refresh', { refresh_token: this.refreshToken }, undefined, signal));
      this.persist();
    })().finally(() => { this.refreshTask = null; });
    return this.refreshTask;
  }
  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    if (this.expiresAt < Date.now() + 15000) await this.refreshTokens(this.accessToken, signal);
    const attempted = this.accessToken;
    try { return await this.raw(path, undefined, attempted, signal); }
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || !this.refreshToken) throw error;
      await this.refreshTokens(attempted, signal); return this.raw(path, undefined, this.accessToken, signal);
    }
  }
  async listAccounts(signal?: AbortSignal): Promise<Account[]> {
    const accounts: Account[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = z.object({ items: z.array(accountSchema), total: z.number() }).parse(await this.request(`/admin/accounts?page=${page}&page_size=100&lite=true`, signal));
      accounts.push(...data.items.map(item => ({ id: item.id, name: item.name, platform: item.platform, type: item.type, status: item.status,
        planType: typeof item.credentials?.plan_type === 'string' && item.credentials.plan_type.trim() ? item.credentials.plan_type.trim() : item.parent_plan_type || undefined })));
      if (accounts.length >= data.total || data.items.length === 0) return accounts;
    }
    throw new ApiError('账号分页数量超过客户端限制');
  }
  async usages(accounts: Account[], signal?: AbortSignal): Promise<{ usage: Map<number, Quota>; errors: Map<number, string>; retryAfterMs: number }> {
    const usage = new Map<number, Quota>(), errors = new Map<number, string>();
    let retryAfterMs = 0;
    for (const account of accounts) {
      if (retryAfterMs) { errors.set(account.id, '服务器限流，本轮暂缓读取'); continue; }
      try {
        const source = account.platform === 'anthropic' && ['oauth', 'setup-token'].includes(account.type) ? 'passive' : 'active';
        const data = await this.request(`/admin/accounts/${account.id}/usage?source=${source}&force=false`, signal);
        const mapped = mapUsage(account, data);
        if (mapped.error) errors.set(account.id, mapped.error); else usage.set(account.id, mapped);
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
        if (error instanceof ApiError && error.status === 429) retryAfterMs = error.retryAfterMs || 30000;
        errors.set(account.id, error instanceof Error ? error.message : '刷新失败');
      }
    }
    return { usage, errors, retryAfterMs };
  }
  setRemember(value: boolean): void { this.remember = value; this.persist(); }
  async logout(): Promise<void> {
    const token = this.refreshToken;
    this.accessToken = ''; this.refreshToken = ''; this.temporaryToken = ''; this.vault.clear();
    if (token) await this.raw('/auth/logout', { refresh_token: token }).catch(() => {});
  }
}
