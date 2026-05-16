import { expect, test, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type Capabilities = {
  a1111_connected: boolean;
  checkpoints: string[];
  upscalers: string[];
  extensions: string[];
  controlnet_available: boolean;
  controlnet_models: string[];
  adetailer_available: boolean;
  sam_available: boolean;
};

type JobDetail = {
  id: string;
  feature: string;
  style?: string | null;
  user_prompt?: string | null;
  status: "pending" | "processing" | "done" | "failed";
  progress_percent: number;
  current_step?: number | null;
  total_steps?: number | null;
  eta_seconds?: number | null;
  estimated_seconds?: number | null;
  progress_label?: string | null;
  error_message?: string | null;
  images: Array<{ id: string; type: "input" | "output"; url: string; filename?: string | null }>;
};

type CaseStatus = "PASS" | "FAIL" | "SKIP";

type CaseResult = {
  id: string;
  status: CaseStatus;
  action: string;
  expected: string;
  actual: string;
  job_id?: string;
  output_url?: string;
  progress?: {
    percent: number;
    current_step?: number | null;
    total_steps?: number | null;
    eta_seconds?: number | null;
    label?: string | null;
  };
  screenshot?: string;
  skip_reason?: string;
  console_errors: string[];
  network_errors: string[];
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const A1111_BASE = process.env.A1111_BASE_URL ?? "http://127.0.0.1:7860";
const REPORT_PATH = path.resolve(process.cwd(), "../.context/live-browser-test-report.json");
const SCREENSHOT_DIR = path.resolve(process.cwd(), "../.context/ui-test-screenshots");
const JOB_TIMEOUT_MS = Number(process.env.LIVE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000);
const REST_MS = Number(process.env.LIVE_JOB_REST_MS ?? 3000);

const styles = ["realistic", "anime", "advertisement", "portrait", "artistic"];
const controlModes = [
  { value: "edges", label: "Edges", keyword: "canny" },
  { value: "depth", label: "Depth", keyword: "depth" },
  { value: "pose", label: "Pose", keyword: "openpose" },
  { value: "product_layout", label: "Product", keyword: "canny" }
] as const;
const directions = ["left", "right", "top", "bottom", "all"] as const;

const squarePng = createTestPng(512, 512);
const portraitPng = createTestPng(512, 768);
const landscapePng = createTestPng(768, 512);

const report: {
  started_at: string;
  finished_at?: string;
  account?: string;
  capabilities?: Capabilities;
  health_checks: Array<{ label: string; ok: boolean; backend?: unknown; capabilities?: unknown; a1111?: unknown; error?: string }>;
  results: CaseResult[];
  unexpected_console_errors: string[];
  unexpected_network_errors: string[];
} = {
  started_at: new Date().toISOString(),
  health_checks: [],
  results: [],
  unexpected_console_errors: [],
  unexpected_network_errors: []
};

let currentCaseId = "setup";
let allowCurrentNetworkErrors = false;
const consoleErrors: Array<{ caseId: string; text: string }> = [];
const networkErrors: Array<{ caseId: string; text: string }> = [];

test.describe.configure({ mode: "serial" });
test.setTimeout(2 * 60 * 60 * 1000);

test("live browser matrix against real backend and A1111", async ({ page }, testInfo) => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  attachDiagnostics(page);

  await healthGate(page, "preflight");
  const capabilities = await getCapabilities(page);
  report.capabilities = capabilities;

  const timestamp = Date.now();
  const account = {
    email: `browser-test+${timestamp}@example.com`,
    username: `bt_${timestamp}`,
    password: "browser-test-123456"
  };
  report.account = account.email;

  await runCase(page, testInfo, "auth-register", "Register fresh account", "Dashboard opens with account and A1111 state", async () => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();
    await expect(page.getByText(/A1111 connected|A1111 offline/)).toBeVisible();
    return `registered ${account.email}; ${await capabilityText(page)}`;
  });

  await runCase(page, testInfo, "auth-logout-login", "Logout then login again", "Same account returns to dashboard", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email or username").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(account.email)).toBeVisible();
    return "login succeeded after logout";
  });

  await runCase(page, testInfo, "auth-invalid-password", "Login with wrong password", "Visible error and no dashboard navigation", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    allowCurrentNetworkErrors = true;
    await page.getByLabel("Email or username").fill(account.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator(".text-danger")).toBeVisible();
    return await page.locator(".text-danger").innerText();
  });

  await login(page, account.email, account.password);

  await runCase(page, testInfo, "auth-refresh-session", "Refresh dashboard with token", "Session remains authenticated", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(account.email)).toBeVisible();
    return "dashboard still authenticated after reload";
  });

  await runCase(page, testInfo, "auth-invalid-token", "Replace stored token with invalid token and refresh", "Login state is shown clearly", async () => {
    allowCurrentNetworkErrors = true;
    await page.evaluate(() => localStorage.setItem("photo_ai_token", "invalid-browser-test-token"));
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
    return "redirected to login after invalid token";
  });

  await login(page, account.email, account.password);

  await runCase(page, testInfo, "capabilities-ui", "Inspect capability-driven UI", "Counts and optional controls reflect /api/capabilities", async () => {
    await expect(page.getByText(new RegExp(`${capabilities.checkpoints.length} checkpoints`))).toBeVisible();
    await expect(page.getByText(new RegExp(`${capabilities.upscalers.length} upscalers`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Anime" })).toBeVisible();
    for (const mode of controlModes) {
      const hasModel = capabilities.controlnet_models.some((model) => model.toLowerCase().includes(mode.keyword));
      await expect(page.getByRole("button", { name: mode.label })).toBeEnabled({ enabled: hasModel });
    }
    await expect(page.getByLabel("Fix face")).toBeEnabled({ enabled: capabilities.adetailer_available });
    await expect(page.getByLabel("Fix hands")).toBeEnabled({ enabled: capabilities.adetailer_available });
    return await capabilityText(page);
  });

  await submitGenerateMatrix(page, testInfo, capabilities);
  await submitGenerateReferenceMatrix(page, testInfo, capabilities);
  await submitEditMatrix(page, testInfo, capabilities);
  await submitUpscaleSharpenMatrix(page, testInfo, capabilities);
  await submitExpandMatrix(page, testInfo, capabilities);
  await submitADetailerMatrix(page, testInfo, capabilities);
  await historyAndAdversarial(page, testInfo, account);
  await mobileAndKeyboard(page, testInfo, account);

  report.finished_at = new Date().toISOString();
  report.unexpected_console_errors = consoleErrors.map((item) => `${item.caseId}: ${item.text}`);
  report.unexpected_network_errors = networkErrors.map((item) => `${item.caseId}: ${item.text}`);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  expect(report.results.filter((result) => result.status === "FAIL")).toEqual([]);
  expect(report.unexpected_console_errors).toEqual([]);
  expect(report.unexpected_network_errors).toEqual([]);
});

async function submitGenerateMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  for (const style of styles) {
    await runJobCase(page, testInfo, `generate-${style}`, `Generate ${style}`, "Job reaches done/failed and output renders", async () => {
      await selectTab(page, "Generate");
      await chooseStyle(page, style);
      await page.getByPlaceholder("Describe the image you want...").fill(`live browser ${style} photo test`);
      return submitAndWait(page, page.getByRole("button", { name: "Generate" }).last(), `generate-${style}`, true);
    });
    await rest();
  }
  if (!capabilities.adetailer_available) {
    addSkip("generate-adetailer-options", "Generate fix face/hands option matrix", "ADetailer options run when available", "Missing ADetailer extension/model");
  }
}

