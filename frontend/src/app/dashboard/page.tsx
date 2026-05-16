"use client";

import { ActionButton } from "@/components/ActionButton";
import { HistoryGrid } from "@/components/HistoryGrid";
import { ImageResult } from "@/components/ImageResult";
import { ImageUpload } from "@/components/ImageUpload";
import { JobStatus } from "@/components/JobStatus";
import { PromptInput } from "@/components/PromptInput";
import { StyleSelector } from "@/components/StyleSelector";
import { clearToken, getToken } from "@/lib/auth";
import { deleteJob, editImage, generateImage, generateImageWithReference, getCapabilities, getStyles, imageUrl, listJobs, me, outpaintImage, sharpenImage, upscaleImage } from "@/lib/api";
import type { Capabilities, ControlMode, Direction, HistoryImageTarget, ImageOut, JobDetail, Style, User } from "@/types";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Brush, Clock3, Expand, ImageUp, LogOut, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Tab = "generate" | "edit" | "upscale" | "sharpen" | "outpaint" | "history";
type HistoryImageSeed = { target: HistoryImageTarget; file: File };

const fallbackStyles = ["realistic", "anime", "advertisement", "portrait", "artistic", "natural"].map((style) => ({
  value: style,
  label: style
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}));

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
  const [styles, setStyles] = useState(fallbackStyles);
  const [tab, setTab] = useState<Tab>("generate");
  const [historyImageSeed, setHistoryImageSeed] = useState<HistoryImageSeed | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    me().then(setUser).catch(() => router.replace("/login"));
    getCapabilities().then(setCapabilities).catch(() => setCapabilities(null));
    getStyles()
      .then((data) => {
        const nextStyles = data.styles.map((style) => ({
          value: style,
          label: style
            .split("_")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ")
        }));
        if (nextStyles.length > 0) setStyles(nextStyles);
      })
      .catch(() => setStyles(fallbackStyles));
  }, [router]);

  function logout() {
    clearToken();
    router.push("/login");
  }

  function useHistoryImage(target: HistoryImageTarget, file: File) {
    setHistoryImageSeed({ target, file });
    setTab(target);
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
          {tab === "generate" && <GenerateTab capabilities={capabilities} styles={styles} />}
          {tab === "edit" && <EditTab capabilities={capabilities} styles={styles} historyImageSeed={historyImageSeed} />}
          {tab === "upscale" && <UpscaleTab historyImageSeed={historyImageSeed} />}
          {tab === "sharpen" && <SharpenTab historyImageSeed={historyImageSeed} />}
          {tab === "outpaint" && <OutpaintTab capabilities={capabilities} styles={styles} historyImageSeed={historyImageSeed} />}
          {tab === "history" && <HistoryTab onUseImage={useHistoryImage} />}
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

function GenerateTab({ capabilities, styles }: { capabilities: Capabilities | null; styles: typeof fallbackStyles }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [controlImage, setControlImage] = useState<File | null>(null);
  const [controlMode, setControlMode] = useState<ControlMode>("edges");
  const [controlWeight, setControlWeight] = useState(0.7);
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
      const job = controlImage
        ? await generateImageWithReference({ prompt, style, control_image: controlImage, control_mode: controlMode, control_weight: controlWeight, fix_face: fixFace, fix_hands: fixHands })
        : await generateImage({ prompt, style, fix_face: fixFace, fix_hands: fixHands });
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
        <StyleSelector value={style} onChange={setStyle} styles={styles} />
        <PromptInput value={prompt} onChange={setPrompt} />
        <ReferenceControl
          capabilities={capabilities}
          file={controlImage}
          mode={controlMode}
          weight={controlWeight}
          onFile={setControlImage}
          onMode={setControlMode}
          onWeight={setControlWeight}
        />
        <FixOptions capabilities={capabilities} fixFace={fixFace} fixHands={fixHands} onFixFace={setFixFace} onFixHands={setFixHands} />
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

function EditTab({ capabilities, styles, historyImageSeed }: { capabilities: Capabilities | null; styles: typeof fallbackStyles; historyImageSeed: HistoryImageSeed | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [controlImage, setControlImage] = useState<File | null>(null);
  const [controlMode, setControlMode] = useState<ControlMode>("edges");
  const [controlWeight, setControlWeight] = useState(0.7);
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "edit" ? historyImageSeed.file : null));
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
      const job = await editImage({
        prompt,
        style,
        image: file,
        fix_face: fixFace,
        fix_hands: fixHands,
        control_image: controlImage,
        control_mode: controlMode,
        control_weight: controlWeight
      });
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
        <StyleSelector value={style} onChange={setStyle} styles={styles} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the change..." />
        <ReferenceControl
          capabilities={capabilities}
          file={controlImage}
          mode={controlMode}
          weight={controlWeight}
          onFile={setControlImage}
          onMode={setControlMode}
          onWeight={setControlWeight}
        />
        <FixOptions capabilities={capabilities} fixFace={fixFace} fixHands={fixHands} onFixFace={setFixFace} onFixHands={setFixHands} />
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

function UpscaleTab({ historyImageSeed }: { historyImageSeed: HistoryImageSeed | null }) {
  const [mode, setMode] = useState("default");
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "upscale" ? historyImageSeed.file : null));
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

function SharpenTab({ historyImageSeed }: { historyImageSeed: HistoryImageSeed | null }) {
  const [mode, setMode] = useState("default");
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "sharpen" ? historyImageSeed.file : null));
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

