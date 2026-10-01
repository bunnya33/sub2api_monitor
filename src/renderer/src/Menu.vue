<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { ElButton, ElPopconfirm, type PopconfirmInstance } from 'element-plus';
import { Download, InfoFilled, Refresh, View, Hide, Setting, SwitchButton } from '@element-plus/icons-vue';
import type { Snapshot } from '../../shared/model';
import { stateReady } from './runtime';

defineProps<{ state: Snapshot }>();
const expanded = ref(false);
const confirm = ref<PopconfirmInstance>();
const action = (name: 'refresh' | 'visibility' | 'settings' | 'update' | 'about' | 'quit') => window.desktop.menuAction(name);
const checking = ref(false), checkResult = ref(''), checkError = ref('');
let resultTimer: ReturnType<typeof setTimeout> | null = null;
async function checkUpdates(): Promise<void> {
  if (checking.value) return;
  checking.value = true; checkResult.value = ''; checkError.value = '';
  if (resultTimer) clearTimeout(resultTimer);
  try {
    const result = await window.desktop.checkUpdates();
    checkResult.value = result.ok ? '已是最新版本' : '检查失败，重试';
    checkError.value = result.ok ? '' : result.error;
    if (result.ok) resultTimer = setTimeout(() => { checkResult.value = ''; }, 3000);
  } catch { checkResult.value = '检查失败，重试'; checkError.value = '无法检查更新，请稍后重试'; }
  finally { checking.value = false; }
}
const dismiss = () => window.desktop.dismissMenu();
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
onUnmounted(() => { stopReset?.(); if (resultTimer) clearTimeout(resultTimer); });
</script>

<template>
  <div class="menu" :class="{ expanded }" role="menu" @keydown.esc="dismiss">
    <div class="menu-content shell">
      <ElButton text role="menuitem" :icon="Refresh" @click="action('refresh')">刷新额度</ElButton>
      <ElButton text role="menuitemcheckbox" :aria-checked="state.visible" :icon="state.visible ? View : Hide" @click="action('visibility')">{{ state.visible ? '隐藏浮球' : '显示浮球' }}</ElButton>
      <ElButton text role="menuitem" :icon="Setting" @click="action('settings')">设置</ElButton>
      <div class="menu-line" />
      <ElPopconfirm ref="confirm" v-if="state.update.status === 'available' || state.update.status === 'downloaded'"
        placement="top" :width="164" :title="state.update.status === 'downloaded' ? `重启并安装 v${state.update.version}？` : `确认更新到 v${state.update.version}？`"
        confirm-button-text="确认" cancel-button-text="取消" :teleported="true"
        @show="setExpanded(true)" @hide="setExpanded(false)" @confirm="action('update')">
        <template #reference><ElButton text role="menuitem" :icon="Download" :title="state.update.error || undefined">{{ state.update.status === 'downloaded' ? '重启安装' : state.update.error ? '重试更新' : `更新到 v${state.update.version}` }}</ElButton></template>
      </ElPopconfirm>
      <ElButton v-else-if="state.update.status === 'downloading'" text role="menuitem" :icon="Download" disabled>下载更新 {{ state.update.progress }}%</ElButton>
      <ElButton v-else text role="menuitem" :icon="Refresh" :disabled="checking || state.update.checking" :title="checkError || undefined" @click="checkUpdates">{{ checking || state.update.checking ? '正在检查更新…' : checkResult || '检查更新…' }}</ElButton>
      <ElButton text role="menuitem" :icon="InfoFilled" @click="action('about')">关于 Sub2API</ElButton>
      <div class="menu-line" />
      <ElButton text role="menuitem" :icon="SwitchButton" @click="action('quit')">退出</ElButton>
    </div>
  </div>
</template>