async function submitGenerateReferenceMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  for (const mode of controlModes) {
    const hasModel = capabilities.controlnet_available && capabilities.controlnet_models.some((model) => model.toLowerCase().includes(mode.keyword));
    if (!hasModel) {
      addSkip(`generate-reference-${mode.value}`, `Generate reference ${mode.value}`, "ControlNet job runs when model is available", `Missing ControlNet model containing "${mode.keyword}"`);
      continue;
    }
    await runJobCase(page, testInfo, `generate-reference-${mode.value}`, `Generate with reference ${mode.value}`, "Reference job reaches terminal status and output renders", async () => {
      await selectTab(page, "Generate");
      await setFirstFileInput(page, "reference.png", "image/png", portraitPng);
      await page.getByRole("button", { name: mode.label }).click();
      await page.getByPlaceholder("Describe the image you want...").fill(`reference ${mode.value} live test`);
      return submitAndWait(page, page.getByRole("button", { name: "Generate" }).last(), `generate-reference-${mode.value}`, true);
    });
    await rest();
  }
}

async function submitEditMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  for (const style of styles) {
    await runJobCase(page, testInfo, `edit-${style}`, `Edit ${style}`, "Edit job renders input and output", async () => {
      await selectTab(page, "Edit");
      await setFirstFileInput(page, "edit.png", "image/png", portraitPng);
      await chooseStyle(page, style);
      await page.getByPlaceholder("Describe the change...").fill(`edit live browser ${style}`);
      const terminal = await submitAndWait(page, page.getByRole("button", { name: "Edit image" }), `edit-${style}`, true);
      await expect(page.getByText("Input")).toBeVisible();
      await expect(page.getByText("Output")).toBeVisible();
      return terminal;
    });
    await rest();
  }

  for (const mode of controlModes) {
    const hasModel = capabilities.controlnet_available && capabilities.controlnet_models.some((model) => model.toLowerCase().includes(mode.keyword));
    if (!hasModel) {
      addSkip(`edit-reference-${mode.value}`, `Edit reference ${mode.value}`, "ControlNet edit runs when model is available", `Missing ControlNet model containing "${mode.keyword}"`);
      continue;
    }
    await runJobCase(page, testInfo, `edit-reference-${mode.value}`, `Edit with reference ${mode.value}`, "Reference edit reaches terminal status", async () => {
      await selectTab(page, "Edit");
      await setFileInputs(page, [
        { index: 0, name: "edit.png", mimeType: "image/png", buffer: portraitPng },
        { index: 1, name: "reference.png", mimeType: "image/png", buffer: landscapePng }
      ]);
      await page.getByRole("button", { name: mode.label }).click();
      await page.getByPlaceholder("Describe the change...").fill(`edit reference ${mode.value}`);
      return submitAndWait(page, page.getByRole("button", { name: "Edit image" }), `edit-reference-${mode.value}`, true);
    });
    await rest();
  }
}

