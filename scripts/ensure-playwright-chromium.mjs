import { existsSync } from 'node:fs';
import process from 'node:process';
import { error } from 'node:console';
import { chromium } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath();

if (!existsSync(executablePath)) {
  error('Playwright Chromium is not installed. Run `npm run setup:e2e`, then retry `npm run test:e2e`.');
  process.exit(1);
}
