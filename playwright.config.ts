import { defineConfig } from '@playwright/test';

/**
 * Real end-to-end journeys against the production build. Nothing is mocked:
 * the app talks to the same free postcode, road and timetable services it
 * uses for real. A few tests cut one service off on purpose to read the
 * message a driver would see.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 75_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'test-results/out',
  use: {
    baseURL: 'http://127.0.0.1:4319',
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  webServer: { command: 'npm run build && npx vite preview --port 4319 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:4319', reuseExistingServer: false, timeout: 180_000 },
});
