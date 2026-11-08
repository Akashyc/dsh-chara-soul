// 界面源码在 web/，构建到 dist/，由 src/handler.js 提供。base 用相对路径：DSH 里挂在 /x-chara-soul/ 下，独立运行时在根路径
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [vue()],
  build: { outDir: '../dist', emptyOutDir: true },
});