async function submitUpscaleSharpenMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  for (const mode of ["default", "face_restore", "anime"]) {
    await runJobCase(page, testInfo, `upscale-${mode}`, `Upscale ${mode}`, "Upscale job reaches terminal status and output renders", async () => {
      const warning =
        mode === "anime" && !capabilities.upscalers.some((item) => item.toLowerCase().includes("anime"))
          ? "environment warning: no anime-named upscaler in capabilities; "
          : mode === "face_restore" && !capabilities.extensions.includes("adetailer")
            ? "environment warning: face restore extension not listed; "
            : "";
      await selectTab(page, "Upscale");
      await setFirstFileInput(page, "upscale.png", "image/png", squarePng);
      await page.getByRole("combobox").selectOption(mode);
      const terminal = await submitAndWait(page, page.getByRole("button", { name: "Upscale" }).last(), `upscale-${mode}`, true);
      return { ...terminal, note: `${warning}${terminal.note ?? ""}` };
    });
    await rest();
  }

  for (const mode of ["soft", "default", "strong"]) {
    await runJobCase(page, testInfo, `sharpen-${mode}`, `Sharpen ${mode}`, "Sharpen job reaches terminal status and output renders", async () => {
      await selectTab(page, "Sharpen");
      await setFirstFileInput(page, "sharpen.png", "image/png", landscapePng);
      await page.getByRole("combobox").selectOption(mode);
      return submitAndWait(page, page.getByRole("button", { name: "Sharpen" }).last(), `sharpen-${mode}`, true);
    });
    await rest();
  }
}

