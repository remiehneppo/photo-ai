import { defineConfig, devices } from "@playwright/test";

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/opt/brave.com/brave/brave";

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npx next dev -p 3001",
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: browserPath
        }
      }
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 5"],
        launchOptions: {
          executablePath: browserPath
        }
      }
    }
  ]
});
