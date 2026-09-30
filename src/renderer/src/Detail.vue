<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { ElButton, ElSwitch } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { alias, resetCountdown, supportsFive, type Period, type Snapshot } from '../../shared/model';
import { detailHeight } from '../../shared/geometry';
import { platform, resetCountText, showResetExpiry, subscription, time } from './runtime';
import Meter from './Meter.vue';
import ConcurrencyCard from './ConcurrencyCard.vue';

defineProps<{ state: Snapshot }>();
const now = ref(Date.now());
const updatingId = ref<number | null>(null);
const statusError = ref<{ id: number; message: string } | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { now.value = Date.now(); }, 1000); });
onUnmounted(() => { if (timer) clearInterval(timer); });

async function toggleStatus(id: number, enabled: boolean): Promise<void> {
  updatingId.value = id; statusError.value = null;
  const result = await window.desktop.setAccountStatus(id, enabled ? 'active' : 'inactive');
  if (!result.ok) statusError.value = { id, message: result.error };
  updatingId.value = null;
}
const hover = (inside: boolean) => window.desktop.hover('detail', inside);
const refresh = () => void window.desktop.refresh();
const periodLabel = (period: Period) => period === 'five' ? '5 小时' : '7 天';
const periods = (five: boolean): Period[] => five ? ['five', 'seven'] : ['seven'];
</script>

<template>
  <div class="detail shell" :style="{ '--detail-height': `${detailHeight(state.quotas, state.settings)}px` }"
    @pointerenter="hover(true)" @pointerleave="hover(false)">
    <header class="detail-head"><strong>额度明细</strong><div class="icon-actions">
      <ElButton text :icon="Refresh" title="刷新额度" aria-label="刷新额度" :disabled="state.busy" @click="refresh" />
    </div></header>
    <main class="detail-list">
      <section v-for="account in state.quotas" :key="account.id" class="detail-account">
        <div class="detail-title"><strong :title="account.name">{{ alias(account, state.settings) }}</strong>
          <span v-if="state.settings.showStatusToggle && state.connection.status === 'connected' && ['active', 'inactive'].includes(account.status)" class="status-control">
            <ElSwitch class="status-switch" :model-value="account.status === 'active'" :aria-label="`${alias(account, state.settings)}账号状态`"
              :title="account.status === 'active' ? '停用账号' : '启用账号'" :disabled="updatingId !== null"
              @change="value => toggleStatus(account.id, Boolean(value))" />
            <span>{{ account.status === 'active' ? '可用' : '停用' }}</span>
          </span>
          <span v-else>{{ account.error ? '缓存' : account.status === 'active' ? '可用' : account.status }}</span>
        </div>
        <div class="detail-sub">{{ platform(account.platform) }} · {{ account.type }} · <span class="subscription-plan">订阅 {{ subscription(account.planType) }} · 到期 {{ time(account.subscriptionExpiresAt ?? null) }}</span></div>
        <div class="detail-progress"><div class="detail-windows" :class="{ single: !supportsFive(account) }">
          <div v-for="period in periods(supportsFive(account))" :key="period">
            <Meter :quota="account[period]" :settings="state.settings" :period="period" :countdown="resetCountdown(account[period]?.resetsAt ?? null, now)"
              :label="`${alias(account, state.settings)} · ${periodLabel(period)} · ${account[period]?.resetsAt ? `重置于 ${time(account[period]!.resetsAt)}` : '重置时间未知'}`" />
          </div>
        </div><ConcurrencyCard :account="account" :settings="state.settings" /></div>
        <div v-if="state.settings.showResetCount || state.settings.showResetExpiry && showResetExpiry(account)" class="detail-credits">
          <div v-if="state.settings.showResetCount" class="reset-count" title="当前可用的额度重置次数"><span>重置次数</span><strong>{{ resetCountText(account) }}</strong></div>
          <div v-if="state.settings.showResetExpiry && showResetExpiry(account)" class="reset-expiry"><span>最近重置卡到期</span><time>{{ time(account.resetCredits?.nearestExpiresAt ?? null) }}</time></div>
          <div v-if="account.resetCreditsError" class="error">重置次数更新失败：{{ account.resetCreditsError }}</div>
        </div>
        <div v-if="statusError?.id === account.id" class="error status-error">{{ statusError.message }}</div>
        <div v-if="account.error" class="error">{{ account.error }}</div>
      </section>
      <div v-if="!state.quotas.length" class="empty-note">{{ state.connection.message }}</div>
    </main>
    <footer class="detail-foot"><span>刷新于 {{ time(state.lastRefresh) }}</span><span>{{ state.busy ? '刷新中' : state.connection.status === 'demo' ? '演示数据' : state.error ? '部分数据未更新' : state.connection.message }}</span></footer>
  </div>
</template>
