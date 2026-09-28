import { describe, expect, it } from 'vitest';
import { ApiError, Sub2ApiClient, type SavedSession, type SessionVault } from '../src/main/api';

class MemoryVault implements SessionVault {
  value: SavedSession | null = null;
  save(value: SavedSession) { this.value = value; }
  load() { return this.value; }
  clear() { this.value = null; }
}
const response = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify({ code: 0, data }), { status, headers });

describe('sub2api 0.2.8 session and usage', () => {
  it('reads only the account plan from the redacted 0.2.8 list', async () => {
    const client = new Sub2ApiClient('https://example.invalid', new MemoryVault(), false, async url => {
      const route = new URL(url).pathname;
      if (route.endsWith('/login')) return response({ access_token: 'access' });
      if (route.endsWith('/me')) return response({ role: 'admin' });
      return response({ items: [
        { id: 1, name: 'Plus', platform: 'openai', type: 'oauth', status: 'active', credentials: { plan_type: 'plus', access_token: 'must-not-copy' } },
        { id: 2, name: 'Pro', platform: 'openai', type: 'oauth', status: 'active', credentials: { plan_type: 'pro_5x' } },
        { id: 3, name: 'Shadow', platform: 'openai', type: 'oauth', status: 'active', parent_plan_type: 'max_20x' }
      ], total: 3 });
    });
    await client.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
    const accounts = await client.listAccounts();
    expect(accounts.map(item => item.planType)).toEqual(['plus', 'pro_5x', 'max_20x']);
    expect(JSON.stringify(accounts)).not.toContain('must-not-copy');
  });
  it('passes the exact 2FA fields and persists only after admin verification', async () => {
    const vault = new MemoryVault();
    const calls: string[] = [];
    const client = new Sub2ApiClient('https://example.invalid', vault, true, async (url, init) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path.endsWith('/login')) return response({ requires_2fa: true, temp_token: 'temporary' });
      if (path.endsWith('/login/2fa')) {
        expect(JSON.parse(String(init?.body))).toEqual({ temp_token: 'temporary', totp_code: '123456' });
        expect(vault.value).toBeNull();
        return response({ access_token: 'access', refresh_token: 'refresh' });
      }
      expect(vault.value).toBeNull();
      return response({ role: 'admin', email: 'admin@example.com' });
    });
    expect(await client.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' })).toBe('twoFactor');
    await client.verify('123456');
    expect(vault.value?.refreshToken).toBe('refresh');
    expect(calls).toEqual(['/api/v1/auth/login', '/api/v1/auth/login/2fa', '/api/v1/auth/me']);
  });
  it('rejects a non-admin session without storing its refresh token', async () => {
    const vault = new MemoryVault();
    const client = new Sub2ApiClient('https://example.invalid', vault, true, async url =>
      response(new URL(url).pathname.endsWith('/login') ? { access_token: 'a', refresh_token: 'r' } : { role: 'user' }));
    await expect(client.login({ server: 'https://example.invalid', email: 'user@example.com', password: 'secret' })).rejects.toMatchObject({ status: 403 });
    expect(vault.value).toBeNull();
  });
  it('uses passive Claude and cached active OpenAI requests without force', async () => {
    const paths: string[] = [];
    const client = new Sub2ApiClient('https://example.invalid', new MemoryVault(), false, async url => {
      const path = new URL(url).pathname + new URL(url).search;
      paths.push(path);
      if (path.endsWith('/login')) return response({ access_token: 'a' });
      if (path.endsWith('/me')) return response({ role: 'admin' });
      return response({ five_hour: { utilization: 32 }, seven_day: { utilization: 58 } });
    });
    await client.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
    const result = await client.usages([
      { id: 1, name: 'C', platform: 'anthropic', type: 'oauth', status: 'active' },
      { id: 2, name: 'O', platform: 'openai', type: 'oauth', status: 'active' }
    ]);
    expect(result.usage.size).toBe(2);
    expect(paths).toContain('/api/v1/admin/accounts/1/usage?source=passive&force=false');
    expect(paths).toContain('/api/v1/admin/accounts/2/usage?source=active&force=false');
    expect(paths.some(path => path.includes('batch') || path.includes('force=true'))).toBe(false);
  });
  it('backs off after rate limiting without querying remaining accounts', async () => {
    let usageCalls = 0;
    const client = new Sub2ApiClient('https://example.invalid', new MemoryVault(), false, async url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/login')) return response({ access_token: 'a' });
      if (path.endsWith('/me')) return response({ role: 'admin' });
      usageCalls++;
      return response({}, 429, { 'Retry-After': '120' });
    });
    await client.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
    const result = await client.usages([
      { id: 1, name: 'C', platform: 'anthropic', type: 'oauth', status: 'active' },
      { id: 2, name: 'O', platform: 'openai', type: 'oauth', status: 'active' }
    ]);
    expect(usageCalls).toBe(1);
    expect(result.errors.size).toBe(2);
    expect(result.retryAfterMs).toBe(120000);
  });
  it('does not refresh twice when late 401 responses arrive', async () => {
    let refreshes = 0;
    const vault = new MemoryVault();
    const client = new Sub2ApiClient('https://example.invalid', vault, true, async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/login')) return response({ access_token: 'old', refresh_token: 'refresh' });
      if (path.endsWith('/me')) return response({ role: 'admin' });
      if (path.endsWith('/refresh')) { refreshes++; return response({ access_token: 'new', refresh_token: 'rotated' }); }
      if ((init?.headers as Record<string, string>)?.Authorization === 'Bearer old') {
        await new Promise(resolve => setTimeout(resolve, 10));
        return response({}, 401);
      }
      return response({ items: [], total: 0 });
    });
    await client.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
    await Promise.all([client.listAccounts(), client.listAccounts()]);
    expect(refreshes).toBe(1);
    expect(vault.value?.refreshToken).toBe('rotated');
  });
});
