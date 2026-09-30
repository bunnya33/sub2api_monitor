import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, screen, Tray } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clampRect, detailRect, size, snapEdge, trayMenuRect } from '../shared/geometry';
import { loginSchema, settingsSchema, type Edge, type LoginInput, type Period, type Rect, type Settings, type Snapshot } from '../shared/model';
import { Controller } from './controller';
import { Store, type Configuration } from './store';
import { trayIcon } from './tray-icon';
import { Updates } from './updates';
import { watchMenu } from './menu-monitor';

protocol.registerSchemesAsPrivileged([{ scheme: 'quota-font', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.QUOTA_DATA_DIR) {
  mkdirSync(process.env.QUOTA_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.QUOTA_DATA_DIR);
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

let store: Store, config: Configuration, controller: Controller, floating: BrowserWindow;
let detail: BrowserWindow | null = null, settings: BrowserWindow | null = null, menu: BrowserWindow | null = null;
let snapPreview: BrowserWindow | null = null, tray: Tray;
let updates: Updates, baseTrayIcon: Electron.NativeImage, menuExpanded = false;
const popupReady = new WeakMap<BrowserWindow, Promise<void>>();
const popupRendered = new Map<Electron.WebContents, () => void>();
let menuRequest = 0, lastTrayRightClick = 0;
let menuAnchor: Electron.Rectangle | null = null, stopMenuWatch: (() => void) | null = null;
let menuWatchAbort: AbortController | null = null;
const MENU_CONFIRM_SPACE = 104;
let edge: Edge = null, rotatingIndex = 0, rotatingPeriod: Period = 'five', visible = true, overFloating = false, overDetail = false;
let snapPreviewEdge: Edge = null;
let dragging = false, dragTimer: NodeJS.Timeout | null = null, leaveTimer: NodeJS.Timeout | null = null, hoverTimer: NodeJS.Timeout | null = null;
let dragOrigin: { native: Electron.Point; bounds: Electron.Rectangle; offsetX: number; offsetY: number; pointerX: number; pointerY: number } | null = null;
let dragPosition: Electron.Point | null = null;
let rotationTimer: NodeJS.Timeout, nextRotation = 0, opacityTimer: NodeJS.Timeout | null = null;
let currentOpacity = 1;

function url(window: BrowserWindow, view: 'floating' | 'detail' | 'settings' | 'menu' | 'snap-preview'): void {
  const query = { view };
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
}
function makeWindow(width: number, height: number, focusable = false): BrowserWindow {
  return new BrowserWindow({ width, height, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, movable: true, show: false, alwaysOnTop: true, skipTaskbar: true,
    focusable, hasShadow: false, webPreferences: { preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: !app.isPackaged } });
}
function senderView(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): string | null {
  const sender = event.sender;
  const windows: [BrowserWindow | null | undefined, string][] = [[floating, 'floating'], [detail, 'detail'],
    [settings, 'settings'], [menu, 'menu'], [snapPreview, 'snap-preview']];
  for (const [window, view] of windows) if (window && !window.isDestroyed() && sender === window.webContents) return view;
  return null;
}
function previewState(): Snapshot {
  return { ...controller.state, edge: snapPreviewEdge,
    collapsed: !!(snapPreviewEdge && controller.state.settings.autoCollapse) };
}
function publish(): void {
  controller.state.edge = edge;
  controller.state.collapsed = !!(edge && controller.state.settings.autoCollapse);
  controller.state.rotatingIndex = rotatingIndex;
  controller.state.rotatingPeriod = rotatingPeriod;
  controller.state.visible = visible;
  for (const window of [floating, detail, settings, menu]) if (window && !window.isDestroyed()) window.webContents.send('state', controller.state);
  if (snapPreview && !snapPreview.isDestroyed()) snapPreview.webContents.send('state', previewState());
  applyOpacity();
}
function save(): void {
  config = { ...config, settings: controller.state.settings, server: controller.state.connection.server, email: controller.state.connection.email };
  store.saveConfig(config);
}
function configureAutoStart(enabled: boolean): void {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.QUOTA_DATA_DIR) return;
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--autostart'] });
}
function displayFor(rect: Rect) {
  return screen.getDisplayNearestPoint({ x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) });
}
function resizeFloating(position?: { x: number; y: number }): void {
  if (!floating || floating.isDestroyed()) return;
  const old = floating.getBounds();
  const accounts = controller.state.quotas;
  const target = size(controller.state.settings, accounts, edge, !!(edge && controller.state.settings.autoCollapse), rotatingIndex, rotatingPeriod);
  const proposed = { x: position?.x ?? old.x, y: position?.y ?? old.y, ...target };
  const work = displayFor(proposed).workArea;
  floating.setBounds(clampRect(proposed, work, edge));
  if (detail?.isVisible()) detail.setBounds(detailRect(floating.getBounds(), displayFor(floating.getBounds()).workArea, accounts, controller.state.settings));
  publish();
}
function savePosition(): void {
  config.position = { ...floating.getBounds(), edge };
  store.saveConfig(config);
}
function hideSnapPreview(): void {
  snapPreviewEdge = null;
  snapPreview?.hide();
}
function moveFloatingDuringDrag(x: number, y: number): void {
  if (!dragOrigin) return;
  const point = { x: Math.round(x), y: Math.round(y) };
  if (point.x === dragPosition?.x && point.y === dragPosition?.y) return;
  dragPosition = point;
  // setPosition reuses rounded native bounds and grows the window at fractional DPI.
  // Always supply the original logical size, rather than feeding getBounds back in.
  floating.setBounds({ ...point, width: dragOrigin.bounds.width, height: dragOrigin.bounds.height });
  const rect = floating.getBounds(), work = displayFor(rect).workArea;
  const contained = clampRect(rect, work);
  const candidate = snapEdge(contained, work);
  if (!candidate) { hideSnapPreview(); return; }
  const changed = snapPreviewEdge !== candidate;
  snapPreviewEdge = candidate;
  if (!snapPreview || snapPreview.isDestroyed()) {
    snapPreview = makeWindow(1, 1);
    snapPreview.setIgnoreMouseEvents(true);
    snapPreview.setAlwaysOnTop(true, 'floating');
    url(snapPreview, 'snap-preview');
    snapPreview.on('closed', () => { snapPreview = null; });
  }
  const target = size(controller.state.settings, controller.state.quotas, candidate, controller.state.settings.autoCollapse, rotatingIndex, rotatingPeriod);
  snapPreview.setBounds(clampRect({ ...contained, ...target }, work, candidate));
  if (!snapPreview.isVisible()) snapPreview.showInactive();
  if (changed) publish();
}
function stopDrag(): void {
  if (!dragging) return;
  dragging = false;
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  const rect = floating.getBounds();
  const work = displayFor(rect).workArea;
  const contained = clampRect(rect, work);
  dragOrigin = null;
  dragPosition = null;
  hideSnapPreview();
  edge = snapEdge(contained, work);
  resizeFloating({ x: contained.x, y: contained.y });
  savePosition();
  nextRotation = Date.now() + controller.state.settings.rotateSeconds * 1000;
  applyOpacity();
}
function beginDrag(pointerX: number, pointerY: number): void {
  if (dragging || !floating.isVisible()) return;
  hideDetail(); closeMenu();
  hideSnapPreview();
  const cursor = screen.getCursorScreenPoint(), bounds = floating.getBounds();
  const xRatio = (cursor.x - bounds.x) / bounds.width, yRatio = (cursor.y - bounds.y) / bounds.height;
  if (edge) {
    edge = null;
    resizeFloating({ x: Math.round(cursor.x - xRatio * size(controller.state.settings, controller.state.quotas, null, false).width),
      y: Math.round(cursor.y - yRatio * size(controller.state.settings, controller.state.quotas, null, false).height) });
  }
  const expanded = floating.getBounds(), offsetX = cursor.x - expanded.x, offsetY = cursor.y - expanded.y;
  dragOrigin = { native: cursor, bounds: { ...expanded, ...size(controller.state.settings, controller.state.quotas, null, false) }, offsetX, offsetY, pointerX, pointerY };
  dragPosition = { x: expanded.x, y: expanded.y };
  dragging = true;
  dragTimer = setInterval(() => {
    if (!dragging) return;
    const point = screen.getCursorScreenPoint();
    if (point.x !== cursor.x || point.y !== cursor.y) moveFloatingDuringDrag(point.x - offsetX, point.y - offsetY);
  }, 16);
  applyOpacity();
}
function targetOpacity(): number {
  const value = controller.state.settings;
  return !value.fadeInactive || overFloating || overDetail || dragging || floating.isFocused() ? 1 : value.inactiveOpacity / 100;
}
function applyOpacity(): void {
  if (!floating || floating.isDestroyed()) return;
  const target = targetOpacity();
  if (opacityTimer) clearInterval(opacityTimer);
  const start = currentOpacity, began = Date.now();
  opacityTimer = setInterval(() => {
    if (floating.isDestroyed()) { if (opacityTimer) clearInterval(opacityTimer); opacityTimer = null; return; }
    const t = Math.min(1, (Date.now() - began) / 140);
    currentOpacity = start + (target - start) * (1 - (1 - t) ** 2);
    floating.setOpacity(currentOpacity);
    if (t === 1 && opacityTimer) { clearInterval(opacityTimer); opacityTimer = null; }
  }, 16);
}
function showDetail(): void {
  if (dragging || !floating.isVisible()) return;
  if (!detail || detail.isDestroyed()) {
    detail = makeWindow(320, 350);
    url(detail, 'detail');
    detail.on('closed', () => { detail = null; overDetail = false; });
  }
  detail.setBounds(detailRect(floating.getBounds(), displayFor(floating.getBounds()).workArea, controller.state.quotas, controller.state.settings));
  if (!detail.isVisible()) detail.showInactive();
  publish();
}
function hideDetail(): void {
  detail?.hide(); overDetail = false;
  if (hoverTimer) clearTimeout(hoverTimer);
  nextRotation = Date.now() + controller.state.settings.rotateSeconds * 1000;
  applyOpacity();
}
function hover(surface: 'floating' | 'detail', inside: boolean): void {
  if (surface === 'floating') overFloating = inside; else overDetail = inside;
  if (leaveTimer) clearTimeout(leaveTimer);
  if (surface === 'floating') {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = inside && !dragging ? setTimeout(showDetail, 220) : null;
  }
  if (!overFloating && !overDetail) leaveTimer = setTimeout(() => {
    if (!overFloating && !overDetail) hideDetail();
  }, 300);
  nextRotation = Date.now() + controller.state.settings.rotateSeconds * 1000;
  applyOpacity();
}
function closeMenu(): void {
  menuRequest++;
  menuWatchAbort?.abort(); menuWatchAbort = null;
  stopMenuWatch?.(); stopMenuWatch = null;
  const closed = menu;
  menu = null;
  // A hidden non-activating Chromium window can retain its previous input state.
  // Each opening starts with fresh native and renderer input/capture state.
  if (closed && !closed.isDestroyed()) closed.destroy();
  menuExpanded = false;
  menuAnchor = null;
}
function menuHeight(expanded = menuExpanded): number {
  return (controller.state.update.status === 'idle' ? 151 : 183) + (expanded ? MENU_CONFIRM_SPACE : 0);
}
function syncMenuHeight(): void {
  if (!menu?.isVisible() || !menuAnchor) return;
  const display = displayFor(menuAnchor);
  menu.setBounds(trayMenuRect(menuAnchor, display.bounds, display.workArea, menuHeight()));
}
function resizeMenu(expanded: boolean): void {
  if (!menu?.isVisible() || menuExpanded === expanded) return;
  menuExpanded = expanded;
  syncMenuHeight();
}
function preparePopup(window: BrowserWindow): void {
  const contents = window.webContents;
  window.setAlwaysOnTop(true, 'pop-up-menu');
  window.webContents.setBackgroundThrottling(false);
  const painted = new Promise<void>((resolve, reject) => {
    window.once('ready-to-show', resolve);
    window.once('closed', () => reject(new Error('菜单窗口已关闭')));
    window.webContents.once('did-fail-load', (_event, _code, description) => reject(new Error(description)));
  });
  const rendered = new Promise<void>(resolve => { popupRendered.set(contents, resolve); });
  window.once('closed', () => popupRendered.delete(contents));
  popupReady.set(window, Promise.all([painted, rendered]).then(() => {}));
  url(window, 'menu');
}
function ensureMenu(): BrowserWindow {
  if (!menu || menu.isDestroyed()) {
    menu = makeWindow(176, menuHeight());
    const window = menu;
    preparePopup(window);
    window.on('blur', () => {
      if (menu === window && window.isFocusable() && !window.webContents.isDevToolsOpened()) closeMenu();
    });
    window.on('closed', () => {
      if (menu === window) closeMenu();
    });
  }
  return menu;
}
async function openMenu(anchor: Electron.Rectangle): Promise<void> {
  if (menu && !menu.isDestroyed()) return; // Also coalesce requests while the popup is loading.
  closeMenu();
  const request = menuRequest;
  const target = ensureMenu();
  try {
    await popupReady.get(target);
    if (request !== menuRequest || target.isDestroyed()) return;
    menuAnchor = anchor;
    const display = displayFor(anchor);
    target.setBounds(trayMenuRect(anchor, display.bounds, display.workArea, menuHeight()));
    publish();
    let stop: (() => void) | null = null;
    menuWatchAbort = new AbortController();
    try { stop = await watchMenu(target, () => { if (request === menuRequest) closeMenu(); }, menuWatchAbort.signal); } catch (error) { console.error('Unable to initialize menu watcher:', error); }
    if (request !== menuRequest || target.isDestroyed()) { stop?.(); return; }
    stopMenuWatch = stop;
    target.setFocusable(!stopMenuWatch);
    if (stopMenuWatch) { target.showInactive(); target.moveTop(); }
    else { target.show(); target.focus(); }
  } catch (error) {
    if (request === menuRequest) closeMenu();
    console.error('Unable to show menu:', error);
  }
}
function openTrayMenu(icon: Electron.Rectangle, toggle = false): void {
  if (toggle && menu?.isVisible()) { closeMenu(); return; }
  overFloating = false; hideDetail();
  const cursor = screen.getCursorScreenPoint();
  const anchor = icon.width > 0 && icon.height > 0 ? icon : { ...cursor, width: 1, height: 1 };
  void openMenu(anchor);
}
function openSettings(): void {
  closeMenu();
  if (!settings || settings.isDestroyed()) {
    settings = makeWindow(520, 568, true);
    settings.setResizable(true); settings.setMinimumSize(470, 420);
    settings.setAlwaysOnTop(false); settings.setSkipTaskbar(false);
    settings.center(); url(settings, 'settings');
    settings.on('closed', () => { controller.setAccountsVisible(false); settings = null; });
  }
  settings.show(); settings.focus(); publish();
}
function menuAction(action: 'settings' | 'refresh' | 'visibility' | 'update' | 'quit'): void {
  closeMenu();
  if (action === 'settings') openSettings();
  if (action === 'refresh') void controller.refresh();
  if (action === 'visibility') { visible = !visible; if (visible) floating.showInactive(); else { hideDetail(); floating.hide(); } publish(); }
  if (action === 'update') void updates.confirm();
  if (action === 'quit') app.quit();
}
function setupIpc(): void {
  ipcMain.handle('state:get', event => senderView(event) === 'snap-preview' ? previewState() : senderView(event) ? controller.state : null);
  ipcMain.handle('settings:update', async (event, patch: Partial<Settings>) => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    try { const parsed = settingsSchema.partial().parse(patch); if (parsed.autoStart !== undefined) configureAutoStart(parsed.autoStart);
      await controller.update(parsed); resizeFloating(); return { ok: true, value: undefined }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '保存失败' }; }
  });
  ipcMain.handle('auth:login', async (event, input: LoginInput) => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    try { await controller.login(loginSchema.parse(input)); return { ok: true, value: undefined }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '登录失败' }; }
  });
  ipcMain.handle('auth:verify', async (event, code: string) => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    try { await controller.verify(code); return { ok: true, value: undefined }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '验证失败' }; }
  });
  ipcMain.handle('auth:logout', async event => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    controller.logout(); return { ok: true, value: undefined };
  });
  ipcMain.handle('quota:refresh', async event => {
    if (!senderView(event)) return { ok: false, error: '无效窗口' };
    try { await controller.refresh(); return { ok: true, value: undefined }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '刷新失败' }; }
  });
  ipcMain.handle('account:status', async (event, id: number, status: 'active' | 'inactive') => {
    if (senderView(event) !== 'detail') return { ok: false, error: '无效窗口' };
    if (!Number.isSafeInteger(id) || id <= 0 || !['active', 'inactive'].includes(status)) return { ok: false, error: '账号状态参数无效' };
    try { await controller.setAccountStatus(id, status); return { ok: true, value: undefined }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '更新账号状态失败' }; }
  });
  ipcMain.on('accounts:visible', (event, visible: boolean) => { if (senderView(event) === 'settings') controller.setAccountsVisible(visible === true); });
  ipcMain.handle('account:reset-quota', async (event, id: number) => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: '账号参数无效' };
    try { return { ok: true, value: await controller.resetAccountQuota(id) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '重置失败' }; }
  });
  ipcMain.handle('font:import', async event => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    const choice = await dialog.showOpenDialog(settings!, { title: '导入 TTF 字体', properties: ['openFile'], filters: [{ name: 'TrueType 字体', extensions: ['ttf'] }] });
    if (choice.canceled || !choice.filePaths[0]) return { ok: false, error: '已取消导入' };
    const file = choice.filePaths[0];
    try {
      const length = statSync(file).size;
      if (path.extname(file).toLowerCase() !== '.ttf' || length < 4 || length > 20 * 1024 * 1024 || readFileSync(file).readUInt32BE(0) !== 0x00010000)
        return { ok: false, error: '请选择有效且不超过 20 MB 的 TTF 字体' };
      copyFileSync(file, store.fontDestination());
      await controller.update({ fontName: path.basename(file) });
      return { ok: true, value: path.basename(file) };
    } catch { return { ok: false, error: '无法读取该字体文件' }; }
  });
  ipcMain.handle('font:remove', async event => {
    if (senderView(event) !== 'settings') return { ok: false, error: '无效窗口' };
    store.removeFont(); await controller.update({ fontName: '' }); return { ok: true, value: undefined };
  });
  ipcMain.on('drag', (event, start: boolean, x?: number, y?: number) => { if (senderView(event) === 'floating') start ? beginDrag(x ?? 0, y ?? 0) : stopDrag(); });
  ipcMain.on('drag:move', (event, x: number, y: number) => {
    if (senderView(event) !== 'floating' || !dragging || !dragOrigin || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const native = screen.getCursorScreenPoint(), origin = dragOrigin;
    if (native.x !== origin.native.x || native.y !== origin.native.y)
      moveFloatingDuringDrag(native.x - origin.offsetX, native.y - origin.offsetY);
    else moveFloatingDuringDrag(origin.bounds.x + x - origin.pointerX, origin.bounds.y + y - origin.pointerY);
  });
  ipcMain.on('hover', (event, surface: 'floating' | 'detail', inside: boolean) => {
    if (senderView(event) === surface) hover(surface, inside);
  });
  ipcMain.on('menu:action', (event, action: 'settings' | 'refresh' | 'visibility' | 'update' | 'quit') => { if (senderView(event) === 'menu' && menu?.isVisible()) menuAction(action); });
  ipcMain.on('menu:ready', event => { if (senderView(event) === 'menu') { popupRendered.get(event.sender)?.(); popupRendered.delete(event.sender); } });
  ipcMain.on('menu:resize-update', (event, expanded: boolean) => { if (senderView(event) === 'menu') resizeMenu(expanded === true); });
  ipcMain.on('menu:dismiss', event => { if (senderView(event) === 'menu') closeMenu(); });
  ipcMain.on('settings:close', event => { if (senderView(event) === 'settings') { controller.setAccountsVisible(false); settings?.hide(); } });
}

