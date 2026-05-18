"use client";

import { clearToken, getToken, setToken } from "@/lib/auth";
import type { Capabilities, ControlMode, Direction, JobDetail, JobListResponse, JobResponse, Style, Suggestions, TokenResponse, User } from "@/types";

const API_PORT = process.env.NEXT_PUBLIC_API_PORT || "8000";

function getApiBase() {
  const explicitBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (explicitBase) return explicitBase;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  }
  return `http://localhost:${API_PORT}`;
}

const API_BASE = getApiBase();

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { detail?: string | Array<{ msg?: string }> };
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((item) => item.msg).filter(Boolean).join(", ") || response.statusText;
    }
    return response.statusText;
  } catch {
    return response.statusText;
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
  const method = init.method || "GET";
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  if (response.status === 401) clearToken();
  if (!response.ok) {
    const message = await readError(response);
    logApiError({ path, method, status: response.status, requestId: response.headers.get("x-request-id"), message });
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function logApiError(error: { path: string; method: string; status: number; requestId: string | null; message: string }) {
  if (typeof window === "undefined") return;
  console.error("[photo-ai] API request failed", error);
}

export function imageUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

export async function fetchImageBlob(url: string) {
  const token = getToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(imageUrl(url), { headers, cache: "no-store" });
  if (response.status === 401) clearToken();
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return response.blob();
}

export async function register(payload: { email: string; username: string; password: string }) {
  const normalized = {
    email: payload.email.trim().toLowerCase(),
    username: payload.username.trim(),
    password: payload.password
  };
  return request<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify(normalized)
  });
}

export async function login(identifier: string, password: string) {
  const form = new URLSearchParams();
  const normalizedIdentifier = identifier.includes("@") ? identifier.trim().toLowerCase() : identifier.trim();
  form.set("username", normalizedIdentifier);
  form.set("password", password);
  const data = await request<TokenResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form
  });
  setToken(data.access_token);
  return data;
}

export function me() {
  return request<User>("/auth/me");
}

export function getCapabilities() {
  return request<Capabilities>("/api/capabilities");
}

export function getStyles() {
  return request<{ styles: Style[] }>("/api/generate/styles");
}

export function generateImage(payload: {
  prompt: string;
  style: Style;
  fix_face?: boolean;
  fix_hands?: boolean;
  seed?: number | null;
  aspect_ratio?: string | null;
  negative_prompt?: string | null;
  steps?: number | null;
  cfg_scale?: number | null;
  sampler_name?: string | null;
  batch_count?: number;
  tiling?: boolean;
  checkpoint?: string | null;
}) {
  const body: Record<string, unknown> = { ...payload };
  // Clean up nulls to avoid sending them unnecessarily
  Object.keys(body).forEach((k) => body[k] == null && delete body[k]);
  return request<JobResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function generateImageWithReference(payload: {
  prompt: string;
  style: Style;
  control_image: File;
  control_mode: ControlMode;
  control_weight: number;
  fix_face?: boolean;
  fix_hands?: boolean;
  seed?: number | null;
}) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("control_image", payload.control_image);
  form.set("control_mode", payload.control_mode);
  form.set("control_weight", String(payload.control_weight));
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  if (payload.seed != null) form.set("seed", String(payload.seed));
  return request<JobResponse>("/api/generate/reference", { method: "POST", body: form });
}

export function editImage(payload: {
  prompt: string;
  style: Style;
  image: File;
  fix_face?: boolean;
  fix_hands?: boolean;
  control_image?: File | null;
  control_mode?: ControlMode;
  control_weight?: number;
  seed?: number | null;
  denoising_strength?: number | null;
  negative_prompt?: string | null;
  steps?: number | null;
  cfg_scale?: number | null;
  sampler_name?: string | null;
  tiling?: boolean;
  checkpoint?: string | null;
}) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("image", payload.image);
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  if (payload.seed != null) form.set("seed", String(payload.seed));
  if (payload.denoising_strength != null) form.set("denoising_strength", String(payload.denoising_strength));
  if (payload.negative_prompt) form.set("negative_prompt", payload.negative_prompt);
  if (payload.steps != null) form.set("steps", String(payload.steps));
  if (payload.cfg_scale != null) form.set("cfg_scale", String(payload.cfg_scale));
  if (payload.sampler_name) form.set("sampler_name", payload.sampler_name);
  if (payload.tiling) form.set("tiling", "true");
  if (payload.checkpoint) form.set("checkpoint", payload.checkpoint);
  if (payload.control_image) {
    form.set("control_image", payload.control_image);
    form.set("control_mode", payload.control_mode || "edges");
    form.set("control_weight", String(payload.control_weight ?? 0.7));
  }
  return request<JobResponse>("/api/edit", { method: "POST", body: form });
}

export function upscaleImage(payload: { mode: string; image: File; upscaler?: string | null }) {
  const form = new FormData();
  form.set("mode", payload.mode);
  form.set("image", payload.image);
  if (payload.upscaler) form.set("upscaler", payload.upscaler);
  return request<JobResponse>("/api/upscale", { method: "POST", body: form });
}

export function sharpenImage(payload: { mode: string; image: File }) {
  const form = new FormData();
  form.set("mode", payload.mode);
  form.set("image", payload.image);
  return request<JobResponse>("/api/sharpen", { method: "POST", body: form });
}

export function outpaintImage(payload: { prompt: string; style: Style; direction: Direction; image: File; fix_face?: boolean; fix_hands?: boolean; seed?: number | null }) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("direction", payload.direction);
  form.set("image", payload.image);
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  if (payload.seed != null) form.set("seed", String(payload.seed));
  return request<JobResponse>("/api/outpaint", { method: "POST", body: form });
}

