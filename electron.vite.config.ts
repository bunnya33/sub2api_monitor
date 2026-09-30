import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: 'src/main/index.ts', 'menu-monitor-worker': 'src/main/menu-monitor-worker.ts' }, external: ['koffi'] } } },
  preload: { build: { rollupOptions: { input: 'src/preload/index.ts' } } },
  renderer: { root: 'src/renderer', plugins: [vue()], build: { rollupOptions: { input: 'src/renderer/index.html' } } }
});
