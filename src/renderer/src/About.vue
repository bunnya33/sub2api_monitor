<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { ElButton } from 'element-plus';
import { Close, InfoFilled } from '@element-plus/icons-vue';
import type { AppInfo } from '../../shared/model';
import { stateReady } from './runtime';

const info = ref<AppInfo | null>(null);
const close = () => window.desktop.closeAbout();
const openHomepage = () => window.desktop.openHomepage();
onMounted(async () => {
  info.value = await window.desktop.getAppInfo();
  await stateReady;
  await nextTick();
  window.desktop.aboutReady();
});
</script>

<template>
  <div class="about shell" @keydown.esc="close">
    <header class="settings-head"><span>关于</span><ElButton text :icon="Close" title="关闭关于" aria-label="关闭关于" @click="close" /></header>
    <main class="about-body">
      <InfoFilled class="about-icon" />
      <strong>{{ info?.name }}</strong>
      <span class="about-version">版本 {{ info?.version }}{{ info?.development ? ' · 开发版' : '' }}</span>
      <p>Windows 桌面账号额度监控工具</p>
      <ElButton link @click="openHomepage">项目主页</ElButton>
    </main>
  </div>
</template>
