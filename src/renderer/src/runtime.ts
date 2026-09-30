import { ref, watch } from 'vue';
import { defaults, migrateLegacyPalette, type DesktopAPI, type Quota, type Settings, type Snapshot } from '../../shared/model';

export const view = new URLSearchParams(location.search).get('view') || 'floating';
export const preview = !window.desktop;
if (preview) document.body.classList.add('browser-preview');

const demoState: Snapshot = { settings: defaults, connection: { status: 'demo', server: '', email: '', message: '演示数据' },
  available: [], quotas: [], busy: false, lastRefresh: null, nextRefresh: null, error: null,
  edge: null, collapsed: false, rotatingIndex: 0, rotatingPeriod: 'five', visible: true,
  update: { status: 'idle', version: null, progress: 0, error: null } };

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
  } catch { settings = defaults; }
  let snapshot: Snapshot = { ...demoState, settings, available: quotas, quotas: quotas.filter(item => settings.selectedIds.includes(item.id)), lastRefresh: now };
  const listeners = new Set<(value: Snapshot) => void>();
  const publish = () => { snapshot = { ...snapshot }; listeners.forEach(listener => listener(snapshot)); };
  return {
    getState: async () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    updateSettings: async patch => { settings = { ...settings, ...patch }; localStorage.setItem('quota-preview-settings', JSON.stringify(settings));
      snapshot = { ...snapshot, settings, quotas: quotas.filter(item => settings.selectedIds.includes(item.id)) }; publish(); return { ok: true, value: undefined }; },
    login: async () => ({ ok: false, error: '请在桌面客户端登录服务器' }), verify: async () => ({ ok: false, error: '请在桌面客户端验证' }),
    logout: async () => ({ ok: true, value: undefined }), refresh: async () => { snapshot = { ...snapshot, lastRefresh: Date.now() }; publish(); return { ok: true, value: undefined }; },
    setAccountStatus: async () => ({ ok: false, error: '演示数据不可修改' }),
    setAccountsVisible: () => {}, resetAccountQuota: async () => ({ ok: false, error: '演示数据不可重置' }),
    importFont: async () => ({ ok: false, error: '请在桌面客户端导入字体' }), removeFont: async () => ({ ok: true, value: undefined }),
    drag: () => {}, dragMove: () => {}, hover: () => {},
    menuAction: action => { if (action === 'settings') location.search = '?view=settings';
      if (action === 'refresh') { snapshot = { ...snapshot, lastRefresh: Date.now() }; publish(); } },
    resizeUpdateMenu: () => {},
    menuReady: () => {},
    settingsReady: () => {},
    subscribeMenuReset: () => () => {},
    dismissMenu: () => { location.search = '?view=floating'; },
    closeSettings: () => { location.search = '?view=floating'; }
  };
}

if (!window.desktop) window.desktop = browserPreview();
export const state = ref<Snapshot>(demoState);
window.desktop.subscribe(value => { state.value = value; });
export const stateReady = window.desktop.getState().then(value => { if (value) state.value = value; });

watch(() => [state.value.settings.fontSize, state.value.settings.fontBold], () => {
  document.documentElement.style.setProperty('--floating-size', `${state.value.settings.fontSize}px`);
  document.documentElement.style.setProperty('--floating-weight', state.value.settings.fontBold ? '600' : '400');
}, { immediate: true });
watch(() => state.value.settings.fontName, (fontName, _, onCleanup) => {
  if (!fontName) { document.documentElement.style.setProperty('--ui-font', '"Segoe UI", "Microsoft YaHei", sans-serif'); return; }
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  const face = new FontFace('Quota Custom', `url("quota-font://local/custom.ttf?v=${Date.now()}")`);
  void face.load().then(loaded => { if (!cancelled) { document.fonts.add(loaded); document.documentElement.style.setProperty('--ui-font', '"Quota Custom", "Segoe UI", sans-serif'); } })
    .catch(() => { if (!cancelled) document.documentElement.style.setProperty('--ui-font', '"Segoe UI", sans-serif'); });
}, { immediate: true });

export const platform = (value: string) => value === 'anthropic' ? 'Claude' : value === 'openai' ? 'OpenAI' : value;
export const time = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--';
export const supportsResetCards = (account: Pick<Quota, 'platform' | 'type'>) => account.platform === 'openai' && account.type === 'oauth';
export const showResetExpiry = (account: Quota) => supportsResetCards(account) && account.resetCredits?.available !== 0;
export const resetCountText = (account: Pick<Quota, 'platform' | 'type'> & { resetCredits?: Quota['resetCredits'] }) => !supportsResetCards(account) || account.resetCredits?.available === 0
  ? '无重置卡' : account.resetCredits ? `${account.resetCredits.available} 次` : '--';
export const subscription = (value?: string) => {
  if (!value) return '--';
  const plan = value.trim().toLowerCase().replace(/_/g, ' ');
  return plan.replace(/\b(plus|pro|max|free|team|business|enterprise|ultra)\b/g, name => name[0].toUpperCase() + name.slice(1));
};
