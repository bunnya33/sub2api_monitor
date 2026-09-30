import { describe, expect, it } from 'vitest';
import { alias, color, defaults, ink, migrateLegacyPalette, outlineInk, percent, resetCountdown, severity, shortName, summaryPeriods, supportsFive, visiblePeriods, type Quota } from '../src/shared/model';
import { clampRect, detailHeight, detailRect, size, snapEdge, trayMenuRect } from '../src/shared/geometry';
import { mapUsage, normalizeServer } from '../src/main/api';

const account = { id: 7, name: 'Claude-Production', platform: 'anthropic', type: 'oauth', status: 'active' };
const quota: Quota = { ...account, five: { used: 32, resetsAt: null }, seven: { used: 84, resetsAt: null }, source: 'passive', updatedAt: null, fetchedAt: null, error: null, resetCredits: null, resetCreditsError: null };

describe('compact quota display', () => {
  it('preserves the preview dimensions and shrinks when five hour is hidden', () => {
    expect(size(defaults, [quota, quota], null, false)).toEqual({ width: 224, height: 64 });
    expect(size({ ...defaults, showFive: false }, [quota, quota], null, false)).toEqual({ width: 150, height: 64 });
    expect(size({ ...defaults, nameWidth: 100, barWidth: 96 }, [quota, quota], null, false)).toEqual({ width: 318, height: 64 });
    expect(size({ ...defaults, showConcurrency: true }, [quota, quota], null, false)).toEqual({ width: 266, height: 64 });
    expect(size({ ...defaults, showConcurrency: true, concurrencyWidth: 24 }, [quota, quota], null, false)).toEqual({ width: 254, height: 64 });
    expect(size({ ...defaults, showConcurrency: true }, [quota], 'left', true)).toEqual({ width: 64, height: 78 });
    expect(size(defaults, [quota], 'top', true)).toEqual({ width: 160, height: 32 });
  });
  it('uses available periods for Plus and higher-tier accounts', () => {
    const plus = { ...quota, planType: 'plus' }, pro = { ...quota, planType: 'pro_5x' };
    expect(supportsFive(plus)).toBe(true);
    expect(supportsFive(pro)).toBe(false);
    expect(supportsFive({ ...quota, planType: '5x Pro' })).toBe(false);
    expect(supportsFive({ ...quota, planType: 'Max 20x' })).toBe(false);
    expect(supportsFive({ ...quota, planType: 'Max 50x' })).toBe(false);
    expect(supportsFive(quota)).toBe(true);
    expect(visiblePeriods(plus, defaults)).toEqual(['five', 'seven']);
    expect(visiblePeriods(pro, defaults)).toEqual(['seven']);
    expect(summaryPeriods(pro, { ...defaults, summary: 'five' })).toEqual(['seven']);
    expect(visiblePeriods(plus, { ...defaults, showSeven: false })).toEqual(['five']);
    expect(visiblePeriods(pro, { ...defaults, showSeven: false })).toEqual([]);
    expect(size(defaults, [pro], null, false)).toEqual({ width: 150, height: 36 });
    expect(size(defaults, [plus, pro], null, false)).toEqual({ width: 224, height: 64 });
    expect(size({ ...defaults, showSeven: false }, [plus, pro], null, false)).toEqual({ width: 150, height: 64 });
    expect(summaryPeriods(plus, defaults)).toEqual(['five']);
    expect(summaryPeriods(plus, defaults, 'seven')).toEqual(['seven']);
    expect(summaryPeriods(pro, defaults, 'five')).toEqual(['seven']);
    expect(size(defaults, [plus, pro], 'left', true, 0).height).toBe(52);
    expect(size(defaults, [plus, pro], 'left', true, 1).height).toBe(52);
    expect(size({ ...defaults, barWidth: 1, nameWidth: 1 }, [plus], null, false).width).toBe(29);
    expect(size({ ...defaults, sideWidth: 1 }, [plus], 'left', true).width).toBe(1);
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
    expect(summaryPeriods(quota, settings, 'seven')).toEqual(['seven']);
  });
  it('derives readable text from each progress color', () => {
    expect(defaults.textOutline).toBe(false);
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
      expect(luminance(outlineInk(foreground))).toBeLessThan(luminance(foreground));
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
  it('formats the detail reset badge through day, hour and second boundaries', () => {
    const now = 1_000_000;
    expect(resetCountdown(null, now)).toBe('--');
    expect(resetCountdown(now + (5 * 86400 + 20 * 3600) * 1000, now)).toBe('5d20h');
    expect(resetCountdown(now + (86400 + 5 * 3600) * 1000, now)).toBe('1d5h');
    expect(resetCountdown(now + 5 * 3600000, now)).toBe('5h');
    expect(resetCountdown(now + (4 * 3600 + 3 * 60) * 1000, now)).toBe('4h3m');
    expect(resetCountdown(now + 185000, now)).toBe('3m');
    expect(resetCountdown(now + 61000, now)).toBe('1m');
    expect(resetCountdown(now + 60000, now)).toBe('1m');
    expect(resetCountdown(now + 59999, now)).toBe('59s');
    expect(resetCountdown(now + 59000, now)).toBe('59s');
    expect(resetCountdown(now - 1000, now)).toBe('0s');
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
  it('leaves an 8 DIP gap to taskbars on each edge, including negative screen coordinates', () => {
    const display = { x: -1920, y: -200, width: 1920, height: 1080 };
    const bottomWork = { ...display, height: 1032 };
    const bottomIcon = { x: -90, y: 839, width: 24, height: 24 };
    const bottom = trayMenuRect(bottomIcon, display, bottomWork, 151);
    expect(bottom.y + bottom.height).toBe(bottomWork.y + bottomWork.height - 8);
    expect(bottom.x + bottom.width).toBe(bottomIcon.x + bottomIcon.width);
    const top = trayMenuRect({ x: -25, y: -195, width: 24, height: 24 }, display,
      { ...display, y: -152, height: 1032 }, 183);
    expect(top.y).toBe(-144);
    expect(top.x + top.width).toBeLessThanOrEqual(display.x + display.width - 8);
    const left = trayMenuRect({ x: -1915, y: 700, width: 24, height: 24 }, display,
      { ...display, x: -1872, width: 1872 }, 287);
    expect(left.x).toBe(-1864);
    expect(left.y + left.height).toBeLessThanOrEqual(display.y + display.height - 8);
    const rightWork = { ...display, width: 1872 };
    const right = trayMenuRect({ x: -35, y: 700, width: 24, height: 24 }, display, rightWork, 287);
    expect(right.x + right.width).toBe(rightWork.x + rightWork.width - 8);
  });
  it('keeps overflow menus and expanded confirmation panels away from screen edges', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 };
    const work = { ...display, height: 1032 };
    const icon = { x: 1810, y: 970, width: 24, height: 24 };
    const menu = trayMenuRect(icon, display, work, 151);
    const expanded = trayMenuRect(icon, display, work, 287);
    expect(menu.y + menu.height).toBe(icon.y - 8);
    expect(expanded.y + expanded.height).toBe(menu.y + menu.height);
    const autoHidden = trayMenuRect({ x: 1918, y: 1078, width: 24, height: 24 }, display, display, 287);
    expect(autoHidden.x + autoHidden.width).toBe(1912);
    expect(autoHidden.y + autoHidden.height).toBeLessThanOrEqual(1072);
  });
  it('keeps detail off the floating window at the bottom-right corner', () => {
    const work = { x: 0, y: 0, width: 1920, height: 1040 };
    const ball = { x: 1620, y: 940, width: 224, height: 64 };
    const rect = detailRect(ball, work, 2);
    const overlapWidth = Math.max(0, Math.min(rect.x + rect.width, ball.x + ball.width) - Math.max(rect.x, ball.x));
    const overlapHeight = Math.max(0, Math.min(rect.y + rect.height, ball.y + ball.height) - Math.max(rect.y, ball.y));
    expect(overlapWidth * overlapHeight).toBe(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(ball.x - 8);
  });
  it('shrinks the detail when an account has no reset cards', () => {
    const withCards = { ...quota, platform: 'openai', resetCredits: { available: 1, nearestExpiresAt: Date.now() + 86400000 } };
    const noCards = { ...withCards, resetCredits: { available: 0, nearestExpiresAt: null } };
    expect(detailHeight([withCards, noCards], defaults) - detailHeight([noCards, noCards], defaults)).toBe(18);
    expect(detailHeight([withCards, noCards], { ...defaults, showResetExpiry: false })).toBe(detailHeight([noCards, noCards], { ...defaults, showResetExpiry: false }));
  });
});

describe('sub2api 0.2.8 input', () => {
  it('normalizes a server address ending in the API prefix', () => {
    expect(normalizeServer('https://example.com/api/v1/')).toBe('https://example.com');
  });
});
