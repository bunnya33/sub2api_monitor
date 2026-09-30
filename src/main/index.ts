import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, screen, Tray } from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { clampRect, detailRect, size, snapEdge } from '../shared/geometry';
import { loginSchema, settingsSchema, type Edge, type LoginInput, type Period, type Rect, type Settings, type Snapshot } from '../shared/model';
import { Controller } from './controller';
import { Store, type Configuration } from './store';

protocol.registerSchemesAsPrivileged([{ scheme: 'quota-font', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.QUOTA_DATA_DIR) {
  mkdirSync(process.env.QUOTA_DATA_DIR, { recursive: true });
  app.setPath('userData', process.env.QUOTA_DATA_DIR);
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();

let store: Store, config: Configuration, controller: Controller, floating: BrowserWindow;
let detail: BrowserWindow | null = null, settings: BrowserWindow | null = null, menu: BrowserWindow | null = null;
let snapPreview: BrowserWindow | null = null, menuBackdrop: BrowserWindow | null = null, tray: Tray;
let edge: Edge = null, rotatingIndex = 0, rotatingPeriod: Period = 'five', visible = true, overFloating = false, overDetail = false;
let snapPreviewEdge: Edge = null, menuFromTray = false;
let dragging = false, dragTimer: NodeJS.Timeout | null = null, leaveTimer: NodeJS.Timeout | null = null, hoverTimer: NodeJS.Timeout | null = null;
let dragOrigin: { native: Electron.Point; bounds: Electron.Rectangle; offsetX: number; offsetY: number; pointerX: number; pointerY: number } | null = null;
let rotationTimer: NodeJS.Timeout, nextRotation = 0, opacityTimer: NodeJS.Timeout | null = null;
let currentOpacity = 1;

function url(window: BrowserWindow, view: 'floating' | 'detail' | 'settings' | 'menu' | 'menu-backdrop' | 'snap-preview'): void {
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view } });
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
  if (sender === floating?.webContents) return 'floating';
  if (sender === detail?.webContents) return 'detail';
  if (sender === settings?.webContents) return 'settings';
  if (sender === menu?.webContents) return 'menu';
  if (sender === menuBackdrop?.webContents) return 'menu-backdrop';
  if (sender === snapPreview?.webContents) return 'snap-preview';
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
  floating.setPosition(Math.round(x), Math.round(y));
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
  dragOrigin = { native: cursor, bounds: expanded, offsetX, offsetY, pointerX, pointerY };
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
function closeMenu(dismissOverflow = false): void {
  if (dismissOverflow && menuFromTray && menu?.isVisible() && !menu.isFocused()) menu.focus();
  menu?.hide(); menuBackdrop?.hide(); menuFromTray = false;
}
function showMenuBackdrop(x: number, y: number): void {
  if (!menuBackdrop || menuBackdrop.isDestroyed()) {
    menuBackdrop = makeWindow(1, 1);
    url(menuBackdrop, 'menu-backdrop');
    menuBackdrop.on('closed', () => { menuBackdrop = null; });
  }
  menuBackdrop.setBounds(screen.getDisplayNearestPoint({ x, y }).workArea);
  menuBackdrop.showInactive();
  menuBackdrop.moveTop();
}
function openMenu(x: number, y: number, fromTray = false): void {
  if (fromTray && menu?.isVisible() && menuFromTray) { closeMenu(true); return; }
  menuFromTray = fromTray;
  if (!menu || menu.isDestroyed()) {
    menu = makeWindow(176, 164, true);
    url(menu, 'menu');
    menu.on('blur', () => { if (!menu?.webContents.isDevToolsOpened()) closeMenu(); });
    menu.on('closed', () => { menu = null; });
  }
  const work = screen.getDisplayNearestPoint({ x, y }).workArea;
  menu.setBounds(clampRect({ x, y, width: 176, height: 164 }, work));
  if (fromTray) {
    showMenuBackdrop(x, y); menu.showInactive(); menu.moveTop();
    setTimeout(() => { if (menuFromTray && menu?.isVisible()) menu.moveTop(); }, 60);
  }
  else { menuBackdrop?.hide(); menu.show(); menu.focus(); }
  publish();
}
function openSettings(): void {
  closeMenu();
  if (!settings || settings.isDestroyed()) {
    settings = makeWindow(520, 568, true);
    settings.setResizable(true); settings.setMinimumSize(470, 420);
    settings.setAlwaysOnTop(false); settings.setSkipTaskbar(false);
    settings.center(); url(settings, 'settings');
    settings.on('closed', () => { settings = null; });
  }
  settings.show(); settings.focus(); publish();
}
function menuAction(action: 'settings' | 'refresh' | 'visibility' | 'quit'): void {
  closeMenu(true);
  if (action === 'settings') openSettings();
  if (action === 'refresh') void controller.refresh();
  if (action === 'visibility') { visible = !visible; if (visible) floating.showInactive(); else { hideDetail(); floating.hide(); } publish(); }
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
  ipcMain.on('context-menu', (event, x: number, y: number, fromTray = false) => {
    if (senderView(event) !== 'floating') return;
    overFloating = false; hideDetail(); openMenu(x, y, fromTray === true);
  });
  ipcMain.on('menu:action', (event, action: 'settings' | 'refresh' | 'visibility' | 'quit') => { if (senderView(event) === 'menu') menuAction(action); });
  ipcMain.on('menu:dismiss', event => { if (senderView(event) === 'menu-backdrop') closeMenu(); });
  ipcMain.on('settings:close', event => { if (senderView(event) === 'settings') settings?.hide(); });
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
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets/app.png'));
  tray = new Tray(icon);
  tray.setToolTip('Sub2API Quota Monitor');
  tray.on('right-click', () => { const cursor = screen.getCursorScreenPoint(); openMenu(cursor.x, cursor.y - 164, true); });
  tray.on('click', () => { const cursor = screen.getCursorScreenPoint(); openMenu(cursor.x, cursor.y - 164, true); });
  setupIpc();
  controller.on('state', () => { resizeFloating(); publish(); });
  screen.on('display-metrics-changed', () => resizeFloating());
  screen.on('display-removed', () => resizeFloating());
  screen.on('display-added', () => resizeFloating());
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
  for (const timer of [dragTimer, opacityTimer, leaveTimer, hoverTimer, rotationTimer]) if (timer) clearInterval(timer);
  controller?.dispose();
});
