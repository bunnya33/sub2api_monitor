<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElButton, ElColorPicker, ElInput, ElInputNumber, ElOption, ElSelect, ElSlider, ElSwitch } from 'element-plus';
import { Close, Delete, Refresh, Upload } from '@element-plus/icons-vue';
import type { Settings as SettingsData, Snapshot } from '../../shared/model';
import { platform, time } from './runtime';
import Meter from './Meter.vue';

const props = defineProps<{ state: Snapshot }>();
type Tab = 'display' | 'refresh' | 'style' | 'connection' | 'accounts';
type BooleanKey = { [K in keyof SettingsData]: SettingsData[K] extends boolean ? K : never }[keyof SettingsData];
type NumberKey = 'barWidth' | 'nameWidth' | 'topWidth' | 'sideWidth' | 'concurrencyWidth' | 'refreshSeconds' | 'rotateSeconds' | 'fontSize' | 'countdownFontSize';
type ColorKey = 'normalColor' | 'warningColor' | 'criticalColor';
const tabs: { id: Tab; label: string }[] = [
  { id: 'display', label: '显示' }, { id: 'refresh', label: '刷新' }, { id: 'style', label: '样式' },
  { id: 'connection', label: '连接' }, { id: 'accounts', label: '账号' }
];
const displaySwitches: { label: string; key: BooleanKey }[] = [
  { label: '显示 5 小时额度', key: 'showFive' }, { label: '显示 7 天额度', key: 'showSeven' },
  { label: '显示重置次数', key: 'showResetCount' }, { label: '显示最近重置卡到期', key: 'showResetExpiry' },
  { label: '启用账号状态开关', key: 'showStatusToggle' }, { label: '显示并发数量', key: 'showConcurrency' },
  { label: '贴边自动收起', key: 'autoCollapse' }
];
const numberOptions: { label: string; key: NumberKey; min: number; max?: number; unit: string }[] = [
  { label: '进度条宽度', key: 'barWidth', min: 1, unit: 'px' },
  { label: '名称宽度', key: 'nameWidth', min: 1, unit: 'px' },
  { label: '顶部 / 底部宽度', key: 'topWidth', min: 1, unit: 'px' },
  { label: '两侧贴边宽度', key: 'sideWidth', min: 1, unit: 'px' },
  { label: '并发卡片宽度', key: 'concurrencyWidth', min: 1, unit: 'px' },
  { label: '重置倒计时字号', key: 'countdownFontSize', min: 1, unit: 'px' }
];
const tab = ref<Tab>('display');
const opacityDraft = ref(props.state.settings.inactiveOpacity);
const server = ref(''), email = ref(''), password = ref(''), otp = ref('');
const message = ref('');
const aliasDraft = reactive<Record<string, string>>({});
watch(() => props.state.settings.inactiveOpacity, value => { opacityDraft.value = value; });
watch(() => [props.state.connection.server, props.state.connection.email], () => {
  if (props.state.connection.server && !server.value) server.value = props.state.connection.server;
  if (props.state.connection.email && !email.value) email.value = props.state.connection.email;
}, { immediate: true });
watch(() => props.state.available, accounts => {
  for (const account of accounts) {
    const id = String(account.id);
    if (!(id in aliasDraft)) aliasDraft[id] = props.state.settings.aliases[id] ?? '';
  }
}, { immediate: true });
const paletteSamples = computed<{ key: ColorKey; label: string; sample: number }[]>(() => props.state.settings.metric === 'used'
  ? [{ key: 'normalColor', label: '正常 <75%', sample: 50 }, { key: 'warningColor', label: '注意 75%–89%', sample: 80 }, { key: 'criticalColor', label: '接近耗尽 ≥90%', sample: 95 }]
  : [{ key: 'normalColor', label: '正常 >50%', sample: 25 }, { key: 'warningColor', label: '注意 21%–50%', sample: 65 }, { key: 'criticalColor', label: '接近耗尽 ≤20%', sample: 85 }]);