async function submitExpandMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  for (const style of styles) {
    await runJobCase(page, testInfo, `expand-smoke-${style}`, `Expand ${style} all`, "Outpaint smoke reaches terminal status and output renders", async () => {
      await selectTab(page, "Expand");
      await setFirstFileInput(page, "expand.png", "image/png", landscapePng);
      await page.getByRole("button", { name: "All" }).click();
      await chooseStyle(page, style);
      await page.getByPlaceholder("Optional context for the new area...").fill(`expand ${style}`);
      return submitAndWait(page, page.getByRole("button", { name: "Expand image" }), `expand-smoke-${style}`, true);
    });
    await rest();
  }
  await healthGate(page, "after-expand-smoke");
  if (!capabilities.a1111_connected) {
    addSkip("expand-exhaustive", "Expand exhaustive matrix", "Runs only after healthy smoke", "A1111 not connected");
    return;
  }

  for (const direction of directions) {
    await runJobCase(page, testInfo, `expand-realistic-${direction}`, `Expand realistic ${direction}`, "Direction matrix reaches terminal status", async () => {
      await selectTab(page, "Expand");
      await setFirstFileInput(page, "expand.png", "image/png", landscapePng);
      await page.getByRole("button", { name: label(direction) }).click();
      await chooseStyle(page, "realistic");
      await page.getByPlaceholder("Optional context for the new area...").fill(`expand ${direction}`);
      return submitAndWait(page, page.getByRole("button", { name: "Expand image" }), `expand-realistic-${direction}`, true);
    });
    await rest();
  }
}

async function submitADetailerMatrix(page: Page, testInfo: TestInfo, capabilities: Capabilities) {
  if (!capabilities.adetailer_available) {
    for (const feature of ["generate", "edit", "expand"]) {
      addSkip(`${feature}-fix-face-hands`, `${feature} fix face/hands`, "Runs when ADetailer is available", "Missing ADetailer");
    }
    return;
  }
  for (const option of [
    { id: "fix-face", face: true, hands: false },
    { id: "fix-hands", face: false, hands: true },
    { id: "fix-face-hands", face: true, hands: true }
  ]) {
    await runJobCase(page, testInfo, `generate-${option.id}`, `Generate ${option.id}`, "ADetailer option job reaches terminal status", async () => {
      await selectTab(page, "Generate");
      await page.getByLabel("Fix face").setChecked(option.face);
      await page.getByLabel("Fix hands").setChecked(option.hands);
      await page.getByPlaceholder("Describe the image you want...").fill(`adetailer ${option.id}`);
      return submitAndWait(page, page.getByRole("button", { name: "Generate" }).last(), `generate-${option.id}`, true);
    });
    await rest();
  }
}

