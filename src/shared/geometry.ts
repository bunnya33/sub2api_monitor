import { defaults, summaryPeriods, visiblePeriods, type Edge, type Period, type Quota, type Rect, type Settings } from './model';

// Electron's screen workArea, cursor point and BrowserWindow bounds share logical DIP coordinates.
export function size(settings: Settings, accounts: Quota[], edge: Edge, collapsed: boolean, index = 0, rotatingPeriod: Period = 'five'): { width: number; height: number } {
  if (collapsed && edge) {
    if (edge === 'top' || edge === 'bottom') return { width: settings.topWidth, height: 32 };
    const account = accounts[index % Math.max(1, accounts.length)];
    const count = Math.max(1, account ? summaryPeriods(account, settings, rotatingPeriod).length : 1);
    return { width: settings.sideWidth, height: 30 + count * 22 + (count - 1) * 4 + (settings.showConcurrency ? 26 : 0) };
  }
  const count = Math.max(0, ...accounts.map(account => visiblePeriods(account, settings).length));
  return { width: 20 + settings.nameWidth + settings.barWidth * count + Math.max(0, count - 1) * 6 + (settings.showConcurrency ? settings.concurrencyWidth + 6 : 0),
    height: 14 + Math.max(1, accounts.length) * 22 + Math.max(0, accounts.length - 1) * 6 };
}
export function clampRect(rect: Rect, work: Rect, edge: Edge = null): Rect {
  const width = Math.min(rect.width, work.width), height = Math.min(rect.height, work.height);
  let x = Math.max(work.x, Math.min(rect.x, work.x + work.width - width));
  let y = Math.max(work.y, Math.min(rect.y, work.y + work.height - height));
  if (edge === 'left') x = work.x;
  if (edge === 'right') x = work.x + work.width - width;
  if (edge === 'top') y = work.y;
  if (edge === 'bottom') y = work.y + work.height - height;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
export function trayMenuRect(icon: Rect, display: Rect, work: Rect, height: number, width = 176): Rect {
  const taskbarAtTop = work.y > display.y;
  const taskbarAtLeft = work.x > display.x;
  return clampRect({
    x: taskbarAtLeft ? icon.x : icon.x + icon.width - width,
    y: taskbarAtTop ? icon.y : icon.y + icon.height - height,
    width, height
  }, display);
}
export function snapEdge(rect: Rect, work: Rect, distance = 20): Edge {
  const candidates: [Exclude<Edge, null>, number][] = [
    ['left', Math.abs(rect.x - work.x)], ['right', Math.abs(work.x + work.width - rect.x - rect.width)],
    ['top', Math.abs(rect.y - work.y)], ['bottom', Math.abs(work.y + work.height - rect.y - rect.height)]
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] <= distance ? candidates[0][0] : null;
}
export function detailHeight(accounts: Quota[] | number, settings: Settings): number {
  const count = Math.max(1, typeof accounts === 'number' ? accounts : accounts.length);
  const expiryRows = typeof accounts === 'number' ? count : accounts.filter(account =>
    account.platform === 'openai' && account.type === 'oauth' && account.resetCredits?.available !== 0).length;
  return 64 + count * (98 + Number(settings.showResetCount) * 18) + Number(settings.showResetExpiry) * expiryRows * 18;
}
export function detailRect(ball: Rect, work: Rect, accounts: Quota[] | number, settings: Settings = defaults): Rect {
  const width = Math.min(320, work.width - 16), height = Math.min(detailHeight(accounts, settings), work.height - 16);
  const options: Rect[] = [
    { x: ball.x + ball.width + 8, y: ball.y, width, height },
    { x: ball.x - width - 8, y: ball.y, width, height },
    { x: ball.x, y: ball.y + ball.height + 8, width, height },
    { x: ball.x, y: ball.y - height - 8, width, height }
  ];
  const inset = { x: work.x + 8, y: work.y + 8, width: work.width - 16, height: work.height - 16 };
  const overlap = (rect: Rect) => Math.max(0, Math.min(rect.x + rect.width, ball.x + ball.width) - Math.max(rect.x, ball.x))
    * Math.max(0, Math.min(rect.y + rect.height, ball.y + ball.height) - Math.max(rect.y, ball.y));
  return options.map(option => clampRect(option, inset)).reduce((best, current) => overlap(current) < overlap(best) ? current : best);
}
