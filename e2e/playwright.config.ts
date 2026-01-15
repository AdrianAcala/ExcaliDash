import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  use: {
    baseURL,
    actionTimeout: 20_000,
    trace: "retain-on-failure",
  },
  reporter: "list",
});