async function historyAndAdversarial(page: Page, testInfo: TestInfo, account: { email: string; password: string }) {
  let seedJob: JobDetail | null = null;
  await runJobCase(page, testInfo, "history-seed", "Create history seed image", "Seed job is visible in history", async () => {
    await selectTab(page, "Generate");
    await page.getByPlaceholder("Describe the image you want...").fill("history seed live browser");
    const terminal = await submitAndWait(page, page.getByRole("button", { name: "Generate" }).last(), "history-seed", true);
    seedJob = terminal.job;
    return terminal;
  });
  await rest();

  await runCase(page, testInfo, "history-list-delete", "Open history and delete completed job", "Item disappears and remains gone after refresh", async () => {
    await selectTab(page, "History");
    const output = seedJob!.images.find((image) => image.type === "output" && image.url);
    if (!output?.url) throw new Error(`seed job ${seedJob!.id} has no output URL`);
    const seedImage = page.locator(`img[src*="${output.url}"]`);
    await expect(seedImage).toBeVisible();
    page.once("dialog", async (dialog) => dialog.accept());
    await page.getByTitle("Delete history item").first().click();
    await expect(seedImage).not.toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(seedImage).not.toBeVisible();
    return `deleted ${seedJob!.id}`;
  });

  await runCase(page, testInfo, "history-deleted-url", "Request deleted output URL", "Deleted output is not still served", async () => {
    allowCurrentNetworkErrors = true;
    const output = seedJob!.images.find((image) => image.type === "output");
    const response = await page.request.get(`${API_BASE}${output?.url}`);
    if (response.ok()) throw new Error(`Deleted output still rendered at ${output?.url}`);
    return `deleted URL returned ${response.status()}`;
  });

  await runCase(page, testInfo, "history-user-isolation", "Create second account and inspect history", "Second user cannot see first user's jobs", async () => {
    const other = { email: `browser-other+${Date.now()}@example.com`, username: `bo_${Date.now()}`, password: account.password };
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.goto("/register");
    await page.getByLabel("Email").fill(other.email);
    await page.getByLabel("Username").fill(other.username);
    await page.getByLabel("Password").fill(other.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await selectTab(page, "History");
    await expect(page.getByText("No jobs yet.")).toBeVisible();
    return "new user history empty";
  });

  await login(page, account.email, account.password);

  await runCase(page, testInfo, "empty-prompt-disabled", "Empty prompt on Generate/Edit", "Submit buttons disabled", async () => {
    await selectTab(page, "Generate");
    await page.getByPlaceholder("Describe the image you want...").fill("");
    await expect(page.getByRole("button", { name: "Generate" }).last()).toBeDisabled();
    await selectTab(page, "Edit");
    await setFirstFileInput(page, "edit.png", "image/png", portraitPng);
    await expect(page.getByRole("button", { name: "Edit image" })).toBeDisabled();
    return "empty prompt disabled expected actions";
  });

  await runCase(page, testInfo, "corrupt-upload", "Upload corrupt image", "Server returns readable error without crash", async () => {
    allowCurrentNetworkErrors = true;
    await selectTab(page, "Upscale");
    await setFirstFileInput(page, "corrupt.png", "image/png", Buffer.from("not a real png"));
    await page.getByRole("button", { name: "Upscale" }).last().click();
    await expect(page.locator(".text-danger")).toBeVisible({ timeout: 10_000 });
    await healthGate(page, "after-corrupt-upload");
    return await page.locator(".text-danger").innerText();
  });

  await runCase(page, testInfo, "mobile-overflow", "Set mobile viewport", "No horizontal overflow and nav remains usable", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Generate" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (hasOverflow) throw new Error("document has horizontal overflow");
    await page.setViewportSize({ width: 1280, height: 900 });
    return "mobile viewport has no horizontal overflow";
  });
}

async function mobileAndKeyboard(page: Page, testInfo: TestInfo, account: { email: string; password: string }) {
  await runCase(page, testInfo, "keyboard-login", "Keyboard-only login flow", "Tab/Enter can submit and focus is visible", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email or username").focus();
    await page.keyboard.type(account.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(account.password);
    const activeText = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | HTMLButtonElement | null;
      return active?.textContent || active?.value || active?.getAttribute("aria-label") || active?.tagName || "";
    });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/dashboard$/);
    return `submitted via keyboard from active element "${activeText.trim()}"`;
  });
}

async function runCase(page: Page, testInfo: TestInfo, id: string, action: string, expected: string, body: () => Promise<string>) {
  currentCaseId = id;
  allowCurrentNetworkErrors = false;
  const consoleStart = consoleErrors.length;
  const networkStart = networkErrors.length;
  try {
    const actual = await body();
    report.results.push({
      id,
      status: "PASS",
      action,
      expected,
      actual,
      console_errors: consoleErrors.slice(consoleStart).map((item) => item.text),
      network_errors: networkErrors.slice(networkStart).map((item) => item.text)
    });
  } catch (error) {
    const screenshotPath = await screenshot(page, id, testInfo);
    report.results.push({
      id,
      status: "FAIL",
      action,
      expected,
      actual: error instanceof Error ? error.message : String(error),
      screenshot: screenshotPath,
      console_errors: consoleErrors.slice(consoleStart).map((item) => item.text),
      network_errors: networkErrors.slice(networkStart).map((item) => item.text)
    });
    await writeReport();
    throw error;
  } finally {
    allowCurrentNetworkErrors = false;
  }
}

