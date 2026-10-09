import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./browser",
  use: {
    baseURL: "http://127.0.0.1:3077",
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {}),
  },
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3077",
    reuseExistingServer: false,
    env: { PORT: "3077", HOSTNAME: "127.0.0.1" },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
