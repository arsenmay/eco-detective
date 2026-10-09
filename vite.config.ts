import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.DEPLOY_BASE ?? '/';
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) {
  throw new Error('DEPLOY_BASE must be an absolute directory path with a trailing slash.');
}

export default defineConfig({
  base,
  plugins: [VitePWA({
    registerType: 'prompt',
    injectRegister: false,
    manifest: {
      id: base,
      name: 'ECO DETECTIVE: Тайна пропавшей энергии',
      short_name: 'ECO DETECTIVE',
      description: 'Образовательная детективная игра об энергосбережении. Вымышленный учебный сценарий.',
      lang: 'ru',
      start_url: base,
      scope: base,
      display: 'standalone',
      orientation: 'any',
      background_color: '#0b1523',
      theme_color: '#0b1726',
      categories: ['games', 'education'],
      icons: [
        { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png}'],
      clientsClaim: true,
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      maximumFileSizeToCacheInBytes: 2_500_000,
    },
  })],
});
