export type Style = "realistic" | "anime" | "advertisement" | "portrait" | "artistic";
export type Direction = "left" | "right" | "top" | "bottom" | "all";
export type JobStatus = "pending" | "processing" | "done" | "failed";

export type User = {
  id: string;
  email: string;
  username: string;
};

export type Capabilities = {
  a1111_connected: boolean;
  checkpoints: string[];
  upscalers: string[];
  extensions: string[];
  controlnet_available: boolean;
  controlnet_models: string[];
  adetailer_available: boolean;
  sam_available: boolean;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
};

export type JobResponse = {
  job_id: string;
  status: JobStatus;
};

export type ImageOut = {
  id: string;
  type: "input" | "output";
  url: string;
  filename?: string | null;
};

export type JobDetail = {
  id: string;
  feature: string;
  style?: string | null;
  user_prompt?: string | null;
  status: JobStatus;
  progress_percent: number;
  current_step?: number | null;
  total_steps?: number | null;
  eta_seconds?: number | null;
  estimated_seconds?: number | null;
  progress_label?: string | null;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
  images: ImageOut[];
};

export type ApiError = {
  detail?: string;
};
