import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { validateViteConfiguration } from './src/config/buildConfig';

const CLIENT_FIREBASE_ENV_NAMES = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_DATABASE_ID',
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
] as const;

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  const { useE2eMocks } = validateViteConfiguration(environment, mode, command);
  const clientFirebaseDefines: Record<string, string> = {};
  for (const name of CLIENT_FIREBASE_ENV_NAMES) {
    const value = environment[name];
    clientFirebaseDefines[`__KHARCHALENS_${name}__`] = value === undefined
      ? 'undefined'
      : JSON.stringify(value);
  }
  const firebaseRepositoryPath = path.resolve(__dirname, 'src/services/firebase/db.ts');
  const e2eRepositoryMockPath = path.resolve(__dirname, 'e2e/mocks/firebaseDb.ts');

  return {
    // Keep the browser bundle aligned with the public Firebase values that the
    // production build validates. Server-only variables are never defined here.
    define: clientFirebaseDefines,
    plugins: [
      ...(useE2eMocks ? [{
        name: 'e2e-firebase-repository-mock',
        enforce: 'pre' as const,
        resolveId(source: string, importer?: string) {
          if (!importer || !source.startsWith('.')) return null;
          const candidate = path.resolve(path.dirname(importer), source);
          return candidate === firebaseRepositoryPath || `${candidate}.ts` === firebaseRepositoryPath
            ? e2eRepositoryMockPath
            : null;
        },
      }] : []),
      react(), 
      tailwindcss(),
      VitePWA({
        // Updates are registered manually by PwaUpdateProvider. They never
        // activate or reload while a receipt editor or memory-only queue has work.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['pwa-192x192.png', 'pwa-512x512.png'],
        manifest: {
          name: 'KharchaLens',
          short_name: 'KharchaLens',
          description: 'Receipt Analytics and Expense Tracking',
          theme_color: '#4b50a3',
          background_color: '#f4f6f3',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globIgnores: [
            '**/node_modules/**/*',
            '**/pdfjs*',
            '**/pdf.worker*',
            '**/pdfProcessor-*',
            '**/pdf-*',
            '**/exceljs*',
            '**/excel-*',
            '**/jspdf*',
            '**/html2canvas*',
            '**/purify*',
            '**/index.es-*',
            '**/CategoricalChart-*',
            '**/CartesianChart-*',
            '**/PieChart-*',
            '**/LineChart-*',
            '**/DashboardCharts-*',
            '**/MonthlyReportView-*',
            '**/CategoryReportView-*',
            '**/MerchantReportView-*',
            '**/ItemReportView-*',
          ],
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          // API routes must never be answered with cached SPA HTML.
          navigateFallbackDenylist: [/^\/api(?:\/|$)/],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          runtimeCaching: [
            {
              // There is intentionally no cache-first runtime route. In
              // particular, uploads, object URLs, and any Google API traffic
              // always bypass the service-worker cache.
              urlPattern: /\/api(?:\/|$)|googleapis|generativelanguage\.google\.com|^blob:/,
              handler: 'NetworkOnly'
            }
          ]
        }
      })
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    
    build: {
      // Kept in production output so performance budgets can follow static
      // dependency graphs instead of relying on hashed filenames.
      manifest: true,
      // Optional report/export modules use dynamic imports at their activation
      // points. Let Rollup preserve those boundaries; forcing vendor chunks here
      // can create cross-chunk edges that preload optional code from the entry.
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
