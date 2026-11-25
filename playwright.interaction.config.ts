import { defineConfig } from '@playwright/test'

const port = Number(process.env.EIDO_INTERACTION_TEST_PORT ?? 5174)
const dataFile = process.env.EIDO_INTERACTION_TEST_DATA_FILE ?? `/tmp/eido-card-edit-interaction-${port}.json`

export default defineConfig({
  testDir: './src/canvas',
  testMatch: '**/*.browser.test.ts',
  // These require the saved fixture and built app from the production config.
  testIgnore: '**/*.production.browser.test.ts',
  timeout: process.env.CI ? 30_000 : 60_000,
  // A systemic startup or rendering defect should create one useful failure,
  // not dozens of identical minute-long timeouts. The nightly full suite sets
  // this to 0: it is the only run that sees every file, so stopping it at the
  // first wobble hid how many tests were actually unhealthy.
  maxFailures: Number(process.env.EIDO_INTERACTION_MAX_FAILURES ?? (process.env.CI ? 1 : 0)),
  // A hosted runner is slower and noisier than a developer machine, and this
  // suite drives a real browser. Without retries a single timing wobble is
  // indistinguishable from a broken feature, which is how the nightly canary
  // spent twelve consecutive nights red and stopped being read at all. A test
  // that passes on retry is reported as flaky and named; a broken one still
  // fails three times and still fails the run.
  retries: process.env.CI ? 2 : 0,
  // One shared dev server + one data file: keep files sequential.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `rm -f ${dataFile} && EIDO_DATA_FILE=${dataFile} npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
