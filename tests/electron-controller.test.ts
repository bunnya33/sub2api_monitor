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
    let plan = 'plus', expiry = '2026-10-01T00:00:00Z', count = 2, timestamp = 1790676600, used = 32;
    let counterStatus = 200, counterMissing = false;
    const controller = new Controller({ ...defaults, demo: false, autoRefresh: false }, new MemoryVault(), () => {}, async url => {
      const path = new URL(url).pathname;
      if (path.endsWith('/login')) return response({ access_token: 'a' });
      if (path.endsWith('/me')) return response({ role: 'admin' });
      if (path === '/api/v1/admin/accounts') return response({ items: [
        { id: 1, name: 'OpenAI', platform: 'openai', type: 'oauth', status: 'active', credentials: { plan_type: plan, subscription_expires_at: expiry } }
      ], total: 1 });
      if (path.endsWith('/usage')) return response({ five_hour: { utilization: used }, seven_day: { utilization: 58 } });
      if (path.endsWith('/quota')) return response(counterMissing ? { fetched_at: timestamp } : {
        rate_limit_reset_credits: { available_count: count }, fetched_at: timestamp
      }, counterStatus);
      throw new Error(`Unexpected route ${path}`);
    });
    try {
      await controller.login({ server: 'https://example.invalid', email: 'admin@example.com', password: 'secret' });
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 2, refreshedAt: 1790676600000 });
      plan = 'pro_5x'; expiry = '2026-10-02T00:00:00Z'; count = 1; timestamp += 60;
      await controller.refresh();
      expect(controller.state.available[0].planType).toBe('pro_5x');
      expect(controller.state.quotas[0].subscriptionExpiresAt).toBe(Date.parse(expiry));
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 1, refreshedAt: 1790676660000 });

      used = 50; counterStatus = 502;
      await controller.refresh();
      expect(controller.state.quotas[0].five?.used).toBe(50);
      expect(controller.state.quotas[0].resetCredits).toEqual({ available: 1, refreshedAt: 1790676660000 });
      expect(controller.state.quotas[0].resetCreditsError).toContain('502');
      expect(controller.state.error).toBe('1 个账号部分数据未更新');

      counterStatus = 200; counterMissing = true;
      await controller.refresh();
      expect(controller.state.quotas[0].resetCredits).toBeNull();
      expect(controller.state.quotas[0].resetCreditsError).toBeNull();
      expect(controller.state.error).toBeNull();
    } finally { controller.dispose(); }
  });
});