async function runJobCase(
  page: Page,
  testInfo: TestInfo,
  id: string,
  action: string,
  expected: string,
  body: () => Promise<{ job: JobDetail; note?: string }>
) {
  currentCaseId = id;
  allowCurrentNetworkErrors = false;
  const consoleStart = consoleErrors.length;
  const networkStart = networkErrors.length;
  try {
    await healthGate(page, `before-${id}`);
    const terminal = await body();
    await healthGate(page, `after-${id}`);
    const output = terminal.job.images.find((image) => image.type === "output" && image.url);
    if (terminal.job.status !== "done") throw new Error(`job ${terminal.job.id} ended ${terminal.job.status}: ${terminal.job.error_message ?? "no error message"}`);
    if (!output) throw new Error(`job ${terminal.job.id} has no output image`);
    await expect(page.locator("img").last()).toBeVisible();
    report.results.push({
      id,
      status: "PASS",
      action,
      expected,
      actual: `${terminal.note ?? ""}job ${terminal.job.id} done with output ${output.url}`,
      job_id: terminal.job.id,
      output_url: output.url,
      progress: {
        percent: terminal.job.progress_percent,
        current_step: terminal.job.current_step,
        total_steps: terminal.job.total_steps,
        eta_seconds: terminal.job.eta_seconds,
        label: terminal.job.progress_label
      },
      console_errors: consoleErrors.slice(consoleStart).map((item) => item.text),
      network_errors: networkErrors.slice(networkStart).map((item) => item.text)
    });
  } catch (error) {
    const screenshotPath = await screenshot(page, id, testInfo);
    report.results.push({
      id,
      status: "FAIL",
      action,
      expected,
      actual: error instanceof Error ? error.message : String(error),
      screenshot: screenshotPath,
      console_errors: consoleErrors.slice(consoleStart).map((item) => item.text),
      network_errors: networkErrors.slice(networkStart).map((item) => item.text)
    });
    await writeReport();
    throw error;
  }
}

async function submitAndWait(page: Page, button: ReturnType<Page["getByRole"]>, caseId: string, expectOutput: boolean) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.origin === API_BASE && ["/api/generate", "/api/generate/reference", "/api/edit", "/api/upscale", "/api/sharpen", "/api/outpaint"].includes(url.pathname);
  });
  await button.click();
  const response = await responsePromise;
  if (!response.ok()) throw new Error(`submit failed ${response.status()}: ${await response.text()}`);
  const payload = (await response.json()) as { job_id: string };
  await expect(page.getByText(payload.job_id)).toBeVisible({ timeout: 15_000 });
  const terminal = await waitForJobTerminal(page, payload.job_id, caseId);
  await expect(page.getByText(terminal.status, { exact: true })).toBeVisible({ timeout: 15_000 });
  if (expectOutput && terminal.status === "done") await expect(page.getByText("Output")).toBeVisible({ timeout: 15_000 });
  return { job: terminal };
}

async function waitForJobTerminal(page: Page, jobId: string, caseId: string) {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let last: JobDetail | null = null;
  while (Date.now() < deadline) {
    const response = await authedGet(page, `/api/jobs/${jobId}`);
    if (!response.ok()) throw new Error(`job poll failed ${response.status()}: ${await response.text()}`);
    last = (await response.json()) as JobDetail;
    if (last.status === "done" || last.status === "failed") return last;
    await page.waitForTimeout(1800);
  }
  await healthGate(page, `timeout-${caseId}`);
  throw new Error(`job ${jobId} timed out after ${JOB_TIMEOUT_MS}ms; last=${JSON.stringify(last)}`);
}

