import { expect, test, type Page, type Route } from "@playwright/test";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: corsHeaders,
    json
  });
}

async function mockApi(page: Page) {
  const jobs = new Map<string, Record<string, unknown>>();

  await page.route("http://localhost:8000/api/images/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png1x1
    });
  });

  await page.route("http://localhost:8000/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    if (url.pathname === "/auth/login" && method === "POST") {
      await fulfillJson(route, { access_token: "mock-token", token_type: "bearer" });
      return;
    }

    if (url.pathname === "/auth/register" && method === "POST") {
      await fulfillJson(route, { id: "user-1", email: "creator@example.com", username: "creator" });
      return;
    }

    if (url.pathname === "/auth/me") {
      await fulfillJson(route, { id: "user-1", email: "creator@example.com", username: "creator" });
      return;
    }

    if (url.pathname === "/api/capabilities") {
      await fulfillJson(route, {
        a1111_connected: true,
        checkpoints: ["realismIllustriousBy_v55FP16", "anything-v5"],
        upscalers: ["R-ESRGAN 4x+"],
        extensions: ["sd-webui-controlnet", "adetailer"],
        controlnet_available: true,
        controlnet_models: ["control_v11p_sd15_canny"],
        adetailer_available: true,
        sam_available: false
      });
      return;
    }

    const jobStarts: Record<string, string> = {
      "/api/generate": "txt2img",
      "/api/edit": "img2img",
      "/api/upscale": "upscale",
      "/api/sharpen": "sharpen",
      "/api/outpaint": "outpaint"
    };

    if (method === "POST" && jobStarts[url.pathname]) {
      const id = `job-${jobStarts[url.pathname]}`;
      jobs.set(id, {
        id,
        feature: jobStarts[url.pathname],
        style: "realistic",
        user_prompt: "mock prompt",
        status: "done",
        progress_percent: 100,
        current_step: 10,
        total_steps: 10,
        eta_seconds: 0,
        estimated_seconds: 30,
        progress_label: "Complete",
        error_message: null,
        created_at: new Date("2026-05-13T12:00:00Z").toISOString(),
        completed_at: new Date("2026-05-13T12:01:00Z").toISOString(),
        images: [
          { id: `${id}-input`, type: "input", url: "/api/images/input/input.png", filename: "input.png" },
          { id: `${id}-output`, type: "output", url: "/api/images/output/output.png", filename: "output.png" }
        ]
      });
      await fulfillJson(route, { job_id: id, status: "pending" });
      return;
    }

    if (url.pathname === "/api/jobs") {
      await fulfillJson(route, Array.from(jobs.values()));
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/(.+)$/);
    if (jobMatch) {
      const id = jobMatch[1];
      await fulfillJson(
        route,
        jobs.get(id) || {
          id,
          feature: "txt2img",
          style: "realistic",
          user_prompt: "mock prompt",
          status: "done",
          progress_percent: 100,
          current_step: 10,
          total_steps: 10,
          eta_seconds: 0,
          estimated_seconds: 30,
          progress_label: "Complete",
          error_message: null,
          created_at: new Date("2026-05-13T12:00:00Z").toISOString(),
          completed_at: new Date("2026-05-13T12:01:00Z").toISOString(),
          images: [{ id: `${id}-output`, type: "output", url: "/api/images/output/output.png", filename: "output.png" }]
        }
      );
      return;
    }

    await fulfillJson(route, { detail: `Unhandled mock route: ${method} ${url.pathname}` }, 404);
  });
}

async function signIn(page: Page) {
  await mockApi(page);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("creator@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
  await expect(page.getByText("creator@example.com")).toBeVisible();
  await expect(page.getByText(/A1111 connected/)).toBeVisible();
}

async function uploadImage(page: Page) {
  await page.setInputFiles("input[type=file]", {
    name: "sample.png",
    mimeType: "image/png",
    buffer: png1x1
  });
}

test("login and register flows expose the expected entry points", async ({ page }) => {
  await mockApi(page);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");

  await expect(page.getByRole("heading", { name: "Photo AI" })).toBeVisible();
  await page.getByRole("link", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Email").fill("creator@example.com");
  await page.getByLabel("Username").fill("creator");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("creator@example.com")).toBeVisible();
});

test("generate tab lets a creator choose style, submit prompt, and see result", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("navigation").getByRole("button", { name: "Generate" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate" }).last()).toBeDisabled();
  await page.getByRole("button", { name: "Anime" }).click();
  await page.getByLabel("Fix face").check();
  await page.getByPlaceholder("Describe the image you want...").fill("cinematic portrait in neon rain");
  await page.getByRole("button", { name: "Generate" }).last().click();

  await expect(page.getByText("job-txt2img")).toBeVisible();
  await expect(page.getByText("done")).toBeVisible();
  await expect(page.getByText("Output")).toBeVisible();
});

test("upload workflows expose edit, upscale, sharpen, and expand controls without A1111", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await uploadImage(page);
  await page.getByPlaceholder("Describe the change...").fill("make the sky dramatic");
  await page.getByRole("button", { name: "Edit image" }).click();
  await expect(page.getByText("job-img2img")).toBeVisible();

  await page.getByRole("button", { name: "Upscale" }).click();
  await uploadImage(page);
  await page.getByRole("combobox").selectOption("face_restore");
  await page.getByRole("button", { name: "Upscale" }).last().click();
  await expect(page.getByText("job-upscale")).toBeVisible();

  await page.getByRole("button", { name: "Sharpen" }).click();
  await uploadImage(page);
  await page.getByRole("combobox").selectOption("strong");
  await page.getByRole("button", { name: "Sharpen" }).last().click();
  await expect(page.getByText("job-sharpen")).toBeVisible();

  await page.getByRole("button", { name: "Expand" }).click();
  await uploadImage(page);
  await page.getByRole("button", { name: "Left" }).click();
  await page.getByPlaceholder("Optional context for the new area...").fill("continue the background");
  await page.getByRole("button", { name: "Expand image" }).click();
  await expect(page.getByText("job-outpaint")).toBeVisible();
});

test("history tab renders completed jobs and download affordance", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Describe the image you want...").fill("history seed");
  await page.getByRole("button", { name: "Generate" }).last().click();
  await expect(page.getByText("job-txt2img")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("1 jobs")).toBeVisible();
  await expect(page.getByText("txt2img")).toBeVisible();
  await expect(page.getByTitle("Download")).toBeVisible();
});

test("dashboard remains usable on mobile width", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("button", { name: "Generate" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBeFalsy();
});
