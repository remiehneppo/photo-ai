import { defineConfig, devices } from "@playwright/test";

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/opt/brave.com/brave/brave";
const frontendPort = process.env.FRONTEND_PORT || "3001";
const frontendBaseUrl = process.env.FRONTEND_BASE_URL || `http://localhost:${frontendPort}`;

export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30_000,
  expect: {
    timeout: 7_000
  },
  use: {
    baseURL: frontendBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: `npx next dev -p ${frontendPort}`,
    url: frontendBaseUrl,
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
