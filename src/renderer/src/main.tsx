import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Eye, EyeOff, LogOut, RefreshCw, Settings2, Upload, X } from 'lucide-react';
import { alias, color, defaults, ink, metric, migrateLegacyPalette, needsLightInk, outlineInk, percent, resetCountdown, shortName, summaryPeriods, supportsFive, visiblePeriods,
  type DesktopAPI, type Period, type Quota, type QuotaWindow, type Settings, type Snapshot } from '../../shared/model';
import { detailHeight, size } from '../../shared/geometry';
import './style.css';

const view = new URLSearchParams(location.search).get('view') || 'floating';
const preview = !window.desktop;
if (preview) document.body.classList.add('browser-preview');
const demoState: Snapshot = { settings: defaults, connection: { status: 'demo', server: '', email: '', message: '演示数据' },
  available: [], quotas: [], busy: false, lastRefresh: null, nextRefresh: null, error: null,
  edge: null, collapsed: false, rotatingIndex: 0, rotatingPeriod: 'five', visible: true };
function browserPreview(): DesktopAPI {
  const now = Date.now();
  const quotas: Quota[] = [
    { id: 1, name: '示例 C1', platform: 'anthropic', type: 'oauth', status: 'active', planType: 'plus', subscriptionExpiresAt: now + 1209600000, concurrency: 10, currentConcurrency: 1, resetCredits: null,
      five: { used: 32, resetsAt: now + 8280000 }, seven: { used: 58, resetsAt: now + 280800000 } },
    { id: 2, name: '示例 O2', platform: 'openai', type: 'oauth', status: 'active', planType: 'pro_5x', subscriptionExpiresAt: now + 1814400000, concurrency: 5, currentConcurrency: 2,
      resetCredits: { available: 2, nearestExpiresAt: now + 259200000 }, five: { used: 19, resetsAt: now + 14700000 }, seven: { used: 84, resetsAt: now + 129600000 } }
  ].map(value => ({ ...value, source: 'demo', updatedAt: now, fetchedAt: now, error: null, resetCreditsError: null }));
  let settings: Settings;
  try {
    const saved = JSON.parse(localStorage.getItem('quota-preview-settings') || '{}');
    settings = { ...defaults, ...saved, summary: ['worst', 'both'].includes(saved.summary) ? 'rotate' : saved.summary ?? defaults.summary,
      showResetExpiry: saved.showResetExpiry ?? saved.showResetTime ?? defaults.showResetExpiry };
    if (!localStorage.getItem('quota-preview-palette-v2')) {
      settings = migrateLegacyPalette(settings);
      localStorage.setItem('quota-preview-settings', JSON.stringify(settings));
      localStorage.setItem('quota-preview-palette-v2', '1');
    }
  }
  catch { settings = defaults; }
  let state: Snapshot = { ...demoState, settings, available: quotas, quotas: quotas.filter(item => settings.selectedIds.includes(item.id)), lastRefresh: now };
  const listeners = new Set<(value: Snapshot) => void>();
  const publish = () => { state = { ...state }; listeners.forEach(listener => listener(state)); };
  return {
    getState: async () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    updateSettings: async patch => { settings = { ...settings, ...patch }; localStorage.setItem('quota-preview-settings', JSON.stringify(settings));
      state = { ...state, settings, quotas: quotas.filter(item => settings.selectedIds.includes(item.id)) }; publish(); return { ok: true, value: undefined }; },
    login: async () => ({ ok: false, error: '请在桌面客户端登录服务器' }), verify: async () => ({ ok: false, error: '请在桌面客户端验证' }),
    logout: async () => ({ ok: true, value: undefined }), refresh: async () => { state = { ...state, lastRefresh: Date.now() }; publish(); return { ok: true, value: undefined }; },
    setAccountStatus: async () => ({ ok: false, error: '演示数据不可修改' }),
    importFont: async () => ({ ok: false, error: '请在桌面客户端导入字体' }), removeFont: async () => ({ ok: true, value: undefined }),
    drag: () => {}, dragMove: () => {}, hover: () => {},
    openContextMenu: () => { location.search = '?view=menu'; },
    menuAction: action => { if (action === 'settings') location.search = '?view=settings';
      if (action === 'refresh') { state = { ...state, lastRefresh: Date.now() }; publish(); } },
    dismissMenu: () => { location.search = '?view=floating'; },
    closeSettings: () => { location.search = '?view=floating'; }
  };
}
if (!window.desktop) window.desktop = browserPreview();
const platform = (value: string) => value === 'anthropic' ? 'Claude' : value === 'openai' ? 'OpenAI' : value;
const time = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
const supportsResetCards = (account: Quota) => account.platform === 'openai' && account.type === 'oauth';
const showResetExpiry = (account: Quota) => supportsResetCards(account) && account.resetCredits?.available !== 0;
const resetCountText = (account: Quota) => !supportsResetCards(account) || account.resetCredits?.available === 0
  ? '无重置卡' : account.resetCredits ? `${account.resetCredits.available} 次` : '--';
