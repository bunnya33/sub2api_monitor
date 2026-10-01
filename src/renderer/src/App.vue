<script setup lang="ts">
import { state, view } from './runtime';
import Floating from './Floating.vue';
import Detail from './Detail.vue';
import Menu from './Menu.vue';
import Settings from './Settings.vue';
import About from './About.vue';
</script>

<template>
  <Floating v-if="view === 'floating' || view === 'snap-preview'" :state="state" :ghost="view === 'snap-preview'" />
  <Detail v-else-if="view === 'detail'" :state="state" />
  <Menu v-else-if="view === 'menu'" :state="state" />
  <About v-else-if="view === 'about'" />
  <Settings v-else :state="state" />
</template>
