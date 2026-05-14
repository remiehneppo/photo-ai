"use client";

import { ActionButton } from "@/components/ActionButton";
import { HistoryGrid } from "@/components/HistoryGrid";
import { ImageResult } from "@/components/ImageResult";
import { ImageUpload } from "@/components/ImageUpload";
import { JobStatus } from "@/components/JobStatus";
import { PromptInput } from "@/components/PromptInput";
import { StyleSelector } from "@/components/StyleSelector";
import { clearToken, getToken } from "@/lib/auth";
import { editImage, generateImage, getCapabilities, listJobs, me, outpaintImage, sharpenImage, upscaleImage } from "@/lib/api";
import type { Capabilities, Direction, JobDetail, Style, User } from "@/types";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Brush, Clock3, Expand, ImageUp, LogOut, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Tab = "generate" | "edit" | "upscale" | "sharpen" | "outpaint" | "history";

const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "generate", label: "Generate", icon: <Sparkles className="h-4 w-4" /> },
  { id: "edit", label: "Edit", icon: <Brush className="h-4 w-4" /> },
  { id: "upscale", label: "Upscale", icon: <ImageUp className="h-4 w-4" /> },
  { id: "sharpen", label: "Sharpen", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { id: "outpaint", label: "Expand", icon: <Expand className="h-4 w-4" /> },
  { id: "history", label: "History", icon: <Clock3 className="h-4 w-4" /> }
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [tab, setTab] = useState<Tab>("generate");

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    me().then(setUser).catch(() => router.replace("/login"));
    getCapabilities().then(setCapabilities).catch(() => setCapabilities(null));
  }, [router]);

  function logout() {
    clearToken();
    router.push("/login");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Photo AI</h1>
            <p className="text-sm text-muted">{user ? user.email : "Loading account..."}</p>
            <CapabilitySummary capabilities={capabilities} />
          </div>
          <ActionButton variant="secondary" onClick={logout} icon={<LogOut className="h-4 w-4" />}>
            Sign out
          </ActionButton>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[220px_1fr]">
        <nav className="grid h-fit grid-cols-2 gap-2 rounded-md border border-line bg-white p-2 sm:grid-cols-3 lg:grid-cols-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`focus-ring flex h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold lg:justify-start ${
                tab === item.id ? "bg-accent text-white" : "text-ink hover:bg-panel"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {tab === "generate" && <GenerateTab />}
          {tab === "edit" && <EditTab />}
          {tab === "upscale" && <UpscaleTab />}
          {tab === "sharpen" && <SharpenTab />}
          {tab === "outpaint" && <OutpaintTab />}
          {tab === "history" && <HistoryTab />}
        </section>
      </div>
    </main>
  );
}

function CapabilitySummary({ capabilities }: { capabilities: Capabilities | null }) {
  if (!capabilities) return <p className="mt-1 text-xs text-muted">Checking AI engine...</p>;

  const enabled = [
    capabilities.controlnet_available ? "ControlNet" : null,
    capabilities.adetailer_available ? "ADetailer" : null,
    capabilities.sam_available ? "SAM" : null
  ].filter(Boolean);

  return (
    <p className="mt-1 text-xs text-muted">
      {capabilities.a1111_connected ? "A1111 connected" : "A1111 offline"} · {capabilities.checkpoints.length} checkpoints · {capabilities.upscalers.length} upscalers
      {enabled.length > 0 ? ` · ${enabled.join(", ")}` : ""}
    </p>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-panel p-4 sm:p-6">
      <h2 className="mb-5 text-xl font-bold">{title}</h2>
      {children}
    </div>
  );
}

function GenerateTab() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await generateImage({ prompt, style });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Generate">
      <form onSubmit={submit} className="grid gap-4">
        <StyleSelector value={style} onChange={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !prompt.trim()} icon={<Wand2 className="h-4 w-4" />}>
          {loading ? "Starting..." : "Generate"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function EditTab() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await editImage({ prompt, style, image: file });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start edit");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Edit">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <StyleSelector value={style} onChange={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the change..." />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file || !prompt.trim()} icon={<Brush className="h-4 w-4" />}>
          {loading ? "Starting..." : "Edit image"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function UpscaleTab() {
  const [mode, setMode] = useState("default");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await upscaleImage({ mode, image: file });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start upscale");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Upscale">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <select className="focus-ring h-11 rounded-md border border-line bg-white px-3" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="default">Default 4x</option>
          <option value="face_restore">Face restore</option>
          <option value="anime">Anime</option>
        </select>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<ImageUp className="h-4 w-4" />}>
          {loading ? "Starting..." : "Upscale"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function SharpenTab() {
  const [mode, setMode] = useState("default");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await sharpenImage({ mode, image: file });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sharpen");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Sharpen">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <select className="focus-ring h-11 rounded-md border border-line bg-white px-3" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="soft">Soft</option>
          <option value="default">Default</option>
          <option value="strong">Strong</option>
        </select>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<SlidersHorizontal className="h-4 w-4" />}>
          {loading ? "Starting..." : "Sharpen"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function OutpaintTab() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [direction, setDirection] = useState<Direction>("all");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await outpaintImage({ prompt, style, direction, image: file });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start expand");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Expand">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <DirectionSelector value={direction} onChange={setDirection} />
        <StyleSelector value={style} onChange={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Optional context for the new area..." />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<Expand className="h-4 w-4" />}>
          {loading ? "Starting..." : "Expand image"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function DirectionSelector({ value, onChange }: { value: Direction; onChange: (direction: Direction) => void }) {
  const directions: Array<{ value: Direction; label: string; icon: ReactNode }> = [
    { value: "left", label: "Left", icon: <ArrowLeft className="h-4 w-4" /> },
    { value: "right", label: "Right", icon: <ArrowRight className="h-4 w-4" /> },
    { value: "top", label: "Top", icon: <ArrowUp className="h-4 w-4" /> },
    { value: "bottom", label: "Bottom", icon: <ArrowDown className="h-4 w-4" /> },
    { value: "all", label: "All", icon: <Expand className="h-4 w-4" /> }
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {directions.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={`focus-ring flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition ${
            value === item.value ? "border-accent bg-accent text-white" : "border-line bg-white text-ink hover:bg-panel"
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function HistoryTab() {
  const [jobs, setJobs] = useState<JobDetail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setJobs(await listJobs());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadInitial() {
      try {
        const nextJobs = await listJobs();
        if (!cancelled) setJobs(nextJobs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadInitial();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel title="History">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{loading ? "Loading..." : `${jobs.length} jobs`}</p>
        <ActionButton variant="secondary" onClick={load}>
          Refresh
        </ActionButton>
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <HistoryGrid jobs={jobs} />
    </Panel>
  );
}
