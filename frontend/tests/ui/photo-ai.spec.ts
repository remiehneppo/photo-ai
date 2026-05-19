import { expect, test, type Page, type Route } from "@playwright/test";

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,content-type",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
};

async function fulfillJson(route: Route, json: unknown, status = 200) {
  await route.fulfill({
    status,
    headers: corsHeaders,
    json
  });
}

async function mockApi(
  page: Page,
  options: {
    controlnetModels?: string[];
    adetailerAvailable?: boolean;
    samAvailable?: boolean;
    immediateJobCompletion?: boolean;
    onJobDetailRequest?: (jobId: string) => void;
  } = {}
) {
  const jobs = new Map<string, Record<string, unknown>>();
  const jobPolls = new Map<string, number>();
  const controlnetModels = options.controlnetModels ?? [
    "control_v11p_sd15_canny",
    "control_v11f1p_sd15_depth",
    "control_v11p_sd15_openpose",
    "control_v11f1e_sd15_tile"
  ];

  await page.route("http://localhost:8000/api/images/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: corsHeaders,
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

    if (url.pathname.startsWith("/api/images/")) {
      await route.fulfill({
        status: 200,
        headers: corsHeaders,
        contentType: "image/png",
        body: png1x1
      });
      return;
    }

    if (url.pathname === "/auth/login" && method === "POST") {
      const form = new URLSearchParams(route.request().postData() ?? "");
      if (form.get("username") === "creator" && form.get("password") !== " password123 ") {
        await fulfillJson(route, { detail: "Password was changed before submit" }, 401);
        return;
      }
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
        controlnet_models: controlnetModels,
        adetailer_available: options.adetailerAvailable ?? true,
        sam_available: options.samAvailable ?? false
      });
      return;
    }

    if (url.pathname === "/api/generate/styles") {
      await fulfillJson(route, { styles: ["realistic", "anime", "advertisement", "portrait", "artistic"] });
      return;
    }

    if (url.pathname === "/api/suggestions") {
      await fulfillJson(route, { prompts_by_task: {}, style_keywords: {} });
      return;
    }

    const jobStarts: Record<string, string> = {
      "/api/generate": "txt2img",
      "/api/generate/reference": "txt2img",
      "/api/edit": "img2img",
      "/api/upscale": "upscale",
      "/api/sharpen": "sharpen",
      "/api/outpaint": "outpaint"
    };

    if (method === "POST" && jobStarts[url.pathname]) {
      const id = `job-${jobStarts[url.pathname]}`;
      const completed = options.immediateJobCompletion ?? false;
      jobs.set(id, {
        id,
        feature: jobStarts[url.pathname],
        style: "realistic",
        user_prompt: "mock prompt",
        status: completed ? "done" : "pending",
        progress_percent: completed ? 100 : 0,
        current_step: completed ? 10 : 0,
        total_steps: 10,
        eta_seconds: completed ? 0 : 30,
        estimated_seconds: 30,
        progress_label: completed ? "Complete" : "Queued",
        error_message: null,
        created_at: new Date("2026-05-13T12:00:00Z").toISOString(),
        completed_at: completed ? new Date("2026-05-13T12:01:00Z").toISOString() : null,
        images: [
          { id: `${id}-input`, type: "input", url: "/api/images/input/input.png", filename: "input.png" },
          { id: `${id}-output`, type: "output", url: "/api/images/output/output.png", filename: "output.png" }
        ]
      });
      jobPolls.set(id, 0);
      await fulfillJson(route, { job_id: id, status: completed ? "done" : "pending" });
      return;
    }

    if (url.pathname === "/api/jobs") {
      const items = Array.from(jobs.values());
      await fulfillJson(route, { total: items.length, items });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/(.+)$/);
    if (jobMatch) {
      const id = jobMatch[1];
      options.onJobDetailRequest?.(id);
      if (method === "DELETE") {
        jobs.delete(id);
        jobPolls.delete(id);
        await route.fulfill({ status: 204, headers: corsHeaders });
        return;
      }
      const existing = jobs.get(id);
      if (existing && existing.status !== "done" && existing.status !== "failed") {
        const nextPoll = (jobPolls.get(id) ?? 0) + 1;
        jobPolls.set(id, nextPoll);
        if (nextPoll === 1) {
          existing.status = "processing";
          existing.progress_percent = 48;
          existing.current_step = 5;
          existing.progress_label = "Step 5 of 10";
        } else {
          existing.status = "done";
          existing.progress_percent = 100;
          existing.current_step = 10;
          existing.eta_seconds = 0;
          existing.progress_label = "Complete";
          existing.completed_at = new Date("2026-05-13T12:01:00Z").toISOString();
        }
      }
      await fulfillJson(
        route,
        existing || {
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

async function signIn(page: Page, options?: Parameters<typeof mockApi>[1]) {
  await mockApi(page, options);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email or username").fill("creator");
  await page.getByLabel("Password").fill(" password123 ");
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

  await page.getByLabel("Email").fill(" Creator@Example.COM ");
  await page.getByLabel("Username").fill(" creator ");
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
  await expect(page.getByText("Reference control")).toBeVisible();
  await uploadImage(page);
  await page.getByRole("button", { name: /^Pose$/ }).click();
  await page.getByLabel("Fix face").check();
  await page.getByPlaceholder("Describe the image you want...").fill("cinematic portrait in neon rain");
  await page.getByRole("button", { name: "Generate" }).last().click();

  await expect(page.getByText("job-txt2img")).toBeVisible();
  await expect(page.getByText("done")).toBeVisible();
  await expect(page.getByRole("button", { name: /After/ })).toBeVisible();
});

test("generation completion notifies once and keeps before/after order", async ({ page }) => {
  let jobDetailRequests = 0;
  await signIn(page, {
    immediateJobCompletion: true,
    onJobDetailRequest: () => {
      jobDetailRequests += 1;
    }
  });

  await page.getByPlaceholder("Describe the image you want...").fill("comparison seed");
  await page.getByRole("button", { name: "Generate" }).last().click();

  await expect(page.getByText("Generation complete!")).toBeVisible();

  const afterClipPath = await page.getByAltText("After").evaluate((img) => (img.parentElement as HTMLElement | null)?.style.clipPath || "");
  expect(afterClipPath).toContain("0px 0px 0px 50%");

  await page.waitForTimeout(1500);
  expect(jobDetailRequests).toBeLessThanOrEqual(2);
});

test("reference controls disable modes whose ControlNet model is missing", async ({ page }) => {
  await mockApi(page, {
    controlnetModels: ["control_v11p_sd15_canny", "control_v11f1p_sd15_depth", "control_v11f1e_sd15_tile"]
  });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email or username").fill("creator");
  await page.getByLabel("Password").fill(" password123 ");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await uploadImage(page);
  await expect(page.getByRole("button", { name: "Edges" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Depth$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Pose$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Product" })).toBeEnabled();
});

test("reference controls enable all modes when union controlnet model is present", async ({ page }) => {
  await mockApi(page, {
    controlnetModels: ["xinsir_controlnet_union_sdxl_1.0"]
  });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email or username").fill("creator");
  await page.getByLabel("Password").fill(" password123 ");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await uploadImage(page);
  await expect(page.getByRole("button", { name: "Edges" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Depth$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Pose$/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Product" })).toBeEnabled();
});

test("upload workflows expose edit, upscale, sharpen, and expand controls without A1111", async ({ page }) => {
  await signIn(page);

  await page.getByRole("button", { name: "Edit" }).click();
  await uploadImage(page);
  await page.getByPlaceholder("Describe the change...").fill("make the sky dramatic");
  await page.getByRole("button", { name: "Edit image" }).click();
  await expect(page.getByText("job-img2img")).toBeVisible();

  await page.getByRole("navigation").getByRole("button", { name: /^Upscale$/ }).click();
  await uploadImage(page);
  await page.getByRole("combobox").first().selectOption("face_restore");
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
  await expect(page.getByTitle("Use in Edit")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Delete this history item?");
    await dialog.accept();
  });
  await page.getByTitle("Delete history item").click();
  await expect(page.getByText("No jobs yet.")).toBeVisible();
});

test("history output can be reused as an input for image tools", async ({ page }) => {
  await signIn(page);
  await page.getByPlaceholder("Describe the image you want...").fill("history reuse seed");
  await page.getByRole("button", { name: "Generate" }).last().click();
  await expect(page.getByText("job-txt2img")).toBeVisible();

  await page.getByRole("button", { name: "History" }).click();
  await page.getByTitle("Use in Upscale").click();

  await expect(page.getByRole("heading", { name: "Upscale" })).toBeVisible();
  await page.getByRole("button", { name: "Upscale" }).last().click();
  await expect(page.getByText("job-upscale")).toBeVisible();
});

test("dashboard remains usable on mobile width", async ({ page }) => {
  await signIn(page);

  await expect(page.getByRole("button", { name: "Generate" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "History" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(hasHorizontalOverflow).toBeFalsy();
});
