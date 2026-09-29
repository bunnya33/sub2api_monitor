import { EventEmitter } from 'node:events';
import { emptyQuota, settingsSchema, type Account, type LoginInput, type Quota, type Settings, type Snapshot } from '../shared/model';
import { ApiError, normalizeServer, Sub2ApiClient, type Fetcher, type SessionVault } from './api';

export function demoQuotas(now = Date.now()): Quota[] {
  return [
    { id: 1, name: '示例 C1', platform: 'anthropic', type: 'oauth', status: 'active', planType: 'plus', subscriptionExpiresAt: now + 1209600000, concurrency: 10, currentConcurrency: 1, resetCredits: null,
      five: { used: 32, resetsAt: now + 8280000 }, seven: { used: 58, resetsAt: now + 280800000 } },
    { id: 2, name: '示例 O2', platform: 'openai', type: 'oauth', status: 'active', planType: 'pro_5x', subscriptionExpiresAt: now + 1814400000, concurrency: 5, currentConcurrency: 2,
      resetCredits: { available: 2, nearestExpiresAt: now + 259200000 }, five: { used: 19, resetsAt: now + 14700000 }, seven: { used: 84, resetsAt: now + 129600000 } }
  ].map(a => ({ ...a, source: 'demo', updatedAt: now, fetchedAt: now, error: null, resetCreditsError: null }));
}
export class Controller extends EventEmitter {
  readonly state: Snapshot;
  private client: Sub2ApiClient | null = null;
  private generation = 0;
  private selectionVersion = 0;
  private task: Promise<void> | null = null;
  private statusTask: Promise<void> | null = null;
  private abort = new AbortController();
  private timer: NodeJS.Timeout;
  constructor(settings: Settings, private vault: SessionVault, private save: () => void, private fetcher?: Fetcher, server = '', email = '') {
    super();
    this.state = { settings, connection: { status: settings.demo ? 'demo' : 'disconnected', server, email, message: settings.demo ? '演示数据' : '未登录' }, available: [], quotas: [], busy: false, lastRefresh: null, nextRefresh: null, error: null, edge: null, collapsed: false, rotatingIndex: 0, rotatingPeriod: 'five', visible: true };
    if (settings.demo) this.enableDemo();
    this.timer = setInterval(() => { if (this.state.nextRefresh && Date.now() >= this.state.nextRefresh && !this.state.busy) void this.refresh().catch(() => {}); }, 500);
  }
  publish(): void { this.emit('state', this.state); }
  private vaultFor(generation: number): SessionVault {
    return { load: () => this.vault.load(), save: value => { if (generation === this.generation) this.vault.save(value); }, clear: () => { if (generation === this.generation) this.vault.clear(); } };
  }
  private schedule(delay = 0): void { this.state.nextRefresh = this.state.settings.autoRefresh && ['connected', 'demo'].includes(this.state.connection.status) ? Date.now() + Math.max(this.state.settings.refreshSeconds * 1000, delay) : null; }
  private enableDemo(): void {
    this.state.settings.selectedIds = this.state.settings.selectedIds.filter(id => [1, 2].includes(id));
    if (!this.state.settings.selectedIds.length) this.state.settings.selectedIds = [1, 2];
    this.state.available = demoQuotas(); this.state.quotas = demoQuotas().filter(a => this.state.settings.selectedIds.includes(a.id));
    this.state.connection.status = 'demo'; this.state.connection.message = '演示数据';
    this.state.lastRefresh = Date.now(); this.state.error = null; this.schedule();
  }
  async start(): Promise<void> {
    if (this.state.settings.demo) return;
    const saved = this.state.settings.rememberSession ? this.vault.load() : null;
    if (!saved) return;
    const generation = ++this.generation;
    const client = new Sub2ApiClient(saved.server, this.vaultFor(generation), true, this.fetcher);
    this.client = client; this.state.connection = { status: 'authenticating', server: saved.server, email: saved.email, message: '正在恢复登录' }; this.publish();
    try { await client.restore(saved, this.abort.signal); if (generation === this.generation) await this.connected(client, generation); }
    catch (error) { if (generation === this.generation) this.fail(error, true); }
  }
  private async connected(client: Sub2ApiClient, generation: number): Promise<void> {
    const available = await client.listAccounts(this.abort.signal);
    if (generation !== this.generation) return;
    this.state.available = available;
    this.state.settings.selectedIds = this.state.settings.selectedIds.filter(id => available.some(a => a.id === id));
    if (!this.state.settings.selectedIds.length) {
      const preferred = available.filter(a => ['anthropic', 'openai'].includes(a.platform) && ['oauth', 'setup-token'].includes(a.type));
      this.state.settings.selectedIds = (preferred.length ? preferred : available).slice(0, 2).map(a => a.id);
    }
    this.state.quotas = this.selected().map(emptyQuota); this.state.connection.status = 'connected'; this.state.connection.message = '已登录 · 管理员';
    this.state.error = null; this.save(); this.schedule(); this.publish(); await this.refresh();
  }
  private selected(): Account[] { return this.state.available.filter(a => this.state.settings.selectedIds.includes(a.id)); }
  private fail(error: unknown, auth = false): void {
    const message = error instanceof Error ? error.message : '操作失败'; this.state.error = message;
    if (auth || (error instanceof ApiError && error.sessionError)) {
      this.state.connection.status = error instanceof ApiError && error.status === 401 ? 'expired' : 'error';
      this.state.connection.message = message; this.state.nextRefresh = null;
      if (error instanceof ApiError && error.sessionError) this.vault.clear();
    }
    this.publish();
  }
  async login(input: LoginInput): Promise<void> {
    const server = normalizeServer(input.server), resetSelection = this.state.settings.demo || this.state.connection.server !== server;
    this.cancelSession();
    const generation = ++this.generation;
    const client = new Sub2ApiClient(server, this.vaultFor(generation), this.state.settings.rememberSession, this.fetcher);
    this.client = client; this.state.settings.demo = false;
    if (resetSelection) this.state.settings.selectedIds = [];
    this.state.connection = { status: 'authenticating', server: client.server, email: input.email, message: '正在登录' };
    this.state.available = []; this.state.quotas = []; this.state.error = null; this.save(); this.publish();
    try {
      const result = await client.login(input, this.abort.signal);
      if (generation !== this.generation) return;
      if (result === 'twoFactor') { this.state.connection.status = 'twoFactor'; this.state.connection.message = '需要双重验证'; this.publish(); return; }
      await this.connected(client, generation);
    } catch (error) { if (generation === this.generation) this.fail(error, true); throw error; }
  }
  async verify(code: string): Promise<void> {
    if (!this.client || this.state.connection.status !== 'twoFactor') throw new Error('验证会话不存在');
    const generation = this.generation, client = this.client;
    try { await client.verify(code, this.abort.signal); if (generation === this.generation) await this.connected(client, generation); }
    catch (error) { if (generation === this.generation) { this.state.connection.message = error instanceof Error ? error.message : '验证失败'; this.publish(); } throw error; }
  }
  private cancelSession(): void {
    this.generation++; this.abort.abort(); this.abort = new AbortController();
    const client = this.client; this.client = null; this.task = null;
    this.state.busy = false; this.state.nextRefresh = null; this.vault.clear();
    if (client) void client.logout();
  }
  logout(): void {
    this.cancelSession(); this.state.settings.demo = false; this.state.connection.status = 'disconnected'; this.state.connection.message = '未登录';
    this.state.available = []; this.state.quotas = []; this.state.lastRefresh = null; this.state.error = null; this.save(); this.publish();
  }
  async update(patch: Partial<Settings>): Promise<void> {
    const validated = settingsSchema.partial().parse(patch), previous = this.state.settings;
    this.state.settings = settingsSchema.parse({ ...previous, ...validated });
    if (validated.demo !== undefined && validated.demo !== previous.demo) {
      this.cancelSession(); this.state.settings.selectedIds = [];
      if (validated.demo) this.enableDemo(); else { this.state.available = []; this.state.quotas = []; this.state.connection.status = 'disconnected'; this.state.connection.message = '未登录'; this.state.lastRefresh = null; }
    }
    if (validated.rememberSession !== undefined) this.client?.setRemember(validated.rememberSession);
    if (validated.selectedIds) {
      this.selectionVersion++;
      const previousQuotas = this.state.quotas;
      this.state.quotas = this.selected().map(a => previousQuotas.find(q => q.id === a.id) ?? emptyQuota(a));
      if (this.state.settings.demo) this.state.quotas = demoQuotas().filter(a => this.state.settings.selectedIds.includes(a.id));
    }
    if (validated.autoRefresh !== undefined || validated.refreshSeconds !== undefined) this.schedule();
    this.save(); this.publish();
    if (validated.selectedIds && this.state.connection.status === 'connected') { if (this.task) await this.task; await this.refresh(); }
  }
  async refresh(): Promise<void> {
    if (this.task) return this.task;
    if (this.statusTask) { await this.statusTask; return this.refresh(); }
    if (!['connected', 'demo'].includes(this.state.connection.status)) return;
    const generation = this.generation, selection = this.selectionVersion;
    this.state.busy = true; this.publish();
    const task = (async () => {
      let delay = 0;
      try {
        if (this.state.settings.demo) {
          this.state.quotas = demoQuotas().filter(a => this.state.settings.selectedIds.includes(a.id)); this.state.lastRefresh = Date.now();
        } else if (this.client) {
          const available = await this.client.listAccounts(this.abort.signal);
          if (generation !== this.generation || selection !== this.selectionVersion) return;
          this.state.available = available;
          const selected = this.selected(), result = await this.client.usages(selected, this.abort.signal);
          if (generation !== this.generation || selection !== this.selectionVersion) return;
          delay = result.retryAfterMs;
          this.state.quotas = selected.map(a => {
            const previous = this.state.quotas.find(q => q.id === a.id), quota = result.usage.get(a.id);
            if (!quota) return { ...(previous ?? emptyQuota(a)), ...a, error: result.errors.get(a.id) ?? '刷新失败' };
            return quota.resetCreditsError ? { ...quota, resetCredits: previous?.resetCredits ?? null } : quota;
          });
          const failed = result.errors.size + this.state.quotas.filter(q => q.resetCreditsError && !q.error).length;
          this.state.error = failed ? `${failed} 个账号部分数据未更新` : null;
          if (result.usage.size) this.state.lastRefresh = Date.now();
        }
      } catch (error) {
        if (generation !== this.generation) return;
        if (error instanceof ApiError) delay = error.retryAfterMs;
        this.fail(error); delay = Math.max(delay, 15000);
      } finally {
        if (generation === this.generation) { this.state.busy = false; this.task = null; this.schedule(delay); this.publish(); }
      }
    })();
    this.task = task; await task; if (this.task === task) this.task = null;
  }
  async setAccountStatus(id: number, status: 'active' | 'inactive'): Promise<void> {
    if (this.statusTask) throw new Error('账号状态正在更新');
    if (this.state.connection.status !== 'connected' || !this.client) throw new Error('需要管理员登录才能修改账号状态');
    const generation = this.generation, client = this.client;
    const task = (async () => {
      if (this.task) await this.task;
      if (generation !== this.generation) throw new Error('会话已切换，请重试');
      const account = this.state.available.find(item => item.id === id);
      if (!account || !['active', 'inactive'].includes(account.status) || account.status === status) throw new Error('账号状态已变化，请刷新后重试');
      this.state.nextRefresh = null;
      try {
        await client.setAccountStatus(id, status, this.abort.signal);
        if (generation !== this.generation) throw new Error('会话已切换，请重试');
        this.state.available = this.state.available.map(item => item.id === id ? { ...item, status } : item);
        this.state.quotas = this.state.quotas.map(item => item.id === id ? { ...item, status } : item);
      } catch (error) {
        if (generation === this.generation && error instanceof ApiError && error.sessionError) this.fail(error);
        throw error;
      } finally {
        if (generation === this.generation) { this.schedule(); this.publish(); }
      }
    })();
    this.statusTask = task;
    try { await task; } finally { if (this.statusTask === task) this.statusTask = null; }
  }
  dispose(): void { clearInterval(this.timer); this.abort.abort(); this.generation++; }
}
