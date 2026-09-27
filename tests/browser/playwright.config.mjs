import { defineConfig, devices } from '@playwright/test';

// Smoke tests for kasa.html. The site is served as plain static files from the repo root;
// Supabase, map tiles, fonts and CDN scripts are all stubbed in fixtures.mjs, so a run
// never touches the live project or the network.
const PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    // sw.js would otherwise answer requests before page.route() sees them.
    serviceWorkers: 'block',
    permissions: ['geolocation', 'camera'],
    // Standing next to the seeded claimed report, so the confirm step's distance check passes.
    geolocation: { latitude: 23.3321, longitude: 86.3655, accuracy: 10 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--use-gl=swiftshader', '--enable-unsafe-swiftshader']
    }
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ../..`,
    url: `http://127.0.0.1:${PORT}/kasa.html`,
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore'
  }
});
