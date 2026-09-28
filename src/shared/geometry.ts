import { defaults, summaryPeriods, visiblePeriods, type Edge, type Quota, type Rect, type Settings } from './model';

// Electron's screen workArea, cursor point and BrowserWindow bounds share logical DIP coordinates.
export function size(settings: Settings, accounts: Quota[], edge: Edge, collapsed: boolean, index = 0): { width: number; height: number } {
  if (collapsed && edge) {
    if (edge === 'top' || edge === 'bottom') return { width: settings.topWidth, height: 32 };
    const account = accounts[index % Math.max(1, accounts.length)];
    const count = Math.max(1, account ? summaryPeriods(account, settings).length : 1);
    return { width: settings.sideWidth, height: 30 + count * 22 + (count - 1) * 4 };
  }
  const count = Math.max(0, ...accounts.map(account => visiblePeriods(account, settings).length));
  return { width: 20 + settings.nameWidth + settings.barWidth * count + Math.max(0, count - 1) * 6,
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
export function snapEdge(rect: Rect, work: Rect, distance = 20): Edge {
  const candidates: [Exclude<Edge, null>, number][] = [
    ['left', Math.abs(rect.x - work.x)], ['right', Math.abs(work.x + work.width - rect.x - rect.width)],
    ['top', Math.abs(rect.y - work.y)], ['bottom', Math.abs(work.y + work.height - rect.y - rect.height)]
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] <= distance ? candidates[0][0] : null;
}
export function detailHeight(count: number, settings: Settings): number {
  const creditRows = Number(settings.showResetCount) + Number(settings.showResetTime);
  return 64 + Math.max(1, count) * (144 + creditRows * 18);
}
export function detailRect(ball: Rect, work: Rect, count: number, settings: Settings = defaults): Rect {
  const width = Math.min(320, work.width - 16), height = Math.min(detailHeight(count, settings), work.height - 16);
  const options: Rect[] = [
    { x: ball.x + ball.width + 8, y: ball.y, width, height },
    { x: ball.x - width - 8, y: ball.y, width, height },
    { x: ball.x, y: ball.y + ball.height + 8, width, height },
    { x: ball.x, y: ball.y - height - 8, width, height }
  ];
  const match = options.find(r => r.x >= work.x && r.y >= work.y && r.x + width <= work.x + work.width && r.y + height <= work.y + work.height);
  return clampRect(match ?? options[0], { x: work.x + 8, y: work.y + 8, width: work.width - 16, height: work.height - 16 });
}
