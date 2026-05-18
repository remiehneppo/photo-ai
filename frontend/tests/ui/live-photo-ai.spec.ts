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
const URL_TIMEOUT_MS = Number(process.env.LIVE_URL_TIMEOUT_MS ?? 15_000);
const LIVE_DEPTH = process.env.LIVE_DEPTH === "full" ? "full" : "smoke";
const LIVE_RESOURCE_SOAK = process.env.LIVE_RESOURCE_SOAK === "1";
const LIVE_SOAK_JOBS = Number(process.env.LIVE_SOAK_JOBS ?? 5);

const allStyles = ["realistic", "anime", "advertisement", "portrait", "artistic"];
const styles = LIVE_DEPTH === "full" ? allStyles : ["realistic"];
const allControlModes = [
  { value: "edges", label: "Edges", keyword: "canny" },
  { value: "depth", label: "Depth", keyword: "depth" },
  { value: "pose", label: "Pose", keyword: "openpose" },
  { value: "product_layout", label: "Product", keyword: "canny" }
] as const;
const controlModes = LIVE_DEPTH === "full" ? allControlModes : allControlModes.slice(0, 1);
const directions = (LIVE_DEPTH === "full" ? ["left", "right", "top", "bottom", "all"] : ["all"]) as const;

const squarePng = createTestPng(512, 512);
const portraitPng = createTestPng(512, 768);
const landscapePng = createTestPng(768, 512);

const report: {
  mode: "smoke" | "full";
  started_at: string;
  finished_at?: string;
  account?: string;
  capabilities?: Capabilities;
  health_checks: Array<{ label: string; ok: boolean; backend?: unknown; capabilities?: unknown; a1111?: unknown; error?: string }>;
  resource_samples: Array<{ label: string; backend?: unknown; a1111?: unknown; job_count?: number; storage_counts?: unknown; docker_stats?: unknown; error?: string }>;
  docker_stats: unknown[];
  storage_counts: unknown[];
  job_sequence: Array<{ case_id: string; job_id: string; feature: string; status: JobDetail["status"] }>;
  capability_skips: Array<{ id: string; reason: string }>;
  results: CaseResult[];
  unexpected_console_errors: string[];
  unexpected_network_errors: string[];
} = {
  mode: LIVE_DEPTH,
  started_at: new Date().toISOString(),
  health_checks: [],
  resource_samples: [],
  docker_stats: [],
  storage_counts: [],
  job_sequence: [],
  capability_skips: [],
  results: [],
  unexpected_console_errors: [],
  unexpected_network_errors: []
};

let currentCaseId = "setup";
let allowCurrentNetworkErrors = false;
let a1111Connected = true;
let liveJobInFlight = false;
const consoleErrors: Array<{ caseId: string; text: string }> = [];
const networkErrors: Array<{ caseId: string; text: string }> = [];

