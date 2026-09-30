<script setup lang="ts">
import { computed } from 'vue';
import type { Quota, Settings } from '../../shared/model';

const props = defineProps<{ account: Quota; settings: Settings }>();
const value = computed(() => `${props.account.currentConcurrency ?? '--'}/${props.account.concurrency ?? '--'}`);
const status = computed(() => {
  const usage = props.account.currentConcurrency ?? 0;
  return props.account.concurrency && usage >= props.account.concurrency ? 'full' : usage > 0 ? 'in-use' : 'idle';
});
</script>

<template>
  <span v-if="settings.showConcurrency" class="concurrency-card" :class="status" :style="{ width: `${settings.concurrencyWidth}px` }"
    :title="`当前并发 / 上限 ${value}`" :aria-label="`并发 ${value}`">{{ value }}</span>
</template>
