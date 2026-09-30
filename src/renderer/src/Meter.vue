<script setup lang="ts">
import { computed } from 'vue';
import { color, ink, metric, needsLightInk, outlineInk, percent, type Period, type QuotaWindow, type Settings } from '../../shared/model';

const props = defineProps<{ quota: QuotaWindow | null; settings: Settings; label: string; period?: Period; countdown?: string }>();
const value = computed(() => props.quota ? Math.max(0, Math.min(100, metric(props.quota.used, props.settings))) : 0);
const fill = computed(() => props.quota ? color(props.quota.used, props.settings) : '#aeb8b3');
const textColor = computed(() => props.quota ? ink(fill.value) : undefined);
const text = computed(() => percent(props.quota, props.settings));
const meterStyle = computed(() => ({ '--meter-outline': props.settings.textOutline && textColor.value ? outlineInk(textColor.value) : undefined,
  '--countdown-size': `${props.settings.countdownFontSize}px` }));
</script>

<template>
  <div class="meter" :class="{ outlined: settings.textOutline, 'meter-tagged': period }" :style="meterStyle"
    role="progressbar" :aria-label="label" :aria-valuemin="0" :aria-valuemax="100" :aria-valuenow="quota ? value : undefined"
    :aria-valuetext="quota ? text : '暂无数据'" :title="`${label} · ${text}`">
    <span class="meter-value" :style="{ color: quota && !needsLightInk(fill) ? textColor : undefined }">{{ text }}</span>
    <template v-if="quota">
      <span class="meter-fill" :style="{ width: `${value}%`, backgroundColor: fill }" />
      <span class="meter-value meter-foreground" :style="{ color: textColor, clipPath: `inset(0 ${100 - value}% 0 0)` }">{{ text }}</span>
    </template>
    <span v-if="period" class="meter-tag" :class="period" aria-hidden="true">{{ period === 'five' ? '5h' : '7d' }}</span>
    <span v-if="countdown !== undefined" class="meter-countdown" :aria-label="`距离重置 ${countdown}`">{{ countdown }}</span>
  </div>
</template>