app.on('second-instance', () => { if (floating) { visible = true; floating.showInactive(); openSettings(); } });
app.whenReady().then(() => {
  store = new Store(); config = store.loadConfig();
  try { configureAutoStart(config.settings.autoStart); } catch (error) { console.error('Unable to configure auto start:', error); }
  protocol.handle('quota-font', request => {
    if (new URL(request.url).host !== 'local' || new URL(request.url).pathname !== '/custom.ttf' || !store.fontFile())
      return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(store.fontFile()!).toString());
  });
  controller = new Controller(config.settings, store, save, undefined, config.server, config.email);
  edge = config.position?.edge ?? null;
  const initial = size(config.settings, controller.state.quotas, edge, !!(edge && config.settings.autoCollapse));
  floating = makeWindow(initial.width, initial.height);
  floating.on('focus', applyOpacity); floating.on('blur', applyOpacity);
  url(floating, 'floating');
  const work = config.position ? screen.getDisplayNearestPoint(config.position).workArea : screen.getPrimaryDisplay().workArea;
  floating.setBounds(clampRect({ x: config.position?.x ?? work.x + Math.round(work.width / 3),
    y: config.position?.y ?? work.y + Math.round(work.height / 4), ...initial }, work, edge));
  floating.showInactive(); floating.setAlwaysOnTop(true, 'floating');
  baseTrayIcon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets/app.png'));
  tray = new Tray(trayIcon(baseTrayIcon, false));
  tray.setToolTip('Sub2API Quota Monitor');
  tray.on('right-click', (_event, bounds) => { lastTrayRightClick = Date.now(); openTrayMenu(bounds); });
  tray.on('click', (_event, bounds) => { if (Date.now() - lastTrayRightClick > 250) openTrayMenu(bounds, true); });
  // Isolated desktop tests exercise the real tray event without a renderer command to open menus.
  if (process.env.QUOTA_DATA_DIR) (app as NodeJS.EventEmitter).on('quota:test-tray-right-click', (bounds: Electron.Rectangle) => tray.emit('right-click', {}, bounds));
  setupIpc();
  updates = new Updates(state => {
    controller.state.update = state;
    tray.setImage(trayIcon(baseTrayIcon, state.status !== 'idle'));
    tray.setToolTip(state.version ? `Sub2API Quota Monitor · 新版本 ${state.version}` : 'Sub2API Quota Monitor');
    syncMenuHeight();
    publish();
  }, process.env.QUOTA_DATA_DIR ? process.env.QUOTA_TEST_UPDATE_VERSION : undefined);
  updates.start();
  controller.on('state', () => { resizeFloating(); publish(); });
  screen.on('display-metrics-changed', () => { closeMenu(); resizeFloating(); });
  screen.on('display-removed', () => { closeMenu(); resizeFloating(); });
  screen.on('display-added', () => { closeMenu(); resizeFloating(); });
  rotationTimer = setInterval(() => {
    if (!edge || !controller.state.settings.autoCollapse || dragging || overFloating || overDetail || !floating.isVisible()) return;
    if (Date.now() < nextRotation) return;
    nextRotation = Date.now() + controller.state.settings.rotateSeconds * 1000;
    if (controller.state.quotas.length) {
      rotatingIndex = (rotatingIndex + 1) % controller.state.quotas.length;
      if (rotatingIndex === 0) rotatingPeriod = rotatingPeriod === 'five' ? 'seven' : 'five';
      resizeFloating();
    }
  }, 250);
  nextRotation = Date.now() + controller.state.settings.rotateSeconds * 1000;
  void controller.start().then(() => { if (controller.state.connection.status === 'disconnected' && !config.settings.demo) openSettings(); });
});
app.on('before-quit', () => {
  menuRequest++;
  menuWatchAbort?.abort(); stopMenuWatch?.();
  for (const timer of [dragTimer, opacityTimer, leaveTimer, hoverTimer, rotationTimer]) if (timer) clearInterval(timer);
  updates?.stop();
  controller?.dispose();
});