test("live browser matrix against real backend and A1111", async ({ page }, testInfo) => {
  testInfo.setTimeout(2 * 60 * 60 * 1000);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  attachDiagnostics(page);

  await healthGate(page, "preflight");
  const capabilities = await getCapabilities(page);
  report.capabilities = capabilities;
  a1111Connected = capabilities.a1111_connected;

  const timestamp = Date.now();
  const projectTag = testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const account = {
    email: `browser-test+${projectTag}-${timestamp}@example.com`,
    username: `bt_${projectTag}_${timestamp}`,
    password: "browser-test-123456"
  };
  report.account = account.email;

  await runCase(page, testInfo, "auth-register", "Register fresh account", "Dashboard opens with account and A1111 state", async () => {
    await page.goto("/register");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Username").fill(account.username);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();
    await expect(page.getByText(/A1111 connected|A1111 offline/)).toBeVisible();
    return `registered ${account.email}; ${await capabilityText(page)}`;
  });

  await runCase(page, testInfo, "auth-logout-login", "Logout then login again", "Same account returns to dashboard", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    await page.getByLabel("Email or username").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.getByText(account.email)).toBeVisible();
    return "login succeeded after logout";
  });

  await runCase(page, testInfo, "auth-invalid-password", "Login with wrong password", "Visible error and no dashboard navigation", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    allowCurrentNetworkErrors = true;
    await page.getByLabel("Email or username").fill(account.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.locator(".text-danger")).toBeVisible();
    return await page.locator(".text-danger").innerText();
  });

  await login(page, account.email, account.password);

  await runCase(page, testInfo, "auth-refresh-session", "Refresh dashboard with token", "Session remains authenticated", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.getByText(account.email)).toBeVisible();
    return "dashboard still authenticated after reload";
  });

  await runCase(page, testInfo, "auth-identifier-normalization", "Login with spaced uppercase identifier", "Whitespace and case normalize before auth", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    await page.getByLabel("Email or username").fill(`  ${account.email.toUpperCase()}  `);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.getByText(account.email)).toBeVisible();
    return "normalized login succeeded";
  });

  await runCase(page, testInfo, "auth-invalid-token", "Replace stored token with invalid token and refresh", "Login state is shown clearly", async () => {
    allowCurrentNetworkErrors = true;
    await page.evaluate(() => localStorage.setItem("photo_ai_token", "invalid-browser-test-token"));
    await page.reload();
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
    return "redirected to login after invalid token";
  });

  await login(page, account.email, account.password);

  await runCase(page, testInfo, "capabilities-ui", "Inspect capability-driven UI", "Counts and optional controls reflect /api/capabilities", async () => {
    await expect(page.getByText(new RegExp(`${capabilities.checkpoints.length} checkpoints`))).toBeVisible();
    await expect(page.getByText(new RegExp(`${capabilities.upscalers.length} upscalers`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Anime" })).toBeVisible();
    if (capabilities.a1111_connected) {
      for (const mode of controlModes) {
        await expect(page.getByRole("button", { name: new RegExp(`^${mode.label}$`) })).toBeVisible();
      }
    }
    await expect(page.getByLabel("Fix face")).toBeEnabled({ enabled: capabilities.adetailer_available });
    await expect(page.getByLabel("Fix hands")).toBeEnabled({ enabled: capabilities.adetailer_available });
    return await capabilityText(page);
  });

  await submitGenerateMatrix(page, testInfo, capabilities);
  await submitGenerateReferenceMatrix(page, testInfo, capabilities);
  await submitEditMatrix(page, testInfo, capabilities);
  await submitInpaintMatrix(page, testInfo);
  await submitUpscaleSharpenMatrix(page, testInfo, capabilities);
  await submitExpandMatrix(page, testInfo, capabilities);
  await submitADetailerMatrix(page, testInfo, capabilities);
  await submitAdditionalPanelMatrix(page, testInfo);
  if (LIVE_RESOURCE_SOAK) {
    await submitResourceSoak(page, testInfo);
  }
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
      await page.getByRole("button", { name: new RegExp(`^${mode.label}$`) }).click();
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
      await expect(page.getByRole("img", { name: "Before" })).toBeVisible();
      await expect(page.getByRole("img", { name: "After" })).toBeVisible();
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
      await page.getByRole("button", { name: new RegExp(`^${mode.label}$`) }).click();
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
  if (LIVE_DEPTH !== "full") {
    addSkip("expand-exhaustive", "Expand exhaustive matrix", "Runs only in LIVE_DEPTH=full", "LIVE_DEPTH=smoke");
    return;
  }
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
  if (LIVE_DEPTH !== "full") {
    addSkip("adetailer-full-matrix", "ADetailer full option matrix", "Runs in LIVE_DEPTH=full", "LIVE_DEPTH=smoke");
    return;
  }
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

async function submitResourceSoak(page: Page, testInfo: TestInfo) {
  if (!a1111Connected) {
    addSkip("resource-soak", "Sequential resource soak", "Runs when A1111 is available", "A1111 unavailable");
    return;
  }

  for (let index = 0; index < LIVE_SOAK_JOBS; index += 1) {
    const id = `resource-soak-${index + 1}`;
    await runJobCase(page, testInfo, id, `Resource soak job ${index + 1}`, "Sequential generate job reaches terminal status and resource sample is recorded", async () => {
      await selectTab(page, "Generate");
      await chooseStyle(page, "realistic");
      await page.getByPlaceholder("Describe the image you want...").fill(`resource soak ${index + 1}`);
      return submitAndWait(page, page.getByRole("button", { name: "Generate" }).last(), id, true);
    });
    await sampleResources(page, id);
    await rest();
  }
}

async function submitInpaintMatrix(page: Page, testInfo: TestInfo) {
  await runCase(page, testInfo, "inpaint-mask-required", "Try inpaint without painting a mask", "Prompted to paint selected area first", async () => {
    await selectTab(page, "Inpaint");
    await setFirstFileInput(page, "inpaint.png", "image/png", portraitPng);
    await page.getByPlaceholder("Describe what should appear in the selected area...").fill("replace the masked region with a red umbrella");
    await expect(page.getByRole("button", { name: "Inpaint selected area" })).toBeEnabled();
    await page.getByRole("button", { name: "Inpaint selected area" }).click();
    await expect(page.getByText("Please paint the area you want to change first.")).toBeVisible();
    return "inpaint validation error shown";
  });
  await rest();

  if (!a1111Connected) {
    addSkip("inpaint-smoke", "Inpaint selected area", "Inpaint job reaches terminal status", "A1111 unavailable");
    return;
  }

  await runJobCase(page, testInfo, "inpaint-smoke", "Inpaint selected area", "Inpaint job reaches terminal status", async () => {
    await selectTab(page, "Inpaint");
    await setFirstFileInput(page, "inpaint.png", "image/png", portraitPng);
    await page.getByRole("button", { name: "Brush" }).click();
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Inpaint canvas not ready");
    const startX = box.x + box.width * 0.32;
    const startY = box.y + box.height * 0.34;
    const endX = box.x + box.width * 0.58;
    const endY = box.y + box.height * 0.52;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 12 });
    await page.mouse.move(box.x + box.width * 0.46, box.y + box.height * 0.64, { steps: 8 });
    await page.mouse.up();
    await page.getByPlaceholder("Describe what should appear in the selected area...").fill("replace the masked region with a red umbrella");
    return submitAndWait(page, page.getByRole("button", { name: "Inpaint selected area" }), "inpaint-smoke", true);
  });
  await rest();
}

async function submitAdditionalPanelMatrix(page: Page, testInfo: TestInfo) {
  await runJobCase(page, testInfo, "face-restore-combined", "Restore faces", "Face restore job reaches terminal status", async () => {
    await selectTab(page, "Face Restore");
    await setFirstFileInput(page, "face-restore.png", "image/png", portraitPng);
    await page.locator("select").first().selectOption("combined");
    return submitAndWait(page, page.getByRole("button", { name: "Restore Faces" }), "face-restore-combined", true);
  });
  await rest();

  await runJobCase(page, testInfo, "variations-smoke", "Generate variations", "Variations job reaches terminal status", async () => {
    await selectTab(page, "Variations");
    await setFirstFileInput(page, "variations.png", "image/png", squarePng);
    await chooseStyle(page, "anime");
    await page.getByPlaceholder("Optional guidance prompt...").fill("more variations, softer lighting");
    return submitAndWait(page, page.getByRole("button", { name: "Generate Variations" }), "variations-smoke", true);
  });
  await rest();

  await runJobCase(page, testInfo, "sketch-to-photo-smoke", "Convert sketch", "Sketch→Photo job reaches terminal status", async () => {
    await selectTabWithHeading(page, "Sketch→Photo", "Sketch → Photo");
    await setFirstFileInput(page, "sketch.png", "image/png", landscapePng);
    await page.getByPlaceholder("Describe the photo to generate...").fill("clean product sketch to photo");
    await chooseStyle(page, "portrait");
    await page.getByRole("combobox").selectOption("lineart");
    return submitAndWait(page, page.getByRole("button", { name: "Convert Sketch" }), "sketch-to-photo-smoke", true);
  });
  await rest();

  await runJobCase(page, testInfo, "pose-control-smoke", "Generate with pose", "Pose Control job reaches terminal status", async () => {
    await selectTab(page, "Pose Control");
    await setFirstFileInput(page, "pose.png", "image/png", squarePng);
    await page.getByPlaceholder("Describe the character and scene...").fill("studio portrait, confident pose");
    await chooseStyle(page, "realistic");
    return submitAndWait(page, page.getByRole("button", { name: "Generate with Pose" }), "pose-control-smoke", true);
  });
  await rest();

  await runJobCase(page, testInfo, "depth-guide-smoke", "Generate with depth", "Depth Guide job reaches terminal status", async () => {
    await selectTab(page, "Depth Guide");
    await setFirstFileInput(page, "depth.png", "image/png", portraitPng);
    await page.getByPlaceholder("Describe the scene to generate...").fill("city street portrait at dusk");
    await chooseStyle(page, "artistic");
    return submitAndWait(page, page.getByRole("button", { name: "Generate with Depth" }), "depth-guide-smoke", true);
  });
  await rest();

  await runJobCase(page, testInfo, "restore-photo-smoke", "Restore old photo", "Restore Photo job reaches terminal status", async () => {
    await selectTab(page, "Restore Photo");
    await setFirstFileInput(page, "restore.png", "image/png", squarePng);
    return submitAndWait(page, page.getByRole("button", { name: "Restore Photo" }), "restore-photo-smoke", true);
  });
  await rest();

  await runJobCase(page, testInfo, "batch-upscale-smoke", "Batch upscale two images", "Batch upscale job reaches terminal status", async () => {
    await selectTab(page, "Batch Upscale");
    await page.locator("input[type=file]").first().setInputFiles([
      { name: "batch-1.png", mimeType: "image/png", buffer: squarePng },
      { name: "batch-2.png", mimeType: "image/png", buffer: portraitPng }
    ]);
    await page.locator("select").first().selectOption("anime");
    return submitAndWait(page, page.getByRole("button", { name: /Upscale 2 image\(s\)/ }), "batch-upscale-smoke", true);
  });
  await rest();

  await runCase(page, testInfo, "batch-upscale-limit", "Reject batch with 11 images", "Maximum 10 images per batch is enforced", async () => {
    await selectTab(page, "Batch Upscale");
    const overflowFiles = Array.from({ length: 11 }, (_, index) => ({
      name: `batch-overflow-${index + 1}.png`,
      mimeType: "image/png",
      buffer: index % 2 === 0 ? squarePng : portraitPng
    }));
    await page.locator("input[type=file]").first().setInputFiles(overflowFiles);
    await expect(page.getByText("Maximum 10 images per batch")).toBeVisible();
    return "batch limit error shown";
  });
  await rest();

  if (!capabilities.sam_available) {
    addSkip("background-segment-replace", "Background segment and replace", "Runs when SAM is available", "Missing SAM extension");
    return;
  }

  await runJobCase(page, testInfo, "background-segment-replace", "Segment and replace background", "Background replacement job reaches terminal status", async () => {
    await selectTabWithHeading(page, "Background", "Background Remove & Replace");
    await setFirstFileInput(page, "background.png", "image/png", landscapePng);
    const preview = page.getByAltText("Preview");
    await preview.click({ position: { x: 220, y: 180 } });
    await expect(page.getByRole("button", { name: "Segment Subject" })).toBeVisible();
    await page.getByRole("button", { name: "Segment Subject" }).click();
    await expect(page.getByText("Subject segmented. Describe the new background below.")).toBeVisible({ timeout: 30_000 });
    await page.getByPlaceholder("Describe the new background (e.g. 'sunset beach', 'studio white background')...").fill("white studio background");
    return submitAndWait(page, page.getByRole("button", { name: "Replace Background" }), "background-segment-replace", true);
  });
  await rest();
}

async function historyAndAdversarial(page: Page, testInfo: TestInfo, account: { email: string; password: string }) {
  if (!a1111Connected) {
    addSkip("history-seed", "Create history seed image", "Seed job is visible in history", "A1111 unavailable");
    addSkip("history-list-delete", "Open history and delete completed job", "Item disappears and remains gone after refresh", "A1111 unavailable");
    addSkip("history-deleted-url", "Request deleted output URL", "Deleted output is not still served", "A1111 unavailable");
    addSkip("history-user-isolation", "Create second account and inspect history", "Second user cannot see first user's jobs", "A1111 unavailable");
    addSkip("corrupt-upload", "Upload corrupt image", "Server returns readable error without crash", "A1111 unavailable");

    await runCase(page, testInfo, "empty-prompt-disabled", "Empty prompt on Generate/Edit", "Submit buttons disabled", async () => {
      await selectTab(page, "Generate");
      await page.getByPlaceholder("Describe the image you want...").fill("");
      await expect(page.getByRole("button", { name: "Generate" }).last()).toBeDisabled();
      await selectTab(page, "Edit");
      await setFirstFileInput(page, "edit.png", "image/png", portraitPng);
      await expect(page.getByRole("button", { name: "Edit image" })).toBeDisabled();
      return "empty prompt disabled expected actions";
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
    return;
  }

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
    if (!seedJob) {
      addSkip("history-list-delete", "Open history and delete completed job", "Item disappears and remains gone after refresh", "Seed job not created");
      return "seed job not created";
    }

    await selectTab(page, "History");
    const output = seedJob.images.find((image) => image.type === "output" && image.url);
    if (!output?.url) throw new Error(`seed job ${seedJob.id} has no output URL`);
    const seedImage = page.locator("img").first();
    await expect(seedImage).toBeVisible();
    page.once("dialog", async (dialog) => dialog.accept());
    await page.getByTitle("Delete history item").first().click();
    await expect(seedImage).not.toBeVisible();
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(seedImage).not.toBeVisible();
    return `deleted ${seedJob.id}`;
  });

  await runCase(page, testInfo, "history-deleted-url", "Request deleted output URL", "Deleted output is not still served", async () => {
    if (!seedJob) {
      addSkip("history-deleted-url", "Request deleted output URL", "Deleted output is not still served", "Seed job not created");
      return "seed job not created";
    }

    allowCurrentNetworkErrors = true;
    const output = seedJob.images.find((image) => image.type === "output");
    const response = await page.request.get(`${API_BASE}${output?.url}?t=${Date.now()}`);
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
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
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
    await expect(page).toHaveURL(/\/login$/, { timeout: URL_TIMEOUT_MS });
    await page.getByLabel("Email or username").focus();
    await page.keyboard.type(account.email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(account.password);
    const activeText = await page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | HTMLButtonElement | null;
      return active?.textContent || active?.value || active?.getAttribute("aria-label") || active?.tagName || "";
    });
    await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
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
  if (!a1111Connected) {
    addSkip(id, action, expected, "A1111 unavailable");
    return;
  }
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
  if (liveJobInFlight) {
    throw new Error(`attempted to submit ${caseId} while another live A1111 job is still in flight`);
  }
  liveJobInFlight = true;
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === "POST" &&
      url.origin === API_BASE &&
      [
        "/api/generate",
        "/api/generate/reference",
        "/api/edit",
        "/api/upscale",
        "/api/sharpen",
        "/api/outpaint",
        "/api/face-restore",
        "/api/variations",
        "/api/sketch-to-photo",
        "/api/pose-control",
        "/api/depth-guide",
        "/api/restore",
        "/api/upscale/batch",
        "/api/background/replace"
      ].includes(url.pathname)
    );
  });
  try {
    await button.click();
    const response = await responsePromise;
    if (!response.ok()) throw new Error(`submit failed ${response.status()}: ${await response.text()}`);
    const payload = (await response.json()) as { job_id: string };
    await expect(page.getByText(payload.job_id)).toBeVisible({ timeout: 15_000 });
    const terminal = await waitForJobTerminal(page, payload.job_id, caseId);
    if (expectOutput && terminal.status === "done" && !terminal.images.some((image) => image.type === "output" && image.url)) {
      throw new Error(`job ${terminal.id} finished without an output image`);
    }
    report.job_sequence.push({ case_id: caseId, job_id: terminal.id, feature: terminal.feature, status: terminal.status });
    return { job: terminal };
  } finally {
    liveJobInFlight = false;
  }
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
    const [backend, capabilities] = await Promise.all([
      page.request.get(`${API_BASE}/health`),
      page.request.get(`${API_BASE}/api/capabilities`)
    ]);
    let a1111: { ok: () => boolean; json: () => Promise<unknown>; text: () => Promise<string> } | null = null;
    try {
      a1111 = await page.request.get(`${A1111_BASE}/sdapi/v1/progress`);
    } catch (err) {
      entry.a1111 = { error: err instanceof Error ? err.message : String(err) };
    }
    entry.backend = await safeBody(backend);
    entry.capabilities = await safeBody(capabilities);
    if (a1111) entry.a1111 = await safeBody(a1111);
    entry.ok = backend.ok() && capabilities.ok() && Boolean(a1111?.ok()) && Boolean((entry.capabilities as Capabilities).a1111_connected);
    report.health_checks.push(entry);
    const a1111OnlyFailure = backend.ok() && capabilities.ok() && !a1111?.ok();
    if (!entry.ok && !a1111OnlyFailure) throw new Error(`health gate ${labelText} failed: ${JSON.stringify(entry)}`);
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    report.health_checks.push(entry);
    await writeReport();
    throw error;
  }
}