async function update(patch: Partial<SettingsData>): Promise<boolean> {
  const result = await window.desktop.updateSettings(patch);
  message.value = result.ok ? '' : result.error;
  return result.ok;
}
const updateBoolean = (key: BooleanKey, value: boolean) => void update({ [key]: value } as Partial<SettingsData>);
const updateChoice = (key: 'metric' | 'summary', value: string) => void update({ [key]: value } as Partial<SettingsData>);
function updateNumber(key: NumberKey, value: number | undefined): void {
  if (value === undefined || !Number.isInteger(value) || value <= 0) { message.value = '请输入有效的正整数'; return; }
  void update({ [key]: value } as Partial<SettingsData>);
}
function updateColor(key: ColorKey, value: string | null): void {
  if (value) void update({ [key]: value });
}
function setOpacity(value: number | number[]): void {
  if (typeof value === 'number' && value !== props.state.settings.inactiveOpacity) void update({ inactiveOpacity: value });
}
async function login(): Promise<void> {
  message.value = '';
  const result = await window.desktop.login({ server: server.value, email: email.value, password: password.value });
  password.value = '';
  if (!result.ok) message.value = result.error;
}
async function verify(): Promise<void> {
  const result = await window.desktop.verify(otp.value);
  if (!result.ok) message.value = result.error; else otp.value = '';
}
async function importFont(): Promise<void> {
  const result = await window.desktop.importFont();
  if (!result.ok && result.error !== '已取消导入') message.value = result.error;
}
async function removeFont(): Promise<void> {
  const result = await window.desktop.removeFont();
  if (!result.ok) message.value = result.error;
}
function selectAccount(id: number, selected: boolean): void {
  const ids = props.state.settings.selectedIds;
  void update({ selectedIds: selected ? [...ids, id] : ids.filter(value => value !== id) });
}
function saveAlias(id: number): void {
  const key = String(id), value = aliasDraft[key]?.trim() ?? '';
  if (value !== (props.state.settings.aliases[key] ?? '')) void update({ aliases: { ...props.state.settings.aliases, [key]: value } });
}
function blurOnEnter(event: Event): void { (event.target as HTMLElement).blur(); }
const close = () => window.desktop.closeSettings();
const refresh = () => void window.desktop.refresh();
const logout = () => void window.desktop.logout();
</script>