export function getJob(id: string) {
  return request<JobDetail>(`/api/jobs/${id}`);
}

export function listJobs(feature?: string) {
  const params = feature ? `?feature=${encodeURIComponent(feature)}` : "";
  return request<JobListResponse>(`/api/jobs${params}`);
}

export function inpaintImage(payload: {
  prompt: string;
  style: Style;
  image: File;
  mask: File;
  fix_face?: boolean;
  fix_hands?: boolean;
  inpaint_full_res?: boolean;
  seed?: number | null;
  denoising_strength?: number | null;
}) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("image", payload.image);
  form.set("mask", payload.mask);
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  form.set("inpaint_full_res", String(payload.inpaint_full_res !== false));
  if (payload.seed != null) form.set("seed", String(payload.seed));
  if (payload.denoising_strength != null) form.set("denoising_strength", String(payload.denoising_strength));
  return request<JobResponse>("/api/inpaint", { method: "POST", body: form });
}

export function interrogateImage(image: File) {
  const form = new FormData();
  form.set("image", image);
  return request<{ prompt: string }>("/api/interrogate", { method: "POST", body: form });
}

export function cancelJob(id: string) {
  return request<{ status: string }>(`/api/jobs/${id}/cancel`, { method: "POST" });
}

export function deleteJob(id: string) {
  return request<void>(`/api/jobs/${id}`, { method: "DELETE" });
}

export function getSuggestions() {
  return request<Suggestions>("/api/suggestions");
}

export function faceRestoreImage(payload: { image: File; mode?: string }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("mode", payload.mode ?? "gfpgan");
  return request<{ job_id: string; status: string }>("/api/face-restore", { method: "POST", body: fd });
}

export function createVariations(payload: { image: File; style?: string; prompt?: string; denoising_strength?: number; num_variations?: number }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("style", payload.style ?? "realistic");
  if (payload.prompt) fd.append("prompt", payload.prompt);
  fd.append("denoising_strength", String(payload.denoising_strength ?? 0.3));
  fd.append("num_variations", String(payload.num_variations ?? 2));
  return request<{ job_id: string; status: string }>("/api/variations", { method: "POST", body: fd });
}

export function sketchToPhoto(payload: { image: File; prompt: string; style?: string; controlnet_mode?: string; controlnet_weight?: number; seed?: number | null }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("prompt", payload.prompt);
  fd.append("style", payload.style ?? "realistic");
  fd.append("controlnet_mode", payload.controlnet_mode ?? "scribble");
  fd.append("controlnet_weight", String(payload.controlnet_weight ?? 0.8));
  if (payload.seed != null) fd.append("seed", String(payload.seed));
  return request<{ job_id: string; status: string }>("/api/sketch-to-photo", { method: "POST", body: fd });
}

export function poseControl(payload: { pose_image: File; prompt: string; style?: string; controlnet_weight?: number; seed?: number | null }) {
  const fd = new FormData();
  fd.append("pose_image", payload.pose_image);
  fd.append("prompt", payload.prompt);
  fd.append("style", payload.style ?? "realistic");
  fd.append("controlnet_weight", String(payload.controlnet_weight ?? 0.8));
  if (payload.seed != null) fd.append("seed", String(payload.seed));
  return request<{ job_id: string; status: string }>("/api/pose-control", { method: "POST", body: fd });
}

export function depthGuide(payload: { reference_image: File; prompt: string; style?: string; controlnet_weight?: number; seed?: number | null }) {
  const fd = new FormData();
  fd.append("reference_image", payload.reference_image);
  fd.append("prompt", payload.prompt);
  fd.append("style", payload.style ?? "realistic");
  fd.append("controlnet_weight", String(payload.controlnet_weight ?? 0.7));
  if (payload.seed != null) fd.append("seed", String(payload.seed));
  return request<{ job_id: string; status: string }>("/api/depth-guide", { method: "POST", body: fd });
}

export function restorePhoto(payload: { image: File; mode?: string }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("mode", payload.mode ?? "default");
  return request<{ job_id: string; status: string }>("/api/restore", { method: "POST", body: fd });
}

export function enhancePrompt(prompt: string, style: string = "realistic") {
  return request<{ prompt: string }>("/api/generate/enhance-prompt", {
    method: "POST",
    body: JSON.stringify({ prompt, style })
  });
}

export function upscaleBatch(payload: { images: File[]; mode?: string }) {
  const fd = new FormData();
  for (const img of payload.images) fd.append("images", img);
  fd.append("mode", payload.mode ?? "default");
  return request<{ job_id: string; status: string }>("/api/upscale/batch", { method: "POST", body: fd });
}

export function backgroundSegment(payload: { image: File; point_x: number; point_y: number; point_label?: number }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("point_x", String(payload.point_x));
  fd.append("point_y", String(payload.point_y));
  fd.append("point_label", String(payload.point_label ?? 1));
  return request<{ mask_b64: string }>("/api/background/segment", { method: "POST", body: fd });
}

export function backgroundReplace(payload: { image: File; mask_b64: string; background_prompt: string; style?: string }) {
  const fd = new FormData();
  fd.append("image", payload.image);
  fd.append("mask_b64", payload.mask_b64);
  fd.append("background_prompt", payload.background_prompt);
  fd.append("style", payload.style ?? "realistic");
  return request<{ job_id: string; status: string }>("/api/background/replace", { method: "POST", body: fd });
}
