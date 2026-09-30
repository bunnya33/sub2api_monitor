<script setup lang="ts">
import { state, view } from './runtime';
import Floating from './Floating.vue';
import Detail from './Detail.vue';
import Menu from './Menu.vue';
import Settings from './Settings.vue';
const dismiss = () => window.desktop.dismissMenu();
</script>

<template>
  <Floating v-if="view === 'floating' || view === 'snap-preview'" :state="state" :ghost="view === 'snap-preview'" />
  <Detail v-else-if="view === 'detail'" :state="state" />
  <Menu v-else-if="view === 'menu'" :state="state" />
  <div v-else-if="view === 'menu-backdrop'" class="menu-backdrop" @pointerdown="dismiss" />
  <Settings v-else :state="state" />
</template>
