import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

const shouldAnalyze = process.env.ANALYZE === '1';

// ESM 安全：用 import.meta.url 解析路径（避免 __dirname 在 ESM 下未定义）
export default defineConfig({
  plugins: [
    react(),
    // 四.9: Tailwind v4 Vite 插件（CSS-first 配置，无需 tailwind.config.js）
    tailwindcss(),
    ...(shouldAnalyze
      ? [
          visualizer({
            filename: 'dist/stats.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            open: true,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@public': fileURLToPath(new URL('../../public', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3002', ws: true },
    },
  },
  build: {
    // 八.1: build target 与 browserslist 对齐（es2020 = Chrome 87+ / Firefox 78+ / Safari 14+）
    target: 'es2020',
    // 三.1: 手动分包——将稳定的大依赖拆到独立 chunk，利于缓存
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
          virtual: ['@tanstack/react-virtual'],
        },
      },
    },
  },
});
