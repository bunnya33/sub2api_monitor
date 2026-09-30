<script setup lang="ts">
import { ElButton } from 'element-plus';
import { Refresh, View, Hide, Setting, SwitchButton } from '@element-plus/icons-vue';
import type { Snapshot } from '../../shared/model';

defineProps<{ state: Snapshot }>();
const action = (name: 'refresh' | 'visibility' | 'settings' | 'quit') => window.desktop.menuAction(name);
</script>

<template>
  <div class="menu shell" role="menu">
    <ElButton text role="menuitem" :icon="Refresh" @click="action('refresh')">刷新额度</ElButton>
    <ElButton text role="menuitemcheckbox" :aria-checked="state.visible" :icon="state.visible ? View : Hide" @click="action('visibility')">{{ state.visible ? '隐藏浮球' : '显示浮球' }}</ElButton>
    <div class="menu-line" />
    <ElButton text role="menuitem" :icon="Setting" @click="action('settings')">设置</ElButton>
    <ElButton text role="menuitem" :icon="SwitchButton" @click="action('quit')">退出</ElButton>
  </div>
</template>