async function sampleResources(page: Page, labelText: string) {
  const entry: (typeof report.resource_samples)[number] = { label: labelText };
  try {
    const [backend, a1111, jobs] = await Promise.allSettled([
      page.request.get(`${API_BASE}/health`),
      page.request.get(`${A1111_BASE}/sdapi/v1/progress`),
      authedGet(page, "/api/jobs")
    ]);
    if (backend.status === "fulfilled") entry.backend = await safeBody(backend.value);
    if (a1111.status === "fulfilled") entry.a1111 = await safeBody(a1111.value);
    if (jobs.status === "fulfilled" && jobs.value.ok()) {
      const payload = (await jobs.value.json()) as { total?: number };
      entry.job_count = payload.total;
    }
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  } finally {
    report.resource_samples.push(entry);
    await writeReport();
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
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: URL_TIMEOUT_MS });
  await expect(page.getByText(email)).toBeVisible();
}

async function selectTab(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("button", { name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

async function selectTabWithHeading(page: Page, buttonName: string, headingName: string) {
  await page.getByRole("navigation").getByRole("button", { name: buttonName }).click();
  await expect(page.getByRole("heading", { name: headingName })).toBeVisible();
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
  report.capability_skips.push({ id, reason: skip_reason });
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
    if (message.type() !== "error" || allowCurrentNetworkErrors) return;
    const text = message.text();
    if (
      text.includes("/api/suggestions") ||
      text.includes("Failed to load resource: the server responded with a status of 404 (Not Found)") ||
      text.includes("net::ERR_FILE_NOT_FOUND")
    ) {
      return;
    }
    consoleErrors.push({ caseId: currentCaseId, text });
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400 || allowCurrentNetworkErrors) return;
    const url = response.url();
    if (url.includes("/api/suggestions") && status === 404) return;
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
