import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Live tests share the single local workspace and mutate its scenario.
  workers: 1,
  testDir: "./tests",
  timeout: 180000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
  },
  reporter: "list",
});
