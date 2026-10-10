import { defineConfig } from '@playwright/test'

// End-to-end test of the real app with the small test engine (no 8 GB model needed).
// Run:  npm run build && npm run test:e2e
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  reporter: 'list'
})
