import { describe, expect, it } from 'vitest';
import { alias, color, defaults, ink, migrateLegacyPalette, percent, severity, shortName, summaryPeriods, type Quota } from '../src/shared/model';
import { clampRect, detailRect, size, snapEdge } from '../src/shared/geometry';
import { mapUsage, normalizeServer } from '../src/main/api';

const account = { id: 7, name: 'Claude-Production', platform: 'anthropic', type: 'oauth', status: 'active' };
const quota: Quota = { ...account, five: { used: 32, resetsAt: null }, seven: { used: 84, resetsAt: null }, source: 'passive', updatedAt: null, fetchedAt: null, error: null };

describe('compact quota display', () => {
  it('preserves the preview dimensions and shrinks when five hour is hidden', () => {
    expect(size(defaults, [quota, quota], null, false)).toEqual({ width: 224, height: 64 });
    expect(size({ ...defaults, showFive: false }, [quota, quota], null, false)).toEqual({ width: 150, height: 64 });
    expect(size({ ...defaults, nameWidth: 100, barWidth: 96 }, [quota, quota], null, false)).toEqual({ width: 318, height: 64 });
    expect(size(defaults, [quota], 'top', true)).toEqual({ width: 178, height: 32 });
  });
  it('uses account alias without changing the server account name', () => {
    const settings = { ...defaults, aliases: { '7': '主力号' } };
    expect(alias(account, settings)).toBe('主力号');
    expect(shortName(account, settings, 0)).toBe('主力号');
    expect(account.name).toBe('Claude-Production');
  });
  it('uses remaining capacity thresholds when the display shows remaining quota', () => {
    const settings = { ...defaults, metric: 'remaining' as const };
    expect(percent(quota.seven, settings)).toBe('16%');
    expect(color(quota.seven!.used, settings)).toBe(settings.criticalColor);
    expect(summaryPeriods(quota, settings)).toEqual(['seven']);
  });
  it('derives readable text from each progress color', () => {
    const luminance = (hex: string) => {
      const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    for (const background of [defaults.normalColor, defaults.warningColor, defaults.criticalColor, '#102034']) {
      const foreground = ink(background), brighter = Math.max(luminance(background), luminance(foreground));
      const darker = Math.min(luminance(background), luminance(foreground));
      expect((brighter + .05) / (darker + .05)).toBeGreaterThanOrEqual(4.5);
      expect(foreground).not.toMatch(/^#(?:000000|ffffff)$/);
    }
  });
  it('matches sub2api progress colors at both sets of boundaries', () => {
    expect([defaults.normalColor, defaults.warningColor, defaults.criticalColor]).toEqual(['#22c55e', '#f59e0b', '#ef4444']);
    expect([74, 75, 89, 90].map(used => severity(used, defaults))).toEqual(['normal', 'warning', 'warning', 'critical']);
    const remaining = { ...defaults, metric: 'remaining' as const };
    expect([49, 50, 79, 80].map(used => severity(used, remaining))).toEqual(['normal', 'warning', 'warning', 'critical']);
  });
  it('migrates prior default colors while preserving custom choices', () => {
    const old = { ...defaults, normalColor: '#83cbaa', warningColor: '#ffa600', criticalColor: '#ed9c98' };
    expect(migrateLegacyPalette(old)).toEqual(defaults);
    expect(migrateLegacyPalette({ ...old, warningColor: '#123456' }).warningColor).toBe('#123456');
  });
  it('does not turn missing upstream data into zero', () => {
    const mapped = mapUsage(account, { five_hour: { utilization: 108 }, seven_day: null });
    expect(mapped.five?.used).toBe(108);
    expect(mapped.seven).toBeNull();
    expect(percent(mapped.seven, defaults)).toBe('--');
  });
});

describe('multi-display work area geometry', () => {
  const work = { x: -1920, y: -200, width: 1920, height: 1040 };
  it('clamps and snaps on a monitor with negative coordinates', () => {
    const position = clampRect({ x: -2600, y: 1000, width: 224, height: 64 }, work, 'right');
    expect(position).toEqual({ x: -224, y: 776, width: 224, height: 64 });
    expect(snapEdge(position, work)).toBe('right');
  });
  it('places details within the same work area', () => {
    const rect = detailRect({ x: -224, y: 776, width: 224, height: 64 }, work, 2);
    expect(rect.x).toBeGreaterThanOrEqual(work.x);
    expect(rect.x + rect.width).toBeLessThanOrEqual(work.x + work.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(work.y + work.height);
  });
});

describe('sub2api 0.2.8 input', () => {
  it('normalizes a server address ending in the API prefix', () => {
    expect(normalizeServer('https://example.com/api/v1/')).toBe('https://example.com');
  });
});
