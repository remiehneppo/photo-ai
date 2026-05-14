"use client";

import { clearToken, getToken, setToken } from "@/lib/auth";
import type { Capabilities, ControlMode, Direction, JobDetail, JobResponse, Style, TokenResponse, User } from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function readError(response: Response) {
  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail || response.statusText;
  } catch {
    return response.statusText;
  }
}

async function request<T>(path: string, init: RequestInit = {}) {
  const token = getToken();
  const headers = new Headers(init.headers);
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
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as T;
}

export function imageUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
}

export async function register(payload: { email: string; username: string; password: string }) {
  return request<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function login(email: string, password: string) {
  const form = new URLSearchParams();
  form.set("username", email);
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

export function generateImage(payload: { prompt: string; style: Style; fix_face?: boolean; fix_hands?: boolean }) {
  return request<JobResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(payload)
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
}) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("control_image", payload.control_image);
  form.set("control_mode", payload.control_mode);
  form.set("control_weight", String(payload.control_weight));
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
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
}) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("image", payload.image);
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  if (payload.control_image) {
    form.set("control_image", payload.control_image);
    form.set("control_mode", payload.control_mode || "edges");
    form.set("control_weight", String(payload.control_weight ?? 0.7));
  }
  return request<JobResponse>("/api/edit", { method: "POST", body: form });
}

export function upscaleImage(payload: { mode: string; image: File }) {
  const form = new FormData();
  form.set("mode", payload.mode);
  form.set("image", payload.image);
  return request<JobResponse>("/api/upscale", { method: "POST", body: form });
}

export function sharpenImage(payload: { mode: string; image: File }) {
  const form = new FormData();
  form.set("mode", payload.mode);
  form.set("image", payload.image);
  return request<JobResponse>("/api/sharpen", { method: "POST", body: form });
}

export function outpaintImage(payload: { prompt: string; style: Style; direction: Direction; image: File; fix_face?: boolean; fix_hands?: boolean }) {
  const form = new FormData();
  form.set("prompt", payload.prompt);
  form.set("style", payload.style);
  form.set("direction", payload.direction);
  form.set("image", payload.image);
  form.set("fix_face", String(Boolean(payload.fix_face)));
  form.set("fix_hands", String(Boolean(payload.fix_hands)));
  return request<JobResponse>("/api/outpaint", { method: "POST", body: form });
}

export function getJob(id: string) {
  return request<JobDetail>(`/api/jobs/${id}`);
}

export function listJobs() {
  return request<JobDetail[]>("/api/jobs");
}