<template>
  <div class="settings shell">
    <header class="settings-head"><span>设置</span><ElButton text :icon="Close" title="关闭设置" aria-label="关闭设置" @click="close" /></header>
    <nav class="tabs" role="tablist">
      <ElButton v-for="item in tabs" :key="item.id" text role="tab" :aria-selected="tab === item.id" :class="{ active: tab === item.id }" @click="tab = item.id">{{ item.label }}</ElButton>
    </nav>
    <div class="settings-pane">
      <template v-if="tab === 'display'">
        <div class="setting-row"><span>百分比含义</span><ElSelect :model-value="state.settings.metric" aria-label="百分比含义" @change="value => updateChoice('metric', value)">
          <ElOption label="已用" value="used" /><ElOption label="剩余" value="remaining" />
        </ElSelect></div>
        <div v-for="item in displaySwitches" :key="item.key" class="setting-row"><span>{{ item.label }}</span>
          <ElSwitch :model-value="state.settings[item.key]" :aria-label="item.label" @change="value => updateBoolean(item.key, Boolean(value))" />
        </div>
        <div class="setting-row"><span>贴边切换</span><ElSelect :model-value="state.settings.summary" aria-label="贴边切换" @change="value => updateChoice('summary', value)">
          <ElOption label="仅 5h" value="five" /><ElOption label="仅 7d" value="seven" /><ElOption label="5h / 7d 轮播" value="rotate" />
        </ElSelect></div>
        <div class="setting-row"><span>失焦时半透明</span><ElSwitch :model-value="state.settings.fadeInactive" aria-label="失焦时半透明" @change="value => updateBoolean('fadeInactive', Boolean(value))" /></div>
        <div class="setting-row"><span>失焦不透明度</span><div class="slider-field"><ElSlider v-model="opacityDraft" :min="20" :max="100" :show-tooltip="false" :disabled="!state.settings.fadeInactive"
          aria-label="失焦不透明度" @change="setOpacity" /><b>{{ opacityDraft }}%</b></div></div>
      </template>
      <template v-else-if="tab === 'refresh'">
        <div class="setting-row"><span>开机自启动</span><ElSwitch :model-value="state.settings.autoStart" aria-label="开机自启动" @change="value => updateBoolean('autoStart', Boolean(value))" /></div>
        <div class="setting-row"><span>自动刷新</span><ElSwitch :model-value="state.settings.autoRefresh" aria-label="自动刷新" @change="value => updateBoolean('autoRefresh', Boolean(value))" /></div>
        <div class="setting-row"><span>数据刷新间隔</span><div class="number-field"><ElInputNumber :model-value="state.settings.refreshSeconds" :min="5" :max="3600" :controls="false" aria-label="数据刷新间隔" @change="value => updateNumber('refreshSeconds', value)" /><span>秒</span></div></div>
        <div class="setting-row"><span>账号轮播间隔</span><div class="number-field"><ElInputNumber :model-value="state.settings.rotateSeconds" :min="2" :max="60" :controls="false" aria-label="账号轮播间隔" @change="value => updateNumber('rotateSeconds', value)" /><span>秒</span></div></div>
        <div class="setting-row subdued"><span>最近刷新</span><span>{{ time(state.lastRefresh) }}</span></div>
        <div class="setting-row subdued"><span>下次刷新</span><span>{{ state.nextRefresh ? time(state.nextRefresh) : '已暂停' }}</span></div>
        <div class="actions"><ElButton :icon="Refresh" :disabled="state.busy" @click="refresh">立即刷新</ElButton></div>
      </template>
      <template v-else-if="tab === 'style'">
        <div class="style-group-label">尺寸</div>
        <div v-for="item in numberOptions" :key="item.key" class="setting-row"><span>{{ item.label }}</span><div class="number-field">
          <ElInputNumber :model-value="state.settings[item.key]" :min="item.min" :max="item.max ?? Infinity" :controls="false" :aria-label="item.label" @change="value => updateNumber(item.key, value)" /><span>{{ item.unit }}</span>
        </div></div>
        <div class="style-group-label">进度状态色</div>
        <div v-for="item in paletteSamples" :key="item.key" class="color-row"><span>{{ item.label }}</span>
          <ElColorPicker :model-value="state.settings[item.key]" :aria-label="item.label + '颜色'" @change="value => updateColor(item.key, value)" />
          <code>{{ state.settings[item.key] }}</code><div class="preview"><Meter :quota="{ used: item.sample, resetsAt: null }" :settings="state.settings" :label="item.label + '预览'" /></div>
        </div>
        <div class="style-group-label font-label">文字</div>
        <div class="setting-row"><span>界面字号</span><div class="number-field"><ElInputNumber :model-value="state.settings.fontSize" :min="10" :max="20" :controls="false" aria-label="界面字号" @change="value => updateNumber('fontSize', value)" /><span>px</span></div></div>
        <div class="setting-row"><span>文字加粗</span><ElSwitch :model-value="state.settings.fontBold" aria-label="文字加粗" @change="value => updateBoolean('fontBold', Boolean(value))" /></div>
        <div class="setting-row"><span>进度条文字描边</span><ElSwitch :model-value="state.settings.textOutline" aria-label="进度条文字描边" @change="value => updateBoolean('textOutline', Boolean(value))" /></div>
        <div class="setting-row"><span>自定义 TTF 字体</span><div class="font-actions">
          <ElButton :icon="Upload" title="导入 TTF 字体" @click="importFont">导入</ElButton>
          <ElButton :icon="Delete" title="恢复系统字体" :disabled="!state.settings.fontName" @click="removeFont" />
        </div></div>
        <div class="font-current" :title="state.settings.fontName">{{ state.settings.fontName || 'Segoe UI / 系统字体' }}</div>
        <div class="font-preview">Claude1&nbsp; 32% · Codex2&nbsp; 84%</div>
      </template>
      <template v-else-if="tab === 'connection'">
        <div class="connection-status" :class="{ error: state.connection.status === 'error' || state.connection.status === 'expired' }">{{ state.connection.message }}</div>
        <form class="login-form" @submit.prevent="login">
          <label>服务器地址<ElInput v-model="server" type="url" placeholder="https://sub2api.example.com" autocomplete="url" aria-label="服务器地址" /></label>
          <div class="login-grid"><label>邮箱<ElInput v-model="email" type="email" autocomplete="username" aria-label="邮箱" /></label>
            <label>密码<ElInput v-model="password" type="password" autocomplete="current-password" aria-label="密码" /></label></div>
          <label v-if="state.connection.status === 'twoFactor'">双重验证码<ElInput v-model="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-label="双重验证码" /></label>
          <div class="setting-row"><span>记住登录</span><ElSwitch :model-value="state.settings.rememberSession" aria-label="记住登录" @change="value => updateBoolean('rememberSession', Boolean(value))" /></div>
          <div class="actions"><ElButton :disabled="state.connection.status === 'disconnected'" @click="logout">退出登录</ElButton>
            <ElButton v-if="state.connection.status === 'twoFactor'" type="primary" @click="verify">验证</ElButton>
            <ElButton v-else native-type="submit" type="primary" :disabled="state.connection.status === 'authenticating'">登录</ElButton>
          </div>
        </form>
        <div class="setting-row"><span>演示数据</span><ElSwitch :model-value="state.settings.demo" aria-label="演示数据" @change="value => updateBoolean('demo', Boolean(value))" /></div>
      </template>
      <div v-else class="account-list">
        <template v-if="state.available.length"><div v-for="account in state.available" :key="account.id" class="account-setting">
          <div class="account-select"><ElSwitch :model-value="state.settings.selectedIds.includes(account.id)" :aria-label="`选择${account.name}`" @change="value => selectAccount(account.id, Boolean(value))" />
            <span><strong :title="account.name">{{ account.name }}</strong><small>{{ platform(account.platform) }} · {{ account.type }}{{ account.planType ? ` · ${account.planType}` : '' }} · {{ account.status }}</small></span>
          </div>
          <label class="alias-field">别名<ElInput v-model="aliasDraft[String(account.id)]" maxlength="40" placeholder="浮球显示名称" @blur="saveAlias(account.id)" @keydown.enter="blurOnEnter" /></label>
        </div></template>
        <div v-else class="empty-note">登录后可选择上游账号并设置别名</div>
      </div>
    </div>
    <footer class="settings-foot"><span :class="{ error: message }">{{ message || (state.connection.status === 'demo' ? '演示数据' : state.connection.message) }}</span><span>已选 {{ state.quotas.length }} 个账号</span></footer>
  </div>
</template>
