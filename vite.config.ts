import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме API, медиа и WebSocket проксируются на бэкенд, чтобы cookie
// работали как same-origin. Для работы с боевым сервером без логина можно
// задать DEV_COOKIE (строка Cookie из браузера) в .env.local — прокси
// подставит её сам, а заодно X-CSRFToken, Origin и Referer для Django CSRF.
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = (env.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  const devCookie = env.DEV_COOKIE || '';
  const csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(devCookie)?.[1];

  const proxy = (ws = false): ProxyOptions => ({
    target: ws ? backend.replace(/^http/, 'ws') : backend,
    ws,
    changeOrigin: true,
    secure: true,
    configure: (p) => {
      if (!devCookie) return;
      const inject = (req: { setHeader: (k: string, v: string) => void }) => {
        req.setHeader('cookie', devCookie);
        req.setHeader('origin', backend);
        req.setHeader('referer', backend + '/');
        // токен из DEV_COOKIE: своя кука csrftoken у браузера на dev-хосте с ней не совпадёт
        if (csrf) req.setHeader('x-csrftoken', csrf);
      };
      p.on('proxyReq', (req) => inject(req));
      p.on('proxyReqWs', (req) => inject(req));
      // сессией управляет DEV_COOKIE — куки бэкенда в браузер не пропускаем
      p.on('proxyRes', (res) => {
        delete res.headers['set-cookie'];
      });
    },
  });

  return {
    // Статику отдаёт Django с /assets/userbar/
    base: command === 'build' ? env.VITE_ASSETS_BASE || '/assets/userbar/' : '/',
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        // точка входа без index.html: её подключает шаблон Django
        input: 'src/main.tsx',
        output: {
          // один файл скрипта и один стилей со статическими именами — прописаны в шаблоне
          entryFileNames: 'userbar.js',
          inlineDynamicImports: true,
          assetFileNames: (info) =>
            info.names?.some((n) => n.endsWith('.css')) ? 'userbar.css' : 'assets/[name]-[hash][extname]',
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': proxy(),
        '/media': proxy(),
        '/ws': proxy(true),
      },
    },
  };
});
