import { describe, expect, it } from 'vitest';
import { Controller } from '../src/main/controller';
import { defaults } from '../src/shared/model';
import type { SavedSession, SessionVault } from '../src/main/api';

class MemoryVault implements SessionVault {
  value: SavedSession | null = null;
  save(value: SavedSession) { this.value = value; }
  load() { return this.value; }
  clear() { this.value = null; }
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ code: 0, data }), { status });

describe('account detail refresh', () => {
  it('refreshes subscription metadata and reset counts, retains the old count on failure, and clears unknown results', async () => {
    let plan = 'plus', expiry = '2026-10-01T00:00:00Z', count = 2, cardExpiry = '2026-10-03T00:00:00Z', used = 32, status = 'active', currentConcurrency = 1;
    let counterStatus = 200, counterMissing = false;
    let rejectStatus = false;
    const controller = new Controller({ ...defaults, demo: false, autoRefresh: false }, new MemoryVault(), () => {}, async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/login')) return response({ access_token: 'a' });
      if (path.endsWith('/me')) return response({ role: 'admin' });
      if (path === '/api/v1/admin/accounts/1' && init?.method === 'PUT') {
        if (rejectStatus) return response({}, 500);
        status = JSON.parse(String(init.body)).status;
        return response({ status });
      }
      if (path === '/api/v1/admin/accounts') return response({ items: [
        { id: 1, name: 'OpenAI', platform: 'openai', type: 'oauth', status, concurrency: 10, current_concurrency: currentConcurrency, credentials: { plan_type: plan, subscription_expires_at: expiry } }
      ], total: 1 });
      if (path.endsWith('/usage')) return response({ five_hour: { utilization: used }, seven_day: { utilization: 58 } });
      if (path.endsWith('/quota')) return response(counterMissing ? {} : {
        rate_limit_reset_credits: { available_count: count, credits: [{ expires_at: cardExpiry }] }
      }, counterStatus);
      throw new Error(`Unexpected route ${path}`);
    });
    try {
      await controller.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 2, nearestExpiresAt: Date.parse(cardExpiry) });
      expect(controller.state.quotas[0].currentConcurrency).toBe(1);
      plan = 'pro_5x'; expiry = '2026-10-02T00:00:00Z'; count = 1; cardExpiry = '2026-10-04T00:00:00Z'; currentConcurrency = 3;
      await controller.refresh();
      expect(controller.state.quotas[0].currentConcurrency).toBe(3);
      expect(controller.state.available[0].planType).toBe('pro_5x');
      expect(controller.state.quotas[0].subscriptionExpiresAt).toBe(Date.parse(expiry));
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 1, nearestExpiresAt: Date.parse(cardExpiry) });

      used = 50; counterStatus = 502;
      await controller.refresh();
      expect(controller.state.quotas[0].five?.used).toBe(50);
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 1, nearestExpiresAt: Date.parse(cardExpiry) });
      expect(controller.state.quotas[0].resetCreditsError).toContain('502');
      expect(controller.state.error).toBe('1 个账号部分数据未更新');

      counterStatus = 200; counterMissing = true;
      await controller.refresh();
      expect(controller.state.quotas[0].resetCredits).toBeNull();
      expect(controller.state.quotas[0].resetCreditsError).toBeNull();
      expect(controller.state.error).toBeNull();

      await controller.setAccountStatus(1, 'inactive');
      expect(controller.state.available[0].status).toBe('inactive');
      expect(controller.state.quotas[0].status).toBe('inactive');
      rejectStatus = true;
      await expect(controller.setAccountStatus(1, 'active')).rejects.toThrow();
      expect(controller.state.quotas[0].status).toBe('inactive');
    } finally { controller.dispose(); }
  });
});
