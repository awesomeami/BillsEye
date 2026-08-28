import { defineConfig, devices } from '@playwright/test';

const port = 4174;
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // CI uses Playwright Chromium. This optional override lets a Windows
      // developer run the same suite with an already-installed Chrome.
      launchOptions: browserExecutable ? { executablePath: browserExecutable } : undefined,
    },
  }],
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js --mode e2e --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      PORT: String(port),
      VITE_E2E_MOCKS: 'true',
    },
  },
});