async function authedGet(page: Page, pathName: string) {
  const token = await page.evaluate(() => localStorage.getItem("photo_ai_token"));
  return page.request.get(`${API_BASE}${pathName}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
}

async function getCapabilities(page: Page) {
  const response = await page.request.get(`${API_BASE}/api/capabilities`);
  if (!response.ok()) throw new Error(`capabilities failed: ${response.status()} ${await response.text()}`);
  return (await response.json()) as Capabilities;
}

async function healthGate(page: Page, labelText: string) {
  const entry: (typeof report.health_checks)[number] = { label: labelText, ok: false };
  try {
    const [backend, capabilities, a1111] = await Promise.all([
      page.request.get(`${API_BASE}/health`),
      page.request.get(`${API_BASE}/api/capabilities`),
      page.request.get(`${A1111_BASE}/sdapi/v1/progress`)
    ]);
    entry.backend = await safeBody(backend);
    entry.capabilities = await safeBody(capabilities);
    entry.a1111 = await safeBody(a1111);
    entry.ok = backend.ok() && capabilities.ok() && a1111.ok() && Boolean((entry.capabilities as Capabilities).a1111_connected);
    report.health_checks.push(entry);
    if (!entry.ok) throw new Error(`health gate ${labelText} failed: ${JSON.stringify(entry)}`);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    report.health_checks.push(entry);
    await writeReport();
    throw error;
  }
}

async function safeBody(response: { json: () => Promise<unknown>; text: () => Promise<string> }) {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email or username").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(email)).toBeVisible();
}

async function selectTab(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function chooseStyle(page: Page, style: string) {
  await page.getByRole("button", { name: label(style) }).click();
}

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function setFirstFileInput(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await setFileInputs(page, [{ index: 0, name, mimeType, buffer }]);
}

async function setFileInputs(page: Page, files: Array<{ index: number; name: string; mimeType: string; buffer: Buffer }>) {
  const inputs = page.locator("input[type=file]");
  for (const file of files) {
    await inputs.nth(file.index).setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  }
}

async function capabilityText(page: Page) {
  return await page.locator("header p.text-muted").last().innerText();
}

async function rest() {
  await new Promise((resolve) => setTimeout(resolve, REST_MS));
}

function addSkip(id: string, action: string, expected: string, skip_reason: string) {
  report.results.push({
    id,
    status: "SKIP",
    action,
    expected,
    actual: skip_reason,
    skip_reason,
    console_errors: [],
    network_errors: []
  });
}

function attachDiagnostics(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error" && !allowCurrentNetworkErrors) consoleErrors.push({ caseId: currentCaseId, text: message.text() });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400 || allowCurrentNetworkErrors) return;
    const url = response.url();
    if (url.includes("/_next/") || url.startsWith("data:")) return;
    networkErrors.push({ caseId: currentCaseId, text: `${status} ${url}` });
  });
}

async function screenshot(page: Page, id: string, testInfo: TestInfo) {
  const filePath = path.join(SCREENSHOT_DIR, `${id}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  await testInfo.attach(id, { path: filePath, contentType: "image/png" });
  return filePath;
}

function createTestPng(width: number, height: number) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const inHead = y > height * 0.14 && y < height * 0.3 && Math.abs(x - width * 0.5) < width * 0.09;
      const inTorso = y > height * 0.32 && y < height * 0.68 && Math.abs(x - width * 0.5) < width * 0.16;
      const inGround = y > height * 0.78;
      const gradient = Math.round((x / Math.max(1, width - 1)) * 90);
      raw[offset] = inHead || inTorso ? 38 : inGround ? 78 : 150 + gradient;
      raw[offset + 1] = inHead || inTorso ? 58 : inGround ? 112 : 185 - Math.round(y / Math.max(1, height - 1) * 55);
      raw[offset + 2] = inHead || inTorso ? 96 : inGround ? 94 : 215;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function writeReport() {
  report.finished_at = new Date().toISOString();
  report.unexpected_console_errors = consoleErrors.map((item) => `${item.caseId}: ${item.text}`);
  report.unexpected_network_errors = networkErrors.map((item) => `${item.caseId}: ${item.text}`);
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}
