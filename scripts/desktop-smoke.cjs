const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-electron-smoke-'));
  const output = path.join(root, 'artifacts', process.env.QUOTA_SMOKE_OUTPUT || 'electron-smoke');
  fs.mkdirSync(output, { recursive: true });
  const checks = [];
  const requests = [];
  const fixture = http.createServer(async (request, response) => {
    requests.push(request.url);
    let body = '';
    for await (const part of request) body += part;
    const parsed = body ? JSON.parse(body) : {};
    let data;
    if (request.url === '/api/v1/auth/login') { assert.equal(parsed.email, 'admin@example.com'); data = { requires_2fa: true, temp_token: 'temporary' }; }
    else if (request.url === '/api/v1/auth/login/2fa') { assert.equal(parsed.totp_code, '123456'); data = { access_token: 'access', refresh_token: 'private-refresh-token', expires_in: 3600 }; }
    else if (request.url === '/api/v1/auth/me') data = { role: 'admin', email: 'admin@example.com' };
    else if (request.url?.startsWith('/api/v1/admin/accounts?')) data = { items: [
      { id: 1, name: 'Real Claude', platform: 'anthropic', type: 'oauth', status: 'active' },
      { id: 2, name: 'Real OpenAI', platform: 'openai', type: 'oauth', status: 'active' } ], total: 2 };
    else if (request.url?.includes('/usage?')) data = { source: 'passive', updated_at: '2026-09-28T10:00:00Z',
      five_hour: { utilization: 41, remaining_seconds: 1800 }, seven_day: { utilization: 72, remaining_seconds: 86400 } };
    else if (request.url === '/api/v1/auth/refresh') data = { access_token: 'restored', refresh_token: 'rotated-refresh-token', expires_in: 3600 };
    else if (request.url === '/api/v1/auth/logout') data = {};
    else { response.writeHead(404); response.end('{}'); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ code: 0, data }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const executablePath = process.env.QUOTA_EXECUTABLE || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const app = await _electron.launch({ executablePath,
    args: process.env.QUOTA_EXECUTABLE ? [] : [root], env: { ...process.env, QUOTA_DATA_DIR: data } });
  let activeApp = app;
  app.process().stderr?.on('data', chunk => process.stderr.write(chunk));
  try {
    const floating = await app.firstWindow();
    await floating.waitForSelector('.floating-row');
    const state = await floating.evaluate(() => window.desktop.getState());
    assert.equal(state.quotas.length, 2); checks.push('two demo accounts');
    let bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 224); assert.equal(bounds.height, 64); checks.push('compact 224x64 size');
    await floating.screenshot({ path: path.join(output, 'floating.png') });
    const cursorBefore = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    await floating.mouse.move(20, 20);
    const cursorAfter = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    checks.push(`mouse cursor sampling: ${JSON.stringify({ cursorBefore, cursorAfter })}`);
    await floating.mouse.move(108, 12);
    await floating.mouse.down();
    await floating.mouse.move(150, 22);
    await floating.waitForTimeout(160);
    await floating.mouse.up();
    const dragged = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.notEqual(dragged.x, bounds.x); checks.push('progress bar is draggable');
    bounds = dragged;
    await floating.mouse.move(24, 10);
    await floating.mouse.down();
    await floating.mouse.move(53, 17);
    await floating.waitForTimeout(100);
    await floating.mouse.up();
    const nameDragged = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.notEqual(nameDragged.x, bounds.x); checks.push('account name is draggable');
    await floating.evaluate(() => window.desktop.hover('floating', true));
    const detail = await app.waitForEvent('window', { predicate: window => window.url().includes('view=detail'), timeout: 5000 });
    await detail.waitForSelector('.detail-account');
    assert.equal(await detail.locator('.detail-account').count(), 2); checks.push('hover detail shows both accounts');
    await detail.screenshot({ path: path.join(output, 'detail.png') });
    await detail.getByRole('button', { name: '固定明细' }).click();
    await floating.evaluate(() => window.desktop.hover('floating', false));
    await detail.evaluate(() => window.desktop.hover('detail', false));
    await floating.waitForTimeout(500);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), true);
    checks.push('pinned details stay visible after mouse leaves');
    await detail.getByRole('button', { name: '关闭明细' }).click();
    await floating.waitForTimeout(200);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), false);
    checks.push('detail close action works without activating window');
    const idleOpacity = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getOpacity());
    assert.ok(Math.abs(idleOpacity - .65) < .03); checks.push('idle window opacity 65 percent');
    await floating.mouse.click(18, 16, { button: 'right' });
    const menu = await app.waitForEvent('window', { predicate: window => window.url().includes('view=menu'), timeout: 5000 });
    await menu.waitForSelector('.menu');
    assert.equal(await menu.locator('.menu button').count(), 4); checks.push('custom floating context menu');
    await menu.getByRole('menuitem', { name: '设置' }).click();
    const settings = await app.waitForEvent('window', { predicate: window => window.url().includes('view=settings'), timeout: 5000 });
    await settings.waitForSelector('.settings');
    assert.equal(await settings.getByRole('tab').count(), 5); checks.push('custom frameless settings with five tabs');
    await settings.screenshot({ path: path.join(output, 'settings-display.png') });
    await settings.getByRole('tab', { name: '样式' }).click();
    await settings.screenshot({ path: path.join(output, 'settings-style.png') });
    assert.equal(await settings.locator('input[type=color]').count(), 3); checks.push('three live color previews');
    await settings.getByLabel('注意 51%–79%颜色').fill('#e29b19');
    await settings.waitForFunction(() => document.querySelectorAll('.color-row')[1]?.querySelector('code')?.textContent === '#e29b19');
    assert.equal((await floating.evaluate(() => window.desktop.getState())).settings.warningColor, '#e29b19');
    checks.push('custom warning color propagates to floating UI');
    const font = 'C:\\Windows\\Fonts\\arial.ttf';
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, font);
    await settings.getByTitle('导入 TTF 字体').click();
    await settings.waitForFunction(() => document.querySelector('.font-current')?.textContent === 'arial.ttf');
    await settings.waitForFunction(() => document.fonts.check('12px "Quota Custom"'));
    assert.ok(fs.existsSync(path.join(data, 'custom.ttf'))); checks.push('TTF copied to user data and loaded into UI');
    await settings.screenshot({ path: path.join(output, 'settings-custom-font.png') });
    await settings.getByRole('tab', { name: '账号' }).click();
    await settings.screenshot({ path: path.join(output, 'settings-accounts.png') });
    const alias = settings.getByPlaceholder('浮球显示名称').first();
    await alias.fill('主力账号'); await alias.blur();
    await floating.waitForFunction(() => document.querySelector('.account-name')?.textContent === '主力账号');
    checks.push('alias updates floating row');
    await settings.getByRole('tab', { name: '显示' }).click();
    const nameWidth = settings.getByText('名称宽度').locator('..').locator('input');
    await nameWidth.fill('80'); await nameWidth.blur();
    await floating.waitForFunction(() => document.querySelector('.account-name')?.getBoundingClientRect().width === 80);
    bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 242); checks.push('name width resizes whole floating window');
    await settings.getByText('显示 5 小时额度').locator('..').locator('input').uncheck();
    await floating.waitForFunction(() => document.querySelectorAll('.floating-row .meter').length === 2);
    bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 168); checks.push('seven-day-only window shrinks with custom name width');
    await floating.screenshot({ path: path.join(output, 'seven-day-only.png') });
    await settings.getByText('显示 5 小时额度').locator('..').locator('input').check();
    await settings.getByRole('tab', { name: '样式' }).click();
    await settings.getByText('文字加粗').locator('..').locator('input').check();
    const fontSize = settings.getByText('界面字号').locator('..').locator('input');
    await fontSize.fill('16'); await fontSize.blur();
    await floating.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-size').trim() === '16px');
    const weight = await floating.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-weight').trim());
    assert.equal(weight, '600'); checks.push('font size and weight apply to floating UI');
    await settings.getByRole('tab', { name: '显示' }).click();
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(({ id, scaleFactor, workArea }) => ({ id, scaleFactor, workArea })));
    checks.push(`display work areas: ${JSON.stringify(displays)}`);
    const work = displays[displays.length - 1].workArea;
    await app.evaluate(({ BrowserWindow }, area) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating'));
      window.setBounds({ x: area.x + 2, y: area.y + 100, width: window.getBounds().width, height: window.getBounds().height });
    }, work);
    await floating.evaluate(() => { window.desktop.drag(true, 0, 0); window.desktop.drag(false); });
    await floating.waitForFunction(() => document.querySelector('.floating')?.classList.contains('docked'));
    const dockBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(dockBounds.x, work.x); assert.equal(dockBounds.width, 64); checks.push('dock aligns with target display work area');
    await floating.screenshot({ path: path.join(output, 'dock-left.png') });
    const firstDockedName = await floating.locator('.dock-name').textContent();
    await floating.waitForTimeout(4300);
    const secondDockedName = await floating.locator('.dock-name').textContent();
    assert.notEqual(secondDockedName, firstDockedName); checks.push('docked account rotates on schedule');
    await settings.getByRole('tab', { name: '连接' }).click();
    await settings.getByLabel('服务器地址').fill(`http://127.0.0.1:${fixture.address().port}`);
    await settings.getByLabel('邮箱').fill('admin@example.com');
    await settings.getByLabel('密码').fill('fixture-password');
    await settings.getByRole('button', { name: '登录', exact: true }).click();
    await settings.locator('.connection-status', { hasText: '需要双重验证' }).waitFor();
    await settings.getByLabel('双重验证码').fill('123456');
    await settings.getByRole('button', { name: '验证' }).click();
    await settings.locator('.connection-status', { hasText: '已登录 · 管理员' }).waitFor();
    let live;
    for (let attempt = 0; attempt < 50; attempt++) {
      live = await floating.evaluate(() => window.desktop.getState());
      if (live.quotas.length === 2 && live.quotas.every(quota => quota.five && quota.seven)) break;
      await floating.waitForTimeout(100);
    }
    checks.push(`live login snapshot: ${JSON.stringify({ connection: live.connection, selectedIds: live.settings.selectedIds, available: live.available.length, quotas: live.quotas.length, error: live.error, requests })}`);
    assert.equal(live.quotas.length, 2);
    assert.equal(live.quotas[0].five.used, 41);
    assert.ok(requests.some(request => request.includes('source=passive&force=false')));
    assert.ok(requests.some(request => request.includes('source=active&force=false')));
    checks.push('0.2.8 email/password, 2FA, admin, accounts and quota flow');
    const session = fs.readFileSync(path.join(data, 'session.dpapi'));
    assert.ok(!session.toString('utf8').includes('private-refresh-token'));
    checks.push('refresh token stored encrypted by Windows safeStorage');
    await settings.screenshot({ path: path.join(output, 'settings-connected.png') });
    await activeApp.close(); activeApp = null;
    activeApp = await _electron.launch({ executablePath,
      args: process.env.QUOTA_EXECUTABLE ? [] : [root], env: { ...process.env, QUOTA_DATA_DIR: data } });
    const restoredFloat = await activeApp.firstWindow();
    let restored;
    for (let attempt = 0; attempt < 50; attempt++) {
      restored = await restoredFloat.evaluate(() => window.desktop.getState());
      if (restored.connection.status === 'connected' && restored.quotas.every(quota => quota.five)) break;
      await restoredFloat.waitForTimeout(100);
    }
    assert.equal(restored.connection.status, 'connected');
    assert.equal(restored.quotas.length, 2);
    assert.equal(restored.settings.aliases['1'], '主力账号');
    assert.equal(restored.settings.nameWidth, 80);
    assert.equal(restored.settings.fontName, 'arial.ttf');
    assert.ok(requests.includes('/api/v1/auth/refresh'));
    checks.push('encrypted session and style settings restore after restart');
    await restoredFloat.screenshot({ path: path.join(output, 'restored-floating.png') });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: String(error) }, null, 2));
    throw error;
  } finally { if (activeApp) await activeApp.close(); await new Promise(resolve => fixture.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
