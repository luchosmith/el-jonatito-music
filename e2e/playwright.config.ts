import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4183);
export const TZ = 'America/New_York';

export default defineConfig({
  testDir: './tests',
  // One shared test database, reset before every test.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../playwright-report' }]],
  outputDir: '../test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    timezoneId: TZ,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Also honours the app's reduced-motion mode, so animated buttons are "stable" for clicks.
    contextOptions: { reducedMotion: 'reduce' },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npm run e2e:server',
    cwd: '..',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { TEST_MODE: '1', PORT: String(PORT), DATA_DIR: '.e2e-data', SLEEP_WINDOW: '20:30-07:00', TZ },
  },
});
