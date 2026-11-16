import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173', port: 4173, reuseExistingServer: true },
});
