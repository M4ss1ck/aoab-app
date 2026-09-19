import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level checks: the three render paths, accessibility, and the
 * behaviours that only exist once a real engine is running. The fast
 * deterministic units live in the Vitest suite instead.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        // SwiftShader so WebGL works in headless CI without a GPU.
        launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm preview --port 4321',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
