<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { ElButton, ElPopconfirm, type PopconfirmInstance } from 'element-plus';
import { Download, Refresh, View, Hide, Setting, SwitchButton } from '@element-plus/icons-vue';
import type { Snapshot } from '../../shared/model';
import { stateReady } from './runtime';

defineProps<{ state: Snapshot }>();
const expanded = ref(false);
const confirm = ref<PopconfirmInstance>();
const action = (name: 'refresh' | 'visibility' | 'settings' | 'update' | 'quit') => window.desktop.menuAction(name);
function setExpanded(value: boolean): void {
  expanded.value = value;
  window.desktop.resizeUpdateMenu(value);
}
let stopReset: (() => void) | null = null;
onMounted(async () => {
  stopReset = window.desktop.subscribeMenuReset(() => { confirm.value?.hide(); expanded.value = false; });
  await stateReady;
  await nextTick();
  window.desktop.menuReady();
});
onUnmounted(() => stopReset?.());
</script>

<template>
  <div class="menu" :class="{ expanded }" role="menu">
    <div class="menu-content shell">
      <ElButton text role="menuitem" :icon="Refresh" @click="action('refresh')">刷新额度</ElButton>
      <ElButton text role="menuitemcheckbox" :aria-checked="state.visible" :icon="state.visible ? View : Hide" @click="action('visibility')">{{ state.visible ? '隐藏浮球' : '显示浮球' }}</ElButton>
      <div class="menu-line" />
      <ElPopconfirm ref="confirm" v-if="state.update.status === 'available' || state.update.status === 'downloaded'"
        placement="top" :width="164" :title="state.update.status === 'downloaded' ? `重启并安装 v${state.update.version}？` : `确认更新到 v${state.update.version}？`"
        confirm-button-text="确认" cancel-button-text="取消" :teleported="true"
        @show="setExpanded(true)" @hide="setExpanded(false)" @confirm="action('update')">
        <template #reference><ElButton text role="menuitem" :icon="Download" :title="state.update.error || undefined">{{ state.update.status === 'downloaded' ? '重启安装' : state.update.error ? '重试更新' : `更新到 v${state.update.version}` }}</ElButton></template>
      </ElPopconfirm>
      <ElButton v-else-if="state.update.status === 'downloading'" text role="menuitem" :icon="Download" disabled>下载更新 {{ state.update.progress }}%</ElButton>
      <ElButton text role="menuitem" :icon="Setting" @click="action('settings')">设置</ElButton>
      <ElButton text role="menuitem" :icon="SwitchButton" @click="action('quit')">退出</ElButton>
    </div>
  </div>
</template>