const subscription = (value?: string) => {
  if (!value) return '--';
  const plan = value.trim().toLowerCase().replace(/_/g, ' ');
  return plan.replace(/\b(plus|pro|max|free|team|business|enterprise|ultra)\b/g, name => name[0].toUpperCase() + name.slice(1));
};
function Meter({ quota, settings, label, period, countdown }: { quota: QuotaWindow | null; settings: Settings; label: string; period?: Period; countdown?: string }) {
  const value = quota ? Math.max(0, Math.min(100, metric(quota.used, settings))) : 0;
  const fill = quota ? color(quota.used, settings) : '#aeb8b3';
  const textColor = quota ? ink(fill) : undefined;
  const text = percent(quota, settings);
  return <div className={`meter ${settings.textOutline ? 'outlined' : ''} ${period ? 'meter-tagged' : ''}`}
    style={{ '--meter-outline': settings.textOutline && textColor ? outlineInk(textColor) : undefined,
      '--countdown-size': `${settings.countdownFontSize}px` } as React.CSSProperties}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={quota ? value : undefined} aria-valuetext={quota ? text : '暂无数据'} title={`${label} · ${text}`}>
    <span className="meter-value" style={{ color: quota && !needsLightInk(fill) ? textColor : undefined }}>{text}</span>
    {quota && <><span className="meter-fill" style={{ width: `${value}%`, backgroundColor: fill }}/>
      <span className="meter-value meter-foreground" style={{ color: textColor, clipPath: `inset(0 ${100 - value}% 0 0)` }}>{text}</span></>}
    {period && <span className={`meter-tag ${period}`} aria-hidden="true">{period === 'five' ? '5h' : '7d'}</span>}
    {countdown !== undefined && <span className="meter-countdown" aria-label={`距离重置 ${countdown}`}>{countdown}</span>}
  </div>;
}
function ConcurrencyCard({ account, settings }: { account: Quota; settings: Settings }) {
  if (!settings.showConcurrency) return null;
  const value = `${account.currentConcurrency ?? '--'}/${account.concurrency ?? '--'}`;
  const usage = account.currentConcurrency ?? 0;
  const status = account.concurrency && usage >= account.concurrency ? 'full' : usage > 0 ? 'in-use' : 'idle';
  return <span className={`concurrency-card ${status}`} style={{ width: settings.concurrencyWidth }} title={`当前并发 / 上限 ${value}`} aria-label={`并发 ${value}`}>{value}</span>;
}
function useSnapshot() {
  const [state, setState] = useState<Snapshot>(demoState);
  useEffect(() => {
    let active = true;
    window.desktop.getState().then(value => { if (active && value) setState(value); });
    const unsubscribe = window.desktop.subscribe(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    const settings = state.settings;
    document.documentElement.style.setProperty('--floating-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--floating-weight', settings.fontBold ? '600' : '400');
  }, [state.settings.fontSize, state.settings.fontBold]);
  useEffect(() => {
    const settings = state.settings;
    if (!settings.fontName) { document.documentElement.style.setProperty('--ui-font', '"Segoe UI", "Microsoft YaHei", sans-serif'); return; }
    let cancelled = false;
    const face = new FontFace('Quota Custom', `url("quota-font://local/custom.ttf?v=${Date.now()}")`);
    face.load().then(loaded => { if (!cancelled) { document.fonts.add(loaded); document.documentElement.style.setProperty('--ui-font', '"Quota Custom", "Segoe UI", sans-serif'); } })
      .catch(() => { if (!cancelled) document.documentElement.style.setProperty('--ui-font', '"Segoe UI", sans-serif'); });
    return () => { cancelled = true; };
  }, [state.settings.fontName]);
  return state;
}
function Floating({ state, ghost = false }: { state: Snapshot; ghost?: boolean }) {
  const settings = state.settings, active = state.quotas[state.rotatingIndex % Math.max(1, state.quotas.length)];
  const dockPeriods = active ? summaryPeriods(active, settings, state.rotatingPeriod) : [];
  const pressed = useRef(false);
  function down(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    pressed.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    window.desktop.drag(true, event.screenX, event.screenY);
    event.preventDefault();
  }
  function up(event: React.PointerEvent<HTMLDivElement>) {
    if (!pressed.current) return;
    pressed.current = false;
    window.desktop.drag(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const collapsed = state.collapsed && !!state.edge;
  return <div className={`floating ${collapsed ? `docked ${state.edge}` : ''} ${ghost ? 'snap-ghost' : ''}`} style={{ '--bar-width': `${settings.barWidth}px`,
    ...(preview ? size(settings, state.quotas, state.edge, collapsed, state.rotatingIndex, state.rotatingPeriod) : {}) } as React.CSSProperties} onPointerDown={ghost ? undefined : down} onPointerMove={ghost ? undefined : event => { if (pressed.current) window.desktop.dragMove(event.screenX, event.screenY); }} onPointerUp={ghost ? undefined : up} onLostPointerCapture={ghost ? undefined : () => { if (pressed.current) { pressed.current = false; window.desktop.drag(false); } }}
    onPointerEnter={ghost ? undefined : () => window.desktop.hover('floating', true)} onPointerLeave={ghost ? undefined : () => window.desktop.hover('floating', false)}
    onContextMenu={ghost ? undefined : event => { event.preventDefault(); window.desktop.openContextMenu(event.screenX, event.screenY); }}>
    {collapsed && active ? <div className={`dock-content ${state.edge === 'left' || state.edge === 'right' ? 'vertical' : 'horizontal'}`}>
      <span className="dock-name" title={alias(active, settings)}>{shortName(active, settings, state.rotatingIndex)}</span>
      <div className="dock-bars">{dockPeriods.length ? dockPeriods.map(period => <Meter key={period} quota={active[period]} settings={settings} period={period}
        label={`${alias(active, settings)} · ${period === 'five' ? '5 小时' : '7 天'}`} />) : <span className="dock-empty">--</span>}
        <ConcurrencyCard account={active} settings={settings}/></div>
    </div> : <div className="floating-rows">
      {state.quotas.length ? state.quotas.map(account => <div className="floating-row" key={account.id}>
        <span className="account-name" title={account.name + (settings.aliases[String(account.id)] ? ` · 别名 ${alias(account, settings)}` : '') + (account.error ? ` · ${account.error}` : '')}
          style={{ width: settings.nameWidth }}>{alias(account, settings)}</span>
        {visiblePeriods(account, settings).map(period => <Meter key={period} quota={account[period]} settings={settings} period={period}
          label={`${alias(account, settings)} · ${period === 'five' ? '5 小时' : '7 天'}`} />)}
        <ConcurrencyCard account={account} settings={settings}/>
      </div>) : <div className="floating-empty">{state.connection.status === 'authenticating' ? '连接中…' : '未登录'}</div>}
    </div>}
  </div>;
}
function Detail({ state }: { state: Snapshot }) {
  const [now, setNow] = useState(Date.now());
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [statusError, setStatusError] = useState<{ id: number; message: string } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function toggleStatus(id: number, status: 'active' | 'inactive') {
    setUpdatingId(id); setStatusError(null);
    const result = await window.desktop.setAccountStatus(id, status);
    if (!result.ok) setStatusError({ id, message: result.error });
    setUpdatingId(null);
  }
  return <div className="detail shell" style={{ '--detail-height': `${detailHeight(state.quotas, state.settings)}px` } as React.CSSProperties}
    onPointerEnter={() => window.desktop.hover('detail', true)} onPointerLeave={() => window.desktop.hover('detail', false)}>
    <header className="detail-head"><strong>额度明细</strong><div className="icon-actions">
      <button title="刷新额度" aria-label="刷新额度" onClick={() => void window.desktop.refresh()} disabled={state.busy}><RefreshCw size={15}/></button>
    </div></header>
    <main className="detail-list">{state.quotas.length ? state.quotas.map(account => <section className="detail-account" key={account.id}>
      <div className="detail-title"><strong title={account.name}>{alias(account, state.settings)}</strong>
        {state.settings.showStatusToggle && state.connection.status === 'connected' && ['active', 'inactive'].includes(account.status)
          ? <button className="status-switch" role="switch" aria-label={`${alias(account, state.settings)}账号状态`} aria-checked={account.status === 'active'}
            title={account.status === 'active' ? '停用账号' : '启用账号'} disabled={updatingId !== null}
            onClick={() => void toggleStatus(account.id, account.status === 'active' ? 'inactive' : 'active')}>
            <span className="switch-track"><span className="switch-thumb"/></span><span>{account.status === 'active' ? '可用' : '停用'}</span>
          </button> : <span>{account.error ? '缓存' : account.status === 'active' ? '可用' : account.status}</span>}</div>
      <div className="detail-sub">{platform(account.platform)} · {account.type} · <span className="subscription-plan">订阅 {subscription(account.planType)} · 到期 {time(account.subscriptionExpiresAt ?? null)}</span></div>
      <div className="detail-progress"><div className={`detail-windows ${supportsFive(account) ? '' : 'single'}`}>{(supportsFive(account) ? ['five', 'seven'] as Period[] : ['seven'] as Period[]).map(period => <div key={period}>
        <Meter quota={account[period]} settings={state.settings} period={period} countdown={resetCountdown(account[period]?.resetsAt ?? null, now)}
          label={`${alias(account, state.settings)} · ${period === 'five' ? '5 小时' : '7 天'} · ${account[period]?.resetsAt ? `重置于 ${time(account[period]!.resetsAt)}` : '重置时间未知'}`}/>
      </div>)}</div><ConcurrencyCard account={account} settings={state.settings}/></div>
      {(state.settings.showResetCount || state.settings.showResetExpiry && showResetExpiry(account)) && <div className="detail-credits">
        {state.settings.showResetCount && <div className="reset-count" title="当前可用的额度重置次数"><span>重置次数</span><strong>{resetCountText(account)}</strong></div>}
        {state.settings.showResetExpiry && showResetExpiry(account) &&
          <div className="reset-expiry"><span>最近重置卡到期</span><time>{time(account.resetCredits?.nearestExpiresAt ?? null)}</time></div>}
        {account.resetCreditsError && <div className="error">重置次数更新失败：{account.resetCreditsError}</div>}
      </div>}
      {statusError?.id === account.id && <div className="error status-error">{statusError.message}</div>}
      {account.error && <div className="error">{account.error}</div>}
    </section>) : <div className="empty-note">{state.connection.message}</div>}</main>
    <footer className="detail-foot"><span>刷新于 {time(state.lastRefresh)}</span><span>{state.busy ? '刷新中' : state.connection.status === 'demo' ? '演示数据' : state.error ? '部分数据未更新' : state.connection.message}</span></footer>
  </div>;
}
function Menu({ state }: { state: Snapshot }) {
  return <div className="menu shell" role="menu">
    <button role="menuitem" onClick={() => window.desktop.menuAction('refresh')}><RefreshCw size={15}/>刷新额度</button>
    <button role="menuitemcheckbox" aria-checked={state.visible} onClick={() => window.desktop.menuAction('visibility')}>
      {state.visible ? <Eye size={15}/> : <EyeOff size={15} />}{state.visible ? '隐藏浮球' : '显示浮球'}</button>
    <div className="menu-line"/>
    <button role="menuitem" onClick={() => window.desktop.menuAction('settings')}><Settings2 size={15}/>设置</button>
    <button role="menuitem" onClick={() => window.desktop.menuAction('quit')}><LogOut size={15}/>退出</button>
  </div>;
}
function MenuBackdrop() {
  return <div className="menu-backdrop" onPointerDown={() => window.desktop.dismissMenu()}/>;
}

type Tab = 'display' | 'refresh' | 'style' | 'connection' | 'accounts';
function Settings({ state }: { state: Snapshot }) {
  const [tab, setTab] = useState<Tab>('display');
  const [opacityDraft, setOpacityDraft] = useState(state.settings.inactiveOpacity);
  useEffect(() => { setOpacityDraft(state.settings.inactiveOpacity); }, [state.settings.inactiveOpacity]);
  const [server, setServer] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { if (state.connection.server && !server) setServer(state.connection.server); if (state.connection.email && !email) setEmail(state.connection.email); }, [state.connection.server, state.connection.email]);
  async function update(patch: Partial<Settings>) { const result = await window.desktop.updateSettings(patch); setMessage(result.ok ? '' : result.error); return result.ok; }
  function checkbox(label: string, key: keyof Settings) {
    return <label className="setting-row"><span>{label}</span><input key={`${key}-${state.settings[key]}`} type="checkbox" defaultChecked={Boolean(state.settings[key])}
      onChange={event => { const target = event.currentTarget, checked = target.checked; void update({ [key]: checked }).then(ok => { if (!ok) target.checked = !checked; }); }}/></label>;
  }
  function number(label: string, key: 'barWidth' | 'nameWidth' | 'topWidth' | 'sideWidth' | 'concurrencyWidth' | 'refreshSeconds' | 'rotateSeconds' | 'fontSize' | 'countdownFontSize', min: number, max: number | undefined, unit: string) {
    return <label className="setting-row"><span>{label}</span><div className="number-field"><input key={`${key}-${state.settings[key]}`} type="number" min={min} max={max} defaultValue={state.settings[key]}
      onChange={event => { event.currentTarget.dataset.dirty = 'true'; }}
      onBlur={event => { if (event.currentTarget.dataset.dirty !== 'true') return; delete event.currentTarget.dataset.dirty;
        const value = Number(event.target.value); if (Number.isInteger(value) && value >= min && (max === undefined || value <= max)) void update({ [key]: value }); else { event.target.value = String(state.settings[key]); setMessage(`${label}范围：${min}${max === undefined ? ' 以上' : `–${max}`}`); } }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/><span>{unit}</span></div></label>;
  }
  function choice(label: string, value: string, options: [string, string][], key: keyof Settings) {
    return <label className="setting-row"><span>{label}</span><select key={`${key}-${value}`} defaultValue={value} onChange={event => void update({ [key]: event.target.value })}>
      {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setMessage('');
    const result = await window.desktop.login({ server, email, password }); setPassword('');
    if (!result.ok) setMessage(result.error);
  }
  const tabs: [Tab, string][] = [['display', '显示'], ['refresh', '刷新'], ['style', '样式'], ['connection', '连接'], ['accounts', '账号']];
  const paletteSamples = state.settings.metric === 'used'
    ? ([['normalColor', '正常 <75%', 50], ['warningColor', '注意 75%–89%', 80], ['criticalColor', '接近耗尽 ≥90%', 95]] as const)
    : ([['normalColor', '正常 >50%', 25], ['warningColor', '注意 21%–50%', 65], ['criticalColor', '接近耗尽 ≤20%', 85]] as const);
  return <div className="settings shell">
    <header className="settings-head"><span>设置</span><button title="关闭设置" aria-label="关闭设置" onClick={() => window.desktop.closeSettings()}><X size={16}/></button></header>
    <nav className="tabs" role="tablist">{tabs.map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{name}</button>)}</nav>
    <div className="settings-pane">
      {tab === 'display' && <>
        {choice('百分比含义', state.settings.metric, [['used', '已用'], ['remaining', '剩余']], 'metric')}
        {checkbox('显示 5 小时额度', 'showFive')}
        {checkbox('显示 7 天额度', 'showSeven')}
        {checkbox('显示重置次数', 'showResetCount')}
        {checkbox('显示最近重置卡到期', 'showResetExpiry')}
        {checkbox('启用账号状态开关', 'showStatusToggle')}
        {checkbox('显示并发数量', 'showConcurrency')}
        {checkbox('贴边自动收起', 'autoCollapse')}
        {choice('贴边切换', state.settings.summary, [['five', '仅 5h'], ['seven', '仅 7d'], ['rotate', '5h / 7d 轮播']], 'summary')}
        {checkbox('失焦时半透明', 'fadeInactive')}
        <label className="setting-row"><span>失焦不透明度</span><div className="slider-field"><input type="range" min="20" max="100" value={opacityDraft} disabled={!state.settings.fadeInactive}
          onChange={event => setOpacityDraft(Number(event.target.value))}
          onPointerUp={event => { const value = Number(event.currentTarget.value); if (value !== state.settings.inactiveOpacity) void update({ inactiveOpacity: value }); }}
          onKeyUp={event => { const value = Number(event.currentTarget.value); if (value !== state.settings.inactiveOpacity) void update({ inactiveOpacity: value }); }}
          onBlur={event => { const value = Number(event.currentTarget.value); if (value !== state.settings.inactiveOpacity) void update({ inactiveOpacity: value }); }}/><b>{opacityDraft}%</b></div></label>
      </>}
      {tab === 'refresh' && <>
        {checkbox('自动刷新', 'autoRefresh')}
        {number('数据刷新间隔', 'refreshSeconds', 5, 3600, '秒')}
        {number('账号轮播间隔', 'rotateSeconds', 2, 60, '秒')}
        <div className="setting-row subdued"><span>最近刷新</span><span>{time(state.lastRefresh)}</span></div>
        <div className="setting-row subdued"><span>下次刷新</span><span>{state.nextRefresh ? time(state.nextRefresh) : '已暂停'}</span></div>
        <div className="actions"><button onClick={() => void window.desktop.refresh()} disabled={state.busy}><RefreshCw size={15}/>立即刷新</button></div>
      </>}
      {tab === 'style' && <>
        <div className="style-group-label">尺寸</div>
        {number('进度条宽度', 'barWidth', 1, undefined, 'px')}
        {number('名称宽度', 'nameWidth', 1, undefined, 'px')}
        {number('顶部 / 底部宽度', 'topWidth', 1, undefined, 'px')}
        {number('两侧贴边宽度', 'sideWidth', 1, undefined, 'px')}
        {number('并发卡片宽度', 'concurrencyWidth', 1, undefined, 'px')}
        {number('重置倒计时字号', 'countdownFontSize', 1, undefined, 'px')}
        <div className="style-group-label">进度状态色</div>
        {paletteSamples.map(([key, name, sample]) => <div className="color-row" key={key}>
          <span>{name}</span><input type="color" aria-label={name + '颜色'} value={state.settings[key]} onChange={event => void update({ [key]: event.target.value })}/>
          <code>{state.settings[key]}</code><div className="preview"><Meter quota={{ used: sample, resetsAt: null }} settings={state.settings} label={name + '预览'}/></div>
        </div>)}
        <div className="style-group-label font-label">文字</div>
        {number('界面字号', 'fontSize', 10, 20, 'px')}
        {checkbox('文字加粗', 'fontBold')}
        {checkbox('进度条文字描边', 'textOutline')}
        <div className="setting-row"><span>自定义 TTF 字体</span><div className="font-actions"><button onClick={async () => { const result = await window.desktop.importFont(); if (!result.ok && result.error !== '已取消导入') setMessage(result.error); }} title="导入 TTF 字体"><Upload size={14}/>导入</button>
          <button onClick={async () => { const result = await window.desktop.removeFont(); if (!result.ok) setMessage(result.error); }} title="恢复系统字体" disabled={!state.settings.fontName}><X size={14}/></button></div></div>
        <div className="font-current" title={state.settings.fontName}>{state.settings.fontName || 'Segoe UI / 系统字体'}</div>
        <div className="font-preview">Claude1&nbsp; 32% · Codex2&nbsp; 84%</div>
      </>}
      {tab === 'connection' && <>
        <div className={`connection-status ${state.connection.status === 'error' || state.connection.status === 'expired' ? 'error' : ''}`}>{state.connection.message}</div>
        <form onSubmit={login} className="login-form">
          <label>服务器地址<input type="url" value={server} onChange={event => setServer(event.target.value)} required placeholder="https://sub2api.example.com" autoComplete="url"/></label>
          <div className="login-grid"><label>邮箱<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="username"/></label>
            <label>密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password"/></label></div>
          {state.connection.status === 'twoFactor' && <label>双重验证码<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={event => setOtp(event.target.value)} autoComplete="one-time-code"/></label>}
          {checkbox('记住登录', 'rememberSession')}
          <div className="actions"><button type="button" onClick={() => void window.desktop.logout()} disabled={state.connection.status === 'disconnected'}><LogOut size={14}/>退出登录</button>
            {state.connection.status === 'twoFactor' ? <button type="button" className="primary" onClick={async () => { const result = await window.desktop.verify(otp); if (!result.ok) setMessage(result.error); else setOtp(''); }}>验证</button>
              : <button type="submit" className="primary" disabled={state.connection.status === 'authenticating'}>登录</button>}</div>
        </form>
        {checkbox('演示数据', 'demo')}
      </>}
      {tab === 'accounts' && <div className="account-list">{state.available.length ? state.available.map(account => <div className="account-setting" key={account.id}>
        <label className="account-select"><input type="checkbox" checked={state.settings.selectedIds.includes(account.id)} onChange={event => void update({ selectedIds: event.target.checked
          ? [...state.settings.selectedIds, account.id] : state.settings.selectedIds.filter(id => id !== account.id) })}/>
          <span><strong title={account.name}>{account.name}</strong><small>{platform(account.platform)} · {account.type}{account.planType ? ` · ${account.planType}` : ''} · {account.status}</small></span></label>
        <label className="alias-field">别名<input type="text" maxLength={40} key={`${account.id}-${state.settings.aliases[String(account.id)] ?? ''}`}
          defaultValue={state.settings.aliases[String(account.id)] ?? ''} placeholder="浮球显示名称"
          onBlur={event => void update({ aliases: { ...state.settings.aliases, [String(account.id)]: event.target.value.trim() } })}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>
      </div>) : <div className="empty-note">登录后可选择上游账号并设置别名</div>}</div>}
    </div>
    <footer className="settings-foot"><span className={message ? 'error' : ''}>{message || (state.connection.status === 'demo' ? '演示数据' : state.connection.message)}</span><span>已选 {state.quotas.length} 个账号</span></footer>
  </div>;
}

function App() {
  const state = useSnapshot();
  return view === 'floating' || view === 'snap-preview' ? <Floating state={state} ghost={view === 'snap-preview'}/> : view === 'detail' ? <Detail state={state}/>
    : view === 'menu' ? <Menu state={state}/> : view === 'menu-backdrop' ? <MenuBackdrop/> : <Settings state={state}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
