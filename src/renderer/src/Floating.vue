<script setup lang="ts">
import { computed, ref } from 'vue';
import { alias, shortName, summaryPeriods, visiblePeriods, type Period, type Snapshot } from '../../shared/model';
import { size } from '../../shared/geometry';
import { preview } from './runtime';
import Meter from './Meter.vue';
import ConcurrencyCard from './ConcurrencyCard.vue';

const props = withDefaults(defineProps<{ state: Snapshot; ghost?: boolean }>(), { ghost: false });
const active = computed(() => props.state.quotas[props.state.rotatingIndex % Math.max(1, props.state.quotas.length)]);
const dockPeriods = computed(() => active.value ? summaryPeriods(active.value, props.state.settings, props.state.rotatingPeriod) : []);
const collapsed = computed(() => props.state.collapsed && !!props.state.edge);
const floatingStyle = computed(() => ({ '--bar-width': `${props.state.settings.barWidth}px`,
  ...(preview ? size(props.state.settings, props.state.quotas, props.state.edge, collapsed.value, props.state.rotatingIndex, props.state.rotatingPeriod) : {}) }));
const pressed = ref(false);

function down(event: PointerEvent): void {
  if (props.ghost || event.button !== 0) return;
  pressed.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  window.desktop.drag(true, event.screenX, event.screenY);
  event.preventDefault();
}
function up(event: PointerEvent): void {
  if (!pressed.value) return;
  pressed.value = false;
  window.desktop.drag(false);
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
}
function lostCapture(): void {
  if (pressed.value) { pressed.value = false; window.desktop.drag(false); }
}
function contextMenu(event: MouseEvent): void {
  if (props.ghost) return;
  event.preventDefault();
  window.desktop.openContextMenu(event.screenX, event.screenY);
}
function move(event: PointerEvent): void { if (pressed.value && !props.ghost) window.desktop.dragMove(event.screenX, event.screenY); }
function hover(inside: boolean): void { if (!props.ghost) window.desktop.hover('floating', inside); }
function periodLabel(period: Period): string { return period === 'five' ? '5 小时' : '7 天'; }
</script>

<template>
  <div class="floating" :class="[collapsed ? `docked ${state.edge}` : '', { 'snap-ghost': ghost }]" :style="floatingStyle"
    @pointerdown="down" @pointermove="move"
    @pointerup="up" @lostpointercapture="lostCapture"
    @pointerenter="hover(true)"
    @pointerleave="hover(false)" @contextmenu="contextMenu">
    <div v-if="collapsed && active" class="dock-content" :class="state.edge === 'left' || state.edge === 'right' ? 'vertical' : 'horizontal'">
      <span class="dock-name" :title="alias(active, state.settings)">{{ shortName(active, state.settings, state.rotatingIndex) }}</span>
      <div class="dock-bars">
        <Meter v-for="period in dockPeriods" :key="period" :quota="active[period]" :settings="state.settings" :period="period"
          :label="`${alias(active, state.settings)} · ${periodLabel(period)}`" />
        <span v-if="!dockPeriods.length" class="dock-empty">--</span>
        <ConcurrencyCard :account="active" :settings="state.settings" />
      </div>
    </div>
    <div v-else class="floating-rows">
      <template v-if="state.quotas.length">
        <div v-for="account in state.quotas" :key="account.id" class="floating-row">
          <span class="account-name" :style="{ width: `${state.settings.nameWidth}px` }"
            :title="account.name + (state.settings.aliases[String(account.id)] ? ` · 别名 ${alias(account, state.settings)}` : '') + (account.error ? ` · ${account.error}` : '')">{{ alias(account, state.settings) }}</span>
          <Meter v-for="period in visiblePeriods(account, state.settings)" :key="period" :quota="account[period]" :settings="state.settings" :period="period"
            :label="`${alias(account, state.settings)} · ${periodLabel(period)}`" />
          <ConcurrencyCard :account="account" :settings="state.settings" />
        </div>
      </template>
      <div v-else class="floating-empty">{{ state.connection.status === 'authenticating' ? '连接中…' : '未登录' }}</div>
    </div>
  </div>
</template>
