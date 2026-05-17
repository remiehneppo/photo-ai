export type Style = string;
export type Direction = "left" | "right" | "top" | "bottom" | "all";
export type ControlMode = "edges" | "depth" | "pose" | "product_layout";
export type JobStatus = "pending" | "processing" | "done" | "failed";
export type HistoryImageTarget = "edit" | "upscale" | "sharpen" | "outpaint" | "inpaint";

export type User = {
  id: string;
  email: string;
  username: string;
};

export type Capabilities = {
  a1111_connected: boolean;
  checkpoints: string[];
  upscalers: string[];
  samplers: string[];
  extensions: string[];
  controlnet_available: boolean;
  controlnet_models: string[];
  adetailer_available: boolean;
  sam_available: boolean;
};

export type StyleOption = {
  value: Style;
  label: string;
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
  seed?: number | null;
  created_at: string;
  completed_at?: string | null;
  images: ImageOut[];
};

export type JobListResponse = {
  total: number;
  items: JobDetail[];
};

export type ApiError = {
  detail?: string;
};

export type Suggestions = {
  prompts_by_task: Record<string, Record<string, string[]>>;
  style_keywords: Record<string, string[]>;
};
