import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, Eye, EyeOff, LogOut, Pin, RefreshCw, Settings2, Upload, X } from 'lucide-react';
import { alias, color, defaults, ink, metric, migrateLegacyPalette, needsLightInk, percent, shortName, summaryPeriods,
  type DesktopAPI, type Period, type Quota, type QuotaWindow, type Settings, type Snapshot } from '../../shared/model';
import { size } from '../../shared/geometry';
import './style.css';

const view = new URLSearchParams(location.search).get('view') || 'floating';
const preview = !window.desktop;
if (preview) document.body.classList.add('browser-preview');
const demoState: Snapshot = { settings: defaults, connection: { status: 'demo', server: '', email: '', message: '演示数据' },
  available: [], quotas: [], busy: false, lastRefresh: null, nextRefresh: null, error: null,
  edge: null, collapsed: false, rotatingIndex: 0, visible: true, detailPinned: false };
function browserPreview(): DesktopAPI {
  const now = Date.now();
  const quotas: Quota[] = [
    { id: 1, name: '示例 C1', platform: 'anthropic', type: 'oauth', status: 'active', five: { used: 32, resetsAt: now + 8280000 }, seven: { used: 58, resetsAt: now + 280800000 } },
    { id: 2, name: '示例 O2', platform: 'openai', type: 'oauth', status: 'active', five: { used: 19, resetsAt: now + 14700000 }, seven: { used: 84, resetsAt: now + 129600000 } }
  ].map(value => ({ ...value, source: 'demo', updatedAt: now, fetchedAt: now, error: null }));
  let settings: Settings;
  try {
    settings = { ...defaults, ...JSON.parse(localStorage.getItem('quota-preview-settings') || '{}') };
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
    importFont: async () => ({ ok: false, error: '请在桌面客户端导入字体' }), removeFont: async () => ({ ok: true, value: undefined }),
    drag: () => {}, dragMove: () => {}, hover: () => {}, pinDetail: () => {}, closeDetail: () => {},
    openContextMenu: () => { location.search = '?view=menu'; },
    menuAction: action => { if (action === 'settings') location.search = '?view=settings';
      if (action === 'refresh') { state = { ...state, lastRefresh: Date.now() }; publish(); } },
    menuHover: () => {},
    closeSettings: () => { location.search = '?view=floating'; }
  };
}
if (!window.desktop) window.desktop = browserPreview();
const platform = (value: string) => value === 'anthropic' ? 'Claude' : value === 'openai' ? 'OpenAI' : value;
const time = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
const reset = (value: number | null) => {
  if (!value) return '重置时间未知';
  const delta = Math.max(0, value - Date.now()), hours = Math.floor(delta / 3600000), minutes = Math.floor(delta / 60000) % 60;
  return hours >= 24 ? `${Math.floor(hours / 24)}天${hours % 24}小时后重置` : `${hours}小时${minutes}分后重置`;
};
function Meter({ quota, settings, label }: { quota: QuotaWindow | null; settings: Settings; label: string }) {
  const value = quota ? Math.max(0, Math.min(100, metric(quota.used, settings))) : 0;
  const fill = quota ? color(quota.used, settings) : '#aeb8b3';
  const textColor = quota ? ink(fill) : undefined;
  const text = percent(quota, settings);
  return <div className="meter" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={quota ? value : undefined} aria-valuetext={quota ? text : '暂无数据'} title={`${label} · ${text}`}>
    <span className="meter-value" style={{ color: quota && !needsLightInk(fill) ? textColor : undefined }}>{text}</span>
    {quota && <><span className="meter-fill" style={{ width: `${value}%`, backgroundColor: fill }}/>
      <span className="meter-value meter-foreground" style={{ color: textColor, clipPath: `inset(0 ${100 - value}% 0 0)` }}>{text}</span></>}
  </div>;
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
    ...(preview ? size(settings, state.quotas, state.edge, collapsed) : {}) } as React.CSSProperties} onPointerDown={ghost ? undefined : down} onPointerMove={ghost ? undefined : event => { if (pressed.current) window.desktop.dragMove(event.screenX, event.screenY); }} onPointerUp={ghost ? undefined : up} onLostPointerCapture={ghost ? undefined : () => { if (pressed.current) { pressed.current = false; window.desktop.drag(false); } }}
    onPointerEnter={ghost ? undefined : () => window.desktop.hover('floating', true)} onPointerLeave={ghost ? undefined : () => window.desktop.hover('floating', false)}
    onContextMenu={ghost ? undefined : event => { event.preventDefault(); window.desktop.openContextMenu(event.screenX, event.screenY); }}>
    {collapsed && active ? <div className={`dock-content ${state.edge === 'left' || state.edge === 'right' ? 'vertical' : 'horizontal'}`}>
      <span className="dock-name" title={alias(active, settings)}>{shortName(active, settings, state.rotatingIndex)}</span>
      <div className="dock-bars">{summaryPeriods(active, settings).map(period => <Meter key={period} quota={active[period]} settings={settings}
        label={`${alias(active, settings)} · ${period === 'five' ? '5 小时' : '7 天'}`} />)}</div>
    </div> : <div className="floating-rows">
      {state.quotas.length ? state.quotas.map(account => <div className="floating-row" key={account.id}>
        <span className="account-name" title={account.name + (settings.aliases[String(account.id)] ? ` · 别名 ${alias(account, settings)}` : '') + (account.error ? ` · ${account.error}` : '')}
          style={{ width: settings.nameWidth }}>{alias(account, settings)}</span>
        {settings.showFive && <Meter quota={account.five} settings={settings} label={`${alias(account, settings)} · 5 小时`} />}
        <Meter quota={account.seven} settings={settings} label={`${alias(account, settings)} · 7 天`} />
      </div>) : <div className="floating-empty">{state.connection.status === 'authenticating' ? '连接中…' : '未登录'}</div>}
    </div>}
  </div>;
}
function Detail({ state }: { state: Snapshot }) {
  return <div className="detail shell" onPointerEnter={() => window.desktop.hover('detail', true)} onPointerLeave={() => window.desktop.hover('detail', false)}>
    <header className="detail-head"><strong>额度明细</strong><div className="icon-actions">
      <button title="刷新额度" aria-label="刷新额度" onClick={() => void window.desktop.refresh()} disabled={state.busy}><RefreshCw size={15}/></button>
      <button title={state.detailPinned ? '取消固定' : '固定明细'} aria-label={state.detailPinned ? '取消固定' : '固定明细'} aria-pressed={state.detailPinned}
        className={state.detailPinned ? 'active' : ''} onClick={() => window.desktop.pinDetail()}><Pin size={15}/></button>
      <button title="关闭明细" aria-label="关闭明细" onClick={() => window.desktop.closeDetail()}><X size={15}/></button>
    </div></header>
    <main className="detail-list">{state.quotas.length ? state.quotas.map(account => <section className="detail-account" key={account.id}>
      <div className="detail-title"><strong title={account.name}>{alias(account, state.settings)}</strong><span>{account.error ? '缓存' : account.status === 'active' ? '可用' : account.status}</span></div>
      <div className="detail-sub">{platform(account.platform)} · {account.type} · {account.source === 'passive' ? '被动采样' : account.source === 'active' ? '服务端查询' : account.source === 'demo' ? '演示数据' : '服务端快照'}</div>
      <div className="detail-windows">{(['five', 'seven'] as Period[]).map(period => <div key={period}>
        <div className="window-label">{period === 'five' ? '5 小时' : '7 天'} · {state.settings.metric === 'used' ? '已用' : '剩余'}</div>
        <Meter quota={account[period]} settings={state.settings} label={`${alias(account, state.settings)} · ${period === 'five' ? '5 小时' : '7 天'}`}/>
        <div className="reset" title={account[period]?.resetsAt ? time(account[period]!.resetsAt) : '未知'}>{reset(account[period]?.resetsAt ?? null)}</div>
      </div>)}</div>
      <div className="detail-times">源数据 {time(account.updatedAt)}<br/>本次读取 {time(account.fetchedAt)}</div>
      {account.error && <div className="error">{account.error}</div>}
    </section>) : <div className="empty-note">{state.connection.message}</div>}</main>
    <footer className="detail-foot"><span>刷新于 {time(state.lastRefresh)}</span><span>{state.busy ? '刷新中' : state.connection.status === 'demo' ? '演示数据' : state.error ? '部分数据未更新' : state.connection.message}</span></footer>
  </div>;
}
function Menu({ state }: { state: Snapshot }) {
  return <div className="menu shell" role="menu" onPointerEnter={() => window.desktop.menuHover(true)} onPointerLeave={() => window.desktop.menuHover(false)}>
    <button role="menuitem" onClick={() => window.desktop.menuAction('refresh')}><RefreshCw size={15}/>刷新额度</button>
    <button role="menuitemcheckbox" aria-checked={state.visible} onClick={() => window.desktop.menuAction('visibility')}>
      {state.visible ? <Eye size={15}/> : <EyeOff size={15} />}{state.visible ? '隐藏浮球' : '显示浮球'}</button>
    <div className="menu-line"/>
    <button role="menuitem" onClick={() => window.desktop.menuAction('settings')}><Settings2 size={15}/>设置</button>
    <button role="menuitem" onClick={() => window.desktop.menuAction('quit')}><LogOut size={15}/>退出</button>
  </div>;
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
  function number(label: string, key: 'barWidth' | 'nameWidth' | 'topWidth' | 'sideWidth' | 'refreshSeconds' | 'rotateSeconds' | 'fontSize', min: number, max: number, unit: string) {
    return <label className="setting-row"><span>{label}</span><div className="number-field"><input key={`${key}-${state.settings[key]}`} type="number" min={min} max={max} defaultValue={state.settings[key]}
      onBlur={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= min && value <= max) void update({ [key]: value }); else { event.target.value = String(state.settings[key]); setMessage(`${label}范围：${min}–${max}`); } }}
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
        {checkbox('贴边自动收起', 'autoCollapse')}
        {number('进度条宽度', 'barWidth', 40, 240, 'px')}
        {number('名称宽度', 'nameWidth', 36, 200, 'px')}
        {number('顶部 / 底部宽度', 'topWidth', 120, 400, 'px')}
        {number('两侧贴边宽度', 'sideWidth', 48, 240, 'px')}
        {choice('贴边摘要', state.settings.summary, [['worst', '最紧张的窗口'], ['both', '5 小时 + 7 天'], ['five', '5 小时'], ['seven', '7 天']], 'summary')}
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
        <div className="style-group-label">进度状态色</div>
        {paletteSamples.map(([key, name, sample]) => <div className="color-row" key={key}>
          <span>{name}</span><input type="color" aria-label={name + '颜色'} value={state.settings[key]} onChange={event => void update({ [key]: event.target.value })}/>
          <code>{state.settings[key]}</code><div className="preview"><Meter quota={{ used: sample, resetsAt: null }} settings={state.settings} label={name + '预览'}/></div>
        </div>)}
        <div className="style-group-label font-label">文字</div>
        {number('界面字号', 'fontSize', 10, 20, 'px')}
        {checkbox('文字加粗', 'fontBold')}
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
          <span><strong title={account.name}>{account.name}</strong><small>{platform(account.platform)} · {account.type} · {account.status}</small></span></label>
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
    : view === 'menu' ? <Menu state={state}/> : <Settings state={state}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