function ReferenceControl({
  capabilities,
  file,
  mode,
  weight,
  onFile,
  onMode,
  onWeight
}: {
  capabilities: Capabilities | null;
  file: File | null;
  mode: ControlMode;
  weight: number;
  onFile: (file: File | null) => void;
  onMode: (mode: ControlMode) => void;
  onWeight: (weight: number) => void;
}) {
  const controlnetModels = capabilities?.controlnet_models ?? [];
  const available = Boolean(capabilities?.controlnet_available && controlnetModels.length > 0);
  const modes: Array<{ value: ControlMode; label: string; keyword: string }> = [
    { value: "edges", label: "Edges", keyword: "canny" },
    { value: "depth", label: "Depth", keyword: "depth" },
    { value: "pose", label: "Pose", keyword: "openpose" },
    { value: "product_layout", label: "Product", keyword: "canny" }
  ];
  const hasModeModel = (keyword: string) => controlnetModels.some((model) => model.toLowerCase().includes(keyword));

  return (
    <div className="grid gap-3 rounded-md border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Reference control</div>
          <div className="text-xs text-muted">{available ? `${controlnetModels.length} ControlNet models available` : "ControlNet model is not available in A1111."}</div>
        </div>
        {file && (
          <button type="button" className="focus-ring rounded-md border border-line px-3 py-2 text-xs font-semibold hover:bg-panel" onClick={() => onFile(null)}>
            Clear
          </button>
        )}
      </div>
      {available && (
        <>
          <ImageUpload file={file} onChange={onFile} />
          <div className="grid gap-2 sm:grid-cols-4">
            {modes.map((item) => {
              const modeAvailable = hasModeModel(item.keyword);
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={!modeAvailable}
                  onClick={() => onMode(item.value)}
                  className={`focus-ring h-10 rounded-md border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                    mode === item.value ? "border-accent bg-accent text-white" : "border-line bg-white text-ink hover:bg-panel"
                  }`}
                  title={modeAvailable ? item.label : `${item.label} ControlNet model is not available`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <label className="grid gap-2 text-sm font-semibold">
            Strength
            <input
              type="range"
              min="0.1"
              max="1.5"
              step="0.1"
              value={weight}
              onChange={(event) => onWeight(Number(event.target.value))}
              className="accent-accent"
            />
            <span className="text-xs text-muted">{weight.toFixed(1)}</span>
          </label>
        </>
      )}
    </div>
  );
}

function OutpaintTab({ capabilities, styles, historyImageSeed }: { capabilities: Capabilities | null; styles: typeof fallbackStyles; historyImageSeed: HistoryImageSeed | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [direction, setDirection] = useState<Direction>("all");
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "outpaint" ? historyImageSeed.file : null));
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
      const job = await outpaintImage({ prompt, style, direction, image: file, fix_face: fixFace, fix_hands: fixHands });
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
        <StyleSelector value={style} onChange={setStyle} styles={styles} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Optional context for the new area..." />
        <FixOptions capabilities={capabilities} fixFace={fixFace} fixHands={fixHands} onFixFace={setFixFace} onFixHands={setFixHands} />
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

function FixOptions({
  capabilities,
  fixFace,
  fixHands,
  onFixFace,
  onFixHands
}: {
  capabilities: Capabilities | null;
  fixFace: boolean;
  fixHands: boolean;
  onFixFace: (value: boolean) => void;
  onFixHands: (value: boolean) => void;
}) {
  const available = capabilities?.adetailer_available ?? false;

  return (
    <div className="grid gap-2 rounded-md border border-line bg-white p-3 sm:grid-cols-2">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input className="h-4 w-4 accent-accent" type="checkbox" disabled={!available} checked={available && fixFace} onChange={(event) => onFixFace(event.target.checked)} />
        Fix face
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input className="h-4 w-4 accent-accent" type="checkbox" disabled={!available} checked={available && fixHands} onChange={(event) => onFixHands(event.target.checked)} />
        Fix hands
      </label>
      {!available && <p className="text-xs text-muted sm:col-span-2">ADetailer is not available in A1111.</p>}
    </div>
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

function HistoryTab({ onUseImage }: { onUseImage: (target: HistoryImageTarget, file: File) => void }) {
  const [jobs, setJobs] = useState<JobDetail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);

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

  async function removeJob(job: JobDetail) {
    if (!window.confirm("Delete this history item? This cannot be undone.")) return;
    setBusyJobId(job.id);
    setError("");
    try {
      await deleteJob(job.id);
      setJobs((current) => current.filter((item) => item.id !== job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete history item");
    } finally {
      setBusyJobId(null);
    }
  }

  async function useImage(target: HistoryImageTarget, image: ImageOut) {
    setBusyImageId(image.id);
    setError("");
    try {
      const response = await fetch(imageUrl(image.url));
      if (!response.ok) throw new Error("Could not load image from history");
      const blob = await response.blob();
      const filename = image.filename || "history-image.png";
      onUseImage(target, new File([blob], filename, { type: blob.type || "image/png" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not use history image");
    } finally {
      setBusyImageId(null);
    }
  }

  return (
    <Panel title="History">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{loading ? "Loading..." : `${jobs.length} jobs`}</p>
        <ActionButton variant="secondary" onClick={load}>
          Refresh
        </ActionButton>
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <HistoryGrid jobs={jobs} busyJobId={busyJobId} busyImageId={busyImageId} onDelete={removeJob} onUseImage={useImage} />
    </Panel>
  );
}
