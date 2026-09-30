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
  const widthTrace = [];
  const requests = [];
  let resetCount = 2, resetExpiry = new Date(Date.now() + 3 * 86400000).toISOString(), subscriptionExpiry = '2026-10-01T00:00:00Z';
  let claudeConcurrency = 1, openaiConcurrency = 2;
  let accountStatus = 'active', rejectStatus = false;
  const statusEdits = [];
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
      { id: 1, name: 'Real Claude', platform: 'anthropic', type: 'oauth', status: 'active', concurrency: 10, current_concurrency: claudeConcurrency, credentials: { plan_type: 'plus' } },
      { id: 2, name: 'Real OpenAI', platform: 'openai', type: 'oauth', status: accountStatus, concurrency: 5, current_concurrency: openaiConcurrency, credentials: { plan_type: 'pro_5x', subscription_expires_at: subscriptionExpiry } } ], total: 2 };
    else if (request.url === '/api/v1/admin/accounts/2' && request.method === 'PUT') {
      assert.deepEqual(parsed, { status: accountStatus === 'active' ? 'inactive' : 'active' });
      if (rejectStatus) { response.writeHead(500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 500, message: '拒绝切换' })); return; }
      accountStatus = parsed.status; statusEdits.push(parsed); data = { status: accountStatus };
    }
    else if (request.url?.includes('/usage?')) data = { source: 'passive', updated_at: '2026-09-28T10:00:00Z',
      five_hour: { utilization: 41, remaining_seconds: 180 }, seven_day: { utilization: 72, remaining_seconds: 86400 } };
    else if (request.url === '/api/v1/admin/openai/accounts/2/quota') data = { rate_limit_reset_credits: { available_count: resetCount,
      credits: resetCount ? [{ expires_at: resetExpiry }] : [] } };
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
    await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('view=floating'));
      const work = screen.getPrimaryDisplay().workArea;
      window.setPosition(work.x + 240, work.y + 180);
    });
    const state = await floating.evaluate(() => window.desktop.getState());
    assert.equal(state.quotas.length, 2); checks.push('two demo accounts');
    assert.equal(state.settings.autoStart, true);
    assert.equal(state.settings.topWidth, 160);
    assert.equal(state.settings.concurrencyWidth, 36);
    assert.deepEqual(await floating.locator('.floating-row').first().locator('.meter-tag').allTextContents(), ['5h', '7d']);
    assert.deepEqual(await floating.locator('.floating-row').last().locator('.meter-tag').allTextContents(), ['7d']);
    checks.push('5h and 7d tags match visible Plus and Pro windows');
    assert.deepEqual([state.settings.normalColor, state.settings.warningColor, state.settings.criticalColor], ['#22c55e', '#f59e0b', '#ef4444']);
    const warningFill = floating.locator('.floating-row').nth(1).locator('.meter').last().locator('.meter-fill');
    assert.equal(await warningFill.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(245, 158, 11)');
    const warningText = await floating.locator('.floating-row').nth(1).locator('.meter').last().locator('.meter-foreground').evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, stroke: style.webkitTextStrokeColor, width: style.webkitTextStrokeWidth };
    });
    assert.notEqual(warningText.color, 'rgb(0, 0, 0)');
    assert.equal(warningText.width, '0px');
    checks.push('sub2api default colors render without optional text outline');
    let bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 224); assert.equal(bounds.height, 64); checks.push('compact 224x64 size');
    await floating.screenshot({ path: path.join(output, 'floating.png') });
    const cursorBefore = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    await floating.mouse.move(20, 20);
    const cursorAfter = await app.evaluate(({ screen }) => screen.getCursorScreenPoint());
    checks.push(`mouse cursor sampling: ${JSON.stringify({ cursorBefore, cursorAfter })}`);
    await floating.mouse.move(108, 12);
    await floating.mouse.down();
    await floating.waitForTimeout(50);
    await floating.mouse.move(150, 22, { steps: 5 });
    await floating.waitForTimeout(160);
    await floating.mouse.up();
    const dragged = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.notEqual(dragged.x, bounds.x); checks.push('progress bar is draggable');
    bounds = dragged;
    await floating.evaluate(() => { window.desktop.hover('floating', true); window.desktop.hover('floating', false); });
    await floating.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().includes('view=detail') && w.isVisible())), false);
    checks.push('brief hover does not open detail after pointer leaves');
    await floating.mouse.move(24, 10);
    await floating.mouse.down();
    await floating.waitForTimeout(50);
    await floating.mouse.move(53, 17, { steps: 5 });
    await floating.waitForTimeout(100);
    await floating.mouse.up();
    const nameDragged = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.notEqual(nameDragged.x, bounds.x); checks.push('account name is draggable');
    const detailWindow = app.waitForEvent('window', { predicate: window => window.url().includes('view=detail'), timeout: 5000 });
    await floating.evaluate(() => window.desktop.hover('floating', true));
    const detail = await detailWindow;
    await detail.waitForSelector('.detail-account');
    assert.equal(await detail.locator('.detail-account').count(), 2); checks.push('hover detail shows both accounts');
    await detail.screenshot({ path: path.join(output, 'detail.png') });
    assert.equal(await detail.locator('.icon-actions button').count(), 1);
    assert.equal(await detail.getByRole('button', { name: '关闭明细' }).count(), 0);
    assert.equal(await detail.locator('.detail-times').count(), 0);
    assert.ok(!(await detail.locator('.detail').textContent()).includes('服务端快照'));
    assert.ok((await detail.locator('.subscription-plan').first().textContent()).includes('订阅 Plus · 到期'));
    assert.ok((await detail.locator('.subscription-plan').last().textContent()).includes('订阅 Pro 5x · 到期'));
    assert.equal(await detail.locator('.subscription-expiry, .window-label, .reset').count(), 0);
    assert.deepEqual(await detail.locator('.reset-count strong').allTextContents(), ['无重置卡', '2 次']);
    assert.equal(await detail.locator('.reset-expiry').count(), 1);
    assert.ok((await detail.locator('.meter-countdown').allTextContents()).every(value => /^\d+d(?:\d+h)?$|^\d+h(?:\d+m)?$/.test(value)));
    checks.push('details combine subscription data, corner reset badges and available reset cards');
    await detail.evaluate(() => window.desktop.hover('detail', true));
    await floating.evaluate(() => window.desktop.hover('floating', false));
    await floating.waitForTimeout(400);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), true);
    checks.push('detail stays visible while pointer is over it');
    await detail.evaluate(() => window.desktop.hover('detail', false));
    await floating.waitForTimeout(400);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), false);
    checks.push('detail closes after pointer leaves both windows');
    const originalBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    await app.evaluate(({ BrowserWindow, screen }) => {
      const ball = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating'));
      const work = screen.getDisplayNearestPoint(ball.getBounds()).workArea;
      ball.setPosition(work.x + work.width - ball.getBounds().width - 40, work.y + work.height - ball.getBounds().height - 40);
    });
    await floating.evaluate(() => window.desktop.hover('floating', true));
    await floating.waitForTimeout(300);
    const cornerBounds = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return { ball: windows.find(w => w.webContents.getURL().includes('view=floating')).getBounds(),
        detail: windows.find(w => w.webContents.getURL().includes('view=detail')).getBounds() };
    });
    const overlapWidth = Math.max(0, Math.min(cornerBounds.ball.x + cornerBounds.ball.width, cornerBounds.detail.x + cornerBounds.detail.width) - Math.max(cornerBounds.ball.x, cornerBounds.detail.x));
    const overlapHeight = Math.max(0, Math.min(cornerBounds.ball.y + cornerBounds.ball.height, cornerBounds.detail.y + cornerBounds.detail.height) - Math.max(cornerBounds.ball.y, cornerBounds.detail.y));
    assert.equal(overlapWidth * overlapHeight, 0);
    await detail.screenshot({ path: path.join(output, 'detail-bottom-right.png') });
    await floating.evaluate(() => window.desktop.hover('floating', false));
    await floating.waitForTimeout(400);
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).setBounds(bounds), originalBounds);
    await floating.evaluate(() => window.desktop.hover('floating', false));
    await floating.waitForTimeout(220);
    checks.push('detail does not cover the ball at the bottom-right corner');
    await floating.evaluate(() => { window.desktop.hover('floating', false); window.desktop.hover('detail', false); });
    await floating.waitForTimeout(220);
    const idleOpacity = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getOpacity());
    assert.ok(Math.abs(idleOpacity - .65) < .03); checks.push('idle window opacity 65 percent');
    await floating.evaluate(() => window.desktop.hover('floating', true));
    await floating.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), true);
    const menuWindow = app.waitForEvent('window', { predicate: window => window.url().includes('view=menu'), timeout: 5000 });
    await floating.mouse.click(18, 16, { button: 'right' });
    const menu = await menuWindow;
    await menu.waitForSelector('.menu');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), false);
    checks.push('floating context menu immediately closes quota details');
    assert.equal(await menu.locator('.menu button').count(), 4); checks.push('custom floating context menu');
    assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=menu')).getBounds())).height, 151);
    const settingsWindow = app.waitForEvent('window', { predicate: window => window.url().includes('view=settings'), timeout: 5000 });
    await menu.getByRole('menuitem', { name: '设置' }).click();
    const settings = await settingsWindow;
    await settings.waitForSelector('.settings');
    const switchFor = label => settings.getByText(label, { exact: true }).locator('..').locator('.el-switch');
    const isSwitchOn = async label => (await switchFor(label).locator('input').getAttribute('aria-checked')) === 'true';
    const setSwitch = async (label, enabled) => { if (await isSwitchOn(label) !== enabled) await switchFor(label).click(); };
    const choose = async (label, option) => {
      await settings.getByText(label, { exact: true }).locator('..').locator('.el-select').click();
      await settings.locator('.el-select-dropdown__item', { hasText: option }).click();
    };
    assert.equal(await settings.getByRole('tab').count(), 5); checks.push('custom frameless settings with five tabs');
    await settings.screenshot({ path: path.join(output, 'settings-display.png') });
    await settings.getByRole('tab', { name: '刷新' }).click();
    assert.equal(await isSwitchOn('开机自启动'), true);
    await setSwitch('开机自启动', false);
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.autoStart === false);
    checks.push('startup switch defaults on and can be disabled');
    await settings.getByRole('tab', { name: '样式' }).click();
    const barWidthInput = settings.getByText('进度条宽度').locator('..').locator('input');
    await barWidthInput.fill('40');
    await barWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.barWidth === 40);
    const narrowLabels = await floating.locator('.floating-row').first().locator('.meter').evaluateAll(meters => meters.map(meter => {
      const tag = meter.querySelector('.meter-tag').getBoundingClientRect();
      const text = document.createRange();
      text.selectNodeContents(meter.querySelector('.meter-value'));
      return { tagRight: tag.right, textLeft: text.getBoundingClientRect().left };
    }));
    assert.ok(narrowLabels.every(value => value.tagRight <= value.textLeft), `narrow bar labels overlap: ${JSON.stringify(narrowLabels)}`);
    await floating.screenshot({ path: path.join(output, 'floating-narrow-bars.png') });
    await barWidthInput.fill('68');
    await barWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.barWidth === 68);
    const sideWidthInput = settings.getByText('两侧贴边宽度').locator('..').locator('input');
    await sideWidthInput.fill('1'); await sideWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.sideWidth === 1);
    await sideWidthInput.fill('64'); await sideWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.sideWidth === 64);
    widthTrace.push(['side 64', (await floating.evaluate(() => window.desktop.getState())).settings.sideWidth]);
    await settings.waitForFunction(() => document.querySelector('.settings-pane')?.textContent?.includes('并发卡片宽度'));
    const concurrencyWidthInput = settings.getByText('并发卡片宽度').locator('..').locator('input');
    await concurrencyWidthInput.fill('24'); await concurrencyWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.concurrencyWidth === 24);
    widthTrace.push(['card 24', (await floating.evaluate(() => window.desktop.getState())).settings.sideWidth]);
    await concurrencyWidthInput.fill('36'); await concurrencyWidthInput.press('Enter');
    await floating.waitForFunction(async () => (await window.desktop.getState()).settings.concurrencyWidth === 36);
    widthTrace.push(['card 36', (await floating.evaluate(() => window.desktop.getState())).settings.sideWidth]);
    checks.push('style widths accept values down to 1px and narrow bar labels stay separate');
    await settings.getByRole('tab', { name: '显示' }).click();
    const opacitySlider = settings.getByRole('slider', { name: '失焦不透明度' });
    await opacitySlider.scrollIntoViewIfNeeded();
    const sliderBox = await opacitySlider.boundingBox();
    await settings.mouse.move(sliderBox.x + sliderBox.width * .2, sliderBox.y + sliderBox.height / 2);
    await settings.mouse.down();
    await settings.mouse.move(sliderBox.x + sliderBox.width * .85, sliderBox.y + sliderBox.height / 2, { steps: 6 });
    const draggedOpacity = Number(await opacitySlider.getAttribute('aria-valuenow'));
    assert.ok(draggedOpacity >= 75, `slider stopped during drag at ${draggedOpacity}`);
    await settings.mouse.up();
    await settings.waitForFunction(async value => (await window.desktop.getState()).settings.inactiveOpacity === value, draggedOpacity);
    checks.push('inactive opacity slider follows a continuous drag and saves on release');
    await settings.getByRole('tab', { name: '样式' }).click();
    await settings.screenshot({ path: path.join(output, 'settings-style.png') });
    assert.equal(await settings.locator('.color-row .el-color-picker').count(), 3); checks.push('three live color previews');
    await setSwitch('进度条文字描边', true);
    await floating.waitForFunction(() => getComputedStyle(document.querySelector('.meter-foreground')).webkitTextStrokeWidth === '0.5px');
    await settings.waitForFunction(() => getComputedStyle(document.querySelector('.preview .meter-foreground')).webkitTextStrokeWidth === '0.5px');
    assert.equal(await settings.locator('.preview .meter-foreground').first().evaluate(element => getComputedStyle(element).webkitTextStrokeWidth), '0.5px');
    await floating.screenshot({ path: path.join(output, 'floating-outlined.png') });
    await setSwitch('进度条文字描边', false);
    await floating.waitForFunction(() => getComputedStyle(document.querySelector('.meter-foreground')).webkitTextStrokeWidth === '0px');
    checks.push('optional text outline is off by default and updates floating bars and previews');
    await settings.locator('.color-row .el-color-picker').nth(1).click();
    await settings.screenshot({ path: path.join(output, 'settings-color-open.png') });
    await settings.locator('.el-color-picker-panel__footer input:visible').fill('#e29b19');
    await settings.locator('.el-color-picker-panel__footer input:visible').press('Enter');
    await settings.locator('.el-color-picker-panel__footer .el-button:visible').last().click();
    await settings.waitForFunction(() => document.querySelectorAll('.color-row')[1]?.querySelector('code')?.textContent === '#e29b19');
    assert.equal((await floating.evaluate(() => window.desktop.getState())).settings.warningColor, '#e29b19');
    const meterCount = await floating.locator('.floating-row .meter').count();
    assert.ok(meterCount >= 2, `floating meters disappeared: ${JSON.stringify({ meterCount, state: await floating.evaluate(() => window.desktop.getState()), markup: await floating.locator('#root').innerHTML() })}`);
    assert.equal(await warningFill.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(226, 155, 25)');
    checks.push('custom warning color propagates to floating UI');
    await settings.getByRole('tab', { name: '显示' }).click();
    await choose('百分比含义', '剩余');
    await floating.waitForFunction(() => document.querySelector('.floating-row:nth-child(2) .meter:last-child .meter-value')?.textContent === '16%');
    assert.equal(await warningFill.evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(239, 68, 68)');
    await settings.getByRole('tab', { name: '样式' }).click();
    assert.equal(await settings.getByLabel('接近耗尽 ≤20%颜色').count(), 1);
    checks.push('remaining mode uses 50/20 thresholds in floating bar and style preview');
    await settings.getByRole('tab', { name: '显示' }).click();
    await choose('百分比含义', '已用');
    await setSwitch('显示 7 天额度', false);
    await floating.waitForFunction(() => document.querySelectorAll('.floating-row:first-child .meter').length === 1 && document.querySelectorAll('.floating-row:last-child .meter').length === 0);
    assert.equal((await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds())).width, 150);
    await setSwitch('显示 7 天额度', true);
    await floating.waitForFunction(() => document.querySelectorAll('.floating-row:first-child .meter').length === 2 && document.querySelectorAll('.floating-row:last-child .meter').length === 1);
    checks.push('seven-day switch hides bars and resizes the floating window');
    await settings.getByRole('tab', { name: '样式' }).click();
    const font = 'C:\\Windows\\Fonts\\arial.ttf';
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, font);
    await settings.getByTitle('导入 TTF 字体').click();
    await settings.waitForFunction(() => document.querySelector('.font-current')?.textContent === 'arial.ttf');
    await settings.waitForFunction(() => document.fonts.check('12px "Quota Custom"'));
    assert.ok(fs.existsSync(path.join(data, 'custom.ttf'))); checks.push('TTF copied to user data and loaded into UI');
    await settings.screenshot({ path: path.join(output, 'settings-custom-font.png') });
    await settings.getByRole('tab', { name: '账号' }).click();
    await settings.screenshot({ path: path.join(output, 'settings-accounts.png') });
    const accountSwitchBounds = await settings.locator('.account-select .el-switch__core').first().boundingBox();
    assert.ok(accountSwitchBounds.width >= 32 && accountSwitchBounds.height >= 18,
      `account switch is compressed: ${JSON.stringify(accountSwitchBounds)}`);
    checks.push('account selection switches retain their full size');
    const alias = settings.getByPlaceholder('浮球显示名称').first();
    await alias.fill('主力账号'); await alias.blur();
    await floating.waitForFunction(() => document.querySelector('.account-name')?.textContent === '主力账号');
    checks.push('alias updates floating row');
    await settings.getByRole('tab', { name: '样式' }).click();
    const nameWidth = settings.getByText('名称宽度').locator('..').locator('input');
    await nameWidth.fill('80'); await nameWidth.blur();
    await floating.waitForFunction(() => document.querySelector('.account-name')?.getBoundingClientRect().width === 80);
    bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 242); checks.push('name width resizes whole floating window');
    await settings.getByRole('tab', { name: '显示' }).click();
    await setSwitch('显示 5 小时额度', false);
    await floating.waitForFunction(() => document.querySelectorAll('.floating-row .meter').length === 2);
    bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(bounds.width, 168); checks.push('seven-day-only window shrinks with custom name width');
    await floating.screenshot({ path: path.join(output, 'seven-day-only.png') });
    await setSwitch('显示 5 小时额度', true);
    await settings.getByRole('tab', { name: '样式' }).click();
    await setSwitch('文字加粗', true);
    const fontSize = settings.getByText('界面字号').locator('..').locator('input');
    await fontSize.fill('16'); await fontSize.blur();
    await floating.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--floating-size').trim() === '16px');
    const weight = await floating.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-weight').trim());
    assert.equal(weight, '400');
    const floatingTypography = await floating.evaluate(() => ({ size: getComputedStyle(document.querySelector('.floating')).fontSize,
      weight: getComputedStyle(document.querySelector('.floating')).fontWeight }));
    const settingsTypography = await settings.evaluate(() => ({ size: getComputedStyle(document.querySelector('.settings')).fontSize,
      weight: getComputedStyle(document.querySelector('.settings')).fontWeight,
      previewSize: getComputedStyle(document.querySelector('.preview')).fontSize,
      previewWeight: getComputedStyle(document.querySelector('.preview')).fontWeight }));
    assert.deepEqual(floatingTypography, { size: '16px', weight: '600' });
    assert.deepEqual(settingsTypography, { size: '12px', weight: '400', previewSize: '16px', previewWeight: '600' });
    checks.push('font size and weight affect floating UI and preview without resizing settings');
    const countdownSize = settings.getByText('重置倒计时字号').locator('..').locator('input');
    await countdownSize.fill('11'); await countdownSize.press('Enter');
    await settings.waitForFunction(async () => (await window.desktop.getState()).settings.countdownFontSize === 11);
    await settings.getByRole('tab', { name: '显示' }).click();
    await choose('贴边切换', '仅 5h');
    const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().map(({ id, scaleFactor, workArea }) => ({ id, scaleFactor, workArea })));
    checks.push(`display work areas: ${JSON.stringify(displays)}`);
    const work = displays[displays.length - 1].workArea;
    const sideWidthBeforeDock = (await floating.evaluate(() => window.desktop.getState())).settings.sideWidth;
    widthTrace.push(['before dock', sideWidthBeforeDock]);
    assert.equal(sideWidthBeforeDock, 64, JSON.stringify(widthTrace));
    await app.evaluate(({ BrowserWindow }, area) => {
      const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating'));
      window.setBounds({ x: area.x + 80, y: area.y + 100, width: window.getBounds().width, height: window.getBounds().height });
    }, work);
    await floating.evaluate(() => window.desktop.drag(true, 100, 10));
    await floating.evaluate(() => window.desktop.dragMove(-40, 10));
    let snapPreview;
    for (let attempt = 0; attempt < 20; attempt++) {
      snapPreview = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=snap-preview'));
        return window ? { visible: window.isVisible(), bounds: window.getBounds() } : null;
      });
      if (snapPreview?.visible && snapPreview.bounds.width === 64) break;
      await floating.waitForTimeout(50);
    }
    assert.equal(snapPreview?.visible, true);
    assert.equal(snapPreview.bounds.x, work.x);
    assert.equal(snapPreview.bounds.width, 64);
    assert.equal(await floating.locator('.floating').evaluate(element => element.classList.contains('docked')), false);
    const ghostPage = app.windows().find(window => window.url().includes('view=snap-preview'));
    await ghostPage.waitForSelector('.snap-ghost.docked.left');
    await ghostPage.screenshot({ path: path.join(output, 'snap-preview.png') });
    checks.push('live snap preview shows the final docked shape without taking drag input');
    await floating.evaluate(() => window.desktop.drag(false));
    await floating.waitForFunction(() => document.querySelector('.floating')?.classList.contains('docked'));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=snap-preview')).isVisible()), false);
    const dockBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=floating')).getBounds());
    assert.equal(dockBounds.x, work.x); assert.equal(dockBounds.width, 64); checks.push('dock aligns with target display work area');
    await floating.screenshot({ path: path.join(output, 'dock-left.png') });
    await floating.evaluate(() => window.desktop.hover('floating', false));
    const firstDockedName = await floating.locator('.dock-name').textContent();
    await floating.waitForFunction(name => document.querySelector('.dock-name')?.textContent !== name, firstDockedName, { timeout: 10000 });
    assert.deepEqual(await floating.locator('.dock-bars .meter-tag').allTextContents(), ['7d']);
    await choose('贴边切换', '5h / 7d 轮播');
    await floating.waitForFunction(async () => (await window.desktop.getState()).rotatingPeriod === 'seven', null, { timeout: 10000 });
    checks.push('docked account rotates on schedule');
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
    assert.equal(live.quotas[0].planType, 'plus');
    assert.equal(live.quotas[1].planType, 'pro_5x');
    assert.deepEqual([live.quotas[0].currentConcurrency, live.quotas[0].concurrency], [1, 10]);
    assert.deepEqual([live.quotas[1].currentConcurrency, live.quotas[1].concurrency], [2, 5]);
    assert.deepEqual(live.quotas[1].resetCredits, { available: 2, nearestExpiresAt: Date.parse(resetExpiry) });
    assert.equal(live.quotas[1].subscriptionExpiresAt, Date.parse(subscriptionExpiry));
    await settings.getByRole('tab', { name: '显示' }).click();
    await floating.evaluate(() => window.desktop.hover('floating', true));
    await floating.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('view=detail')).isVisible()), true);
    await detail.waitForSelector('.detail-account');
    await detail.evaluate(() => window.desktop.hover('detail', true));
    await floating.evaluate(() => window.desktop.hover('floating', false));
    await detail.locator('.reset-count strong', { hasText: '2 次' }).waitFor();
    assert.equal(await detail.locator('.concurrency-card').count(), 0);
    assert.equal(await isSwitchOn('显示并发数量'), false);
    await setSwitch('显示并发数量', true);
    await detail.waitForFunction(() => document.querySelectorAll('.concurrency-card').length === 2);
    assert.deepEqual(await detail.locator('.concurrency-card').allTextContents(), ['1/10', '2/5']);
    assert.deepEqual(await detail.locator('.concurrency-card').evaluateAll(elements => elements.map(element => ({
      background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color
    }))), [{ background: 'rgb(254, 249, 195)', color: 'rgb(161, 98, 7)' }, { background: 'rgb(254, 249, 195)', color: 'rgb(161, 98, 7)' }]);
    assert.equal((await detail.locator('.concurrency-card').first().boundingBox()).width, 36);
    assert.equal(await detail.locator('.meter .concurrency-card').count(), 0);
    assert.equal(await floating.locator('.dock-bars > .concurrency-card').count(), 1);
    claudeConcurrency = 0; openaiConcurrency = 5;
    await floating.evaluate(() => window.desktop.refresh());
    await detail.waitForFunction(() => [...document.querySelectorAll('.concurrency-card')].map(element => element.textContent).join(',') === '0/10,5/5');
    assert.deepEqual(await detail.locator('.concurrency-card').evaluateAll(elements => elements.map(element => ({
      background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color
    }))), [{ background: 'rgb(243, 244, 246)', color: 'rgb(75, 85, 99)' }, { background: 'rgb(254, 226, 226)', color: 'rgb(185, 28, 28)' }]);
    claudeConcurrency = 1; openaiConcurrency = 2;
    await floating.evaluate(() => window.desktop.refresh());
    await detail.waitForFunction(() => [...document.querySelectorAll('.concurrency-card')].map(element => element.textContent).join(',') === '1/10,2/5');
    assert.equal(await detail.locator('.meter-countdown').first().evaluate(element => getComputedStyle(element).fontSize), '11px');
    checks.push('account concurrency appears once per account and uses sub2api idle, in-use and full colors');
    const secondsBefore = await detail.locator('.meter-countdown').first().textContent();
    await detail.waitForFunction(before => document.querySelector('.meter-countdown')?.textContent !== before, secondsBefore, { timeout: 3000 });
    assert.match(await detail.locator('.meter-countdown').first().textContent(), /^\d+m$/);
    checks.push('detail reset badge omits seconds while one minute or more remains');
    assert.equal(await isSwitchOn('启用账号状态开关'), false);
    assert.equal(await detail.locator('.status-switch').count(), 0);
    assert.equal(await detail.locator('.detail-title').last().locator('span').last().textContent(), '可用');
    await setSwitch('启用账号状态开关', true);
    const accountSwitch = detail.locator('.status-switch').nth(1);
    assert.equal(await accountSwitch.locator('input').getAttribute('aria-checked'), 'true');
    await accountSwitch.click();
    await detail.waitForFunction(() => document.querySelectorAll('.status-switch input')[1]?.getAttribute('aria-checked') === 'false');
    assert.equal((await floating.evaluate(() => window.desktop.getState())).quotas[1].status, 'inactive');
    rejectStatus = true;
    await accountSwitch.click();
    await detail.locator('.status-error', { hasText: '拒绝切换' }).waitFor();
    assert.equal(await accountSwitch.locator('input').getAttribute('aria-checked'), 'false');
    rejectStatus = false;
    await accountSwitch.click();
    await detail.waitForFunction(() => document.querySelectorAll('.status-switch input')[1]?.getAttribute('aria-checked') === 'true');
    assert.deepEqual(statusEdits, [{ status: 'inactive' }, { status: 'active' }]);
    await setSwitch('启用账号状态开关', false);
    await detail.waitForFunction(() => document.querySelectorAll('.status-switch').length === 0);
    assert.equal(await detail.locator('.detail-title').last().locator('span').last().textContent(), '可用');
    checks.push('status toggle is opt-in, updates the server when enabled and retains prior state on failure');
    await setSwitch('显示重置次数', false);
    await detail.waitForFunction(() => document.querySelectorAll('.reset-count').length === 0 && document.querySelectorAll('.reset-expiry').length === 1);
    assert.equal(await detail.locator('.detail-credits').count(), 1);
    await setSwitch('显示最近重置卡到期', false);
    await detail.waitForFunction(() => !document.querySelector('.detail-credits'));
    await detail.screenshot({ path: path.join(output, 'detail-without-reset-credits.png') });
    await setSwitch('显示重置次数', true);
    await detail.waitForFunction(() => document.querySelectorAll('.reset-count').length === 2 && document.querySelectorAll('.reset-expiry').length === 0);
    await setSwitch('显示最近重置卡到期', true);
    await detail.waitForFunction(() => document.querySelectorAll('.reset-expiry').length === 1);
    checks.push('reset count and nearest card expiry switches independently control detail fields');
    resetCount = 1; resetExpiry = new Date(Date.now() + 4 * 86400000).toISOString(); subscriptionExpiry = '2026-10-02T00:00:00Z';
    await floating.evaluate(() => window.desktop.refresh());
    await detail.locator('.reset-count strong', { hasText: '1 次' }).waitFor();
    const refreshed = await floating.evaluate(() => window.desktop.getState());
    assert.deepEqual(refreshed.quotas[1].resetCredits, { available: 1, nearestExpiresAt: Date.parse(resetExpiry) });
    assert.equal(refreshed.quotas[1].subscriptionExpiresAt, Date.parse(subscriptionExpiry));
    assert.ok((await detail.locator('.subscription-plan').last().textContent()).includes('2026/10/2'));
    assert.equal(await detail.locator('.reset-expiry time').textContent(), new Date(resetExpiry).toLocaleString('zh-CN', { hour12: false }));
    const detailLayout = await detail.locator('.detail-list').evaluate(element => ({ scroll: element.scrollHeight, visible: element.clientHeight }));
    assert.ok(detailLayout.scroll <= detailLayout.visible, `two-account detail fields are clipped: ${JSON.stringify(detailLayout)}`);
    await detail.screenshot({ path: path.join(output, 'detail-live.png') });
    await settings.screenshot({ path: path.join(output, 'settings-reset-credits.png') });
    await setSwitch('显示最近重置卡到期', false);
    resetCount = 0;
    await floating.evaluate(() => window.desktop.refresh());
    await detail.locator('.reset-count strong', { hasText: '无重置卡' }).last().waitFor();
    assert.equal(await detail.locator('.reset-expiry').count(), 0);
    checks.push('zero reset cards show no-card state without an expiry row');
    await detail.evaluate(() => window.desktop.hover('detail', false));
    await floating.waitForTimeout(400);
    await setSwitch('贴边自动收起', false);
    await floating.waitForSelector('.floating-row');
    assert.deepEqual(await floating.locator('.floating-row .concurrency-card').allTextContents(), ['1/10', '2/5']);
    assert.equal(await floating.locator('.floating-row .meter .concurrency-card').count(), 0);
    assert.deepEqual(await floating.locator('.floating-row').last().locator('.meter-tag').allTextContents(), ['7d']);
    await setSwitch('贴边自动收起', true);
    await floating.waitForSelector('.docked');
    await settings.getByRole('tab', { name: '连接' }).click();
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
    assert.equal(restored.settings.autoStart, false);
    assert.equal(restored.settings.nameWidth, 80);
    assert.equal(restored.settings.fontName, 'arial.ttf');
    assert.equal(restored.settings.showResetCount, true);
    assert.equal(restored.settings.showResetExpiry, false);
    assert.equal(restored.settings.showStatusToggle, false);
    assert.equal(restored.settings.showConcurrency, true);
    assert.equal(restored.settings.concurrencyWidth, 36);
    assert.equal(restored.settings.topWidth, 160);
    assert.equal(restored.settings.countdownFontSize, 11);
    assert.ok(requests.includes('/api/v1/auth/refresh'));
    checks.push('encrypted session and style settings restore after restart');
    await restoredFloat.screenshot({ path: path.join(output, 'restored-floating.png') });
    const fakeOverflow = await activeApp.evaluate(({ BrowserWindow, screen }) => {
      const work = screen.getPrimaryDisplay().workArea;
      const panel = new BrowserWindow({ x: work.x + 20, y: work.y + 20, width: 230, height: 230, alwaysOnTop: true });
      panel.loadURL('data:text/html,<body style="background:%23dbe7df">System panel</body>');
      panel.show(); panel.focus();
      return { id: panel.id, x: work.x + 40, y: work.y + 40 };
    });
    const trayMenuWindow = activeApp.waitForEvent('window', { predicate: window => window.url().includes('view=menu'), timeout: 5000 });
    const backdropWindow = activeApp.waitForEvent('window', { predicate: window => window.url().includes('view=menu-backdrop'), timeout: 5000 });
    await restoredFloat.evaluate(({ x, y }) => window.desktop.openContextMenu(x, y, true), fakeOverflow);
    const [trayMenu, backdrop] = await Promise.all([trayMenuWindow, backdropWindow]);
    await trayMenu.waitForSelector('.menu');
    await backdrop.waitForSelector('.menu-backdrop');
    const backdropBounds = await activeApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=menu-backdrop')).getBounds());
    const trayWorkArea = await activeApp.evaluate(({ screen }, point) => screen.getDisplayNearestPoint(point).workArea, fakeOverflow);
    assert.deepEqual(backdropBounds, trayWorkArea);
    const beforeOutsideClick = await activeApp.evaluate(({ BrowserWindow }, id) => ({
      focused: BrowserWindow.getFocusedWindow()?.id, panel: BrowserWindow.fromId(id)?.isVisible(),
      menu: BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=menu'))?.isVisible(),
      backdrop: BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=menu-backdrop'))?.isVisible()
    }), fakeOverflow.id);
    assert.deepEqual(beforeOutsideClick, { focused: fakeOverflow.id, panel: true, menu: true, backdrop: true });
    await backdrop.locator('.menu-backdrop').click({ position: { x: 500, y: 500 } });
    await restoredFloat.waitForTimeout(100);
    const afterOutsideClick = await activeApp.evaluate(({ BrowserWindow }, id) => ({
      focused: BrowserWindow.getFocusedWindow()?.id, panel: BrowserWindow.fromId(id)?.isVisible(),
      menu: BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=menu'))?.isVisible(),
      backdrop: BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('view=menu-backdrop'))?.isVisible()
    }), fakeOverflow.id);
    assert.deepEqual(afterOutsideClick, { focused: fakeOverflow.id, panel: true, menu: false, backdrop: false });
    await activeApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), fakeOverflow.id);
    checks.push('tray menu keeps the system panel focused and outside click closes only our menu first');
    await activeApp.close(); activeApp = null;
    const legacyData = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-legacy-layout-'));
    const legacySettings = { ...state.settings, topWidth: 178, sideWidth: 72 };
    delete legacySettings.concurrencyWidth;
    delete legacySettings.autoStart;
    fs.writeFileSync(path.join(legacyData, 'settings.json'), JSON.stringify({ settings: legacySettings, paletteVersion: 2 }));
    activeApp = await _electron.launch({ executablePath,
      args: process.env.QUOTA_EXECUTABLE ? [] : [root], env: { ...process.env, QUOTA_DATA_DIR: legacyData } });
    const migrated = await (await activeApp.firstWindow()).evaluate(() => window.desktop.getState());
    assert.equal(migrated.settings.topWidth, 160);
    assert.equal(migrated.settings.sideWidth, 72);
    assert.equal(migrated.settings.concurrencyWidth, 36);
    assert.equal(migrated.settings.autoStart, true);
    checks.push('older default top width migrates to 160px while custom side width remains');
    await activeApp.close(); activeApp = null;
    const updateData = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-update-menu-'));
    activeApp = await _electron.launch({ executablePath,
      args: process.env.QUOTA_EXECUTABLE ? [] : [root],
      env: { ...process.env, QUOTA_DATA_DIR: updateData, QUOTA_TEST_UPDATE_VERSION: '9.9.9' } });
    const updateFloat = await activeApp.firstWindow();
    await updateFloat.waitForFunction(async () => (await window.desktop.getState()).update.status === 'available');
    const updateMenuWindow = activeApp.waitForEvent('window', { predicate: window => /[?&]view=menu(?:&|$)/.test(window.url()), timeout: 5000 });
    const updateBackdropWindow = activeApp.waitForEvent('window', { predicate: window => window.url().includes('view=menu-backdrop'), timeout: 5000 });
    await updateFloat.evaluate(() => window.desktop.openContextMenu(500, 300, true));
    const updateMenu = await updateMenuWindow;
    await updateBackdropWindow;
    await updateMenu.getByRole('menuitem', { name: '更新到 v9.9.9' }).waitFor();
    const menuGeometry = await updateMenu.locator('.menu-content').evaluate(element => ({
      height: element.getBoundingClientRect().height,
      firstTop: element.querySelector('button').getBoundingClientRect().top,
      lastBottom: [...element.querySelectorAll('button')].at(-1).getBoundingClientRect().bottom,
      top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom
    }));
    assert.ok(Math.abs((menuGeometry.firstTop - menuGeometry.top) - (menuGeometry.bottom - menuGeometry.lastBottom)) <= 2,
      `menu padding is unbalanced: ${JSON.stringify(menuGeometry)}`);
    assert.equal((await activeApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /[?&]view=menu(?:&|$)/.test(w.webContents.getURL())).getBounds())).height, 183);
    await updateMenu.screenshot({ path: path.join(output, 'menu-with-update.png') });
    await updateMenu.getByRole('menuitem', { name: '更新到 v9.9.9' }).click();
    await updateMenu.locator('.el-popconfirm').waitFor();
    await updateMenu.waitForFunction(() => document.querySelector('.menu')?.classList.contains('expanded'));
    assert.equal((await activeApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => /[?&]view=menu(?:&|$)/.test(w.webContents.getURL())).getBounds())).height, 287);
    await updateMenu.screenshot({ path: path.join(output, 'menu-update-confirm.png') });
    await updateMenu.getByRole('button', { name: '取消' }).click();
    assert.equal((await updateFloat.evaluate(() => window.desktop.getState())).update.status, 'available');
    await updateMenu.getByRole('menuitem', { name: '更新到 v9.9.9' }).click();
    await updateMenu.getByRole('button', { name: '确认' }).click();
    await updateFloat.waitForFunction(async () => (await window.desktop.getState()).update.status === 'downloading');
    await updateFloat.evaluate(() => window.desktop.openContextMenu(500, 300));
    await updateMenu.getByRole('menuitem', { name: '下载更新 0%' }).waitFor();
    assert.equal(await updateMenu.locator('.menu.expanded').count(), 0);
    checks.push('update badge state, balanced menu and Popconfirm gate downloads');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2));
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: String(error) }, null, 2));
    throw error;
  } finally { if (activeApp) await activeApp.close(); await new Promise(resolve => fixture.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
