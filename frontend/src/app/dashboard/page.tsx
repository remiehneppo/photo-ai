"use client";

import { ActionButton } from "@/components/ActionButton";
import { HistoryGrid } from "@/components/HistoryGrid";
import { ImageResult } from "@/components/ImageResult";
import { ImageUpload } from "@/components/ImageUpload";
import InpaintCanvas, { type InpaintCanvasHandle } from "@/components/InpaintCanvas";
import { JobStatus } from "@/components/JobStatus";
import { PromptInput } from "@/components/PromptInput";
import { StyleSelector } from "@/components/StyleSelector";
import { PromptSuggestions } from "@/components/PromptSuggestions";
import { clearToken, getToken } from "@/lib/auth";
import { createVariations, deleteJob, depthGuide, editImage, faceRestoreImage, generateImage, generateImageWithReference, getCapabilities, getSuggestions, getStyles, imageUrl, inpaintImage, interrogateImage, listJobs, me, outpaintImage, poseControl, restorePhoto, sharpenImage, sketchToPhoto, upscaleImage } from "@/lib/api";
import type { Capabilities, ControlMode, Direction, HistoryImageTarget, ImageOut, JobDetail, Style, Suggestions, User } from "@/types";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Brush, Clock3, Expand, ImageUp, Layers, Loader2, LogOut, PenTool, RefreshCw, SlidersHorizontal, Sparkles, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Tab = "generate" | "edit" | "inpaint" | "upscale" | "sharpen" | "outpaint" | "face_restore" | "variations" | "sketch" | "pose" | "depth" | "restore" | "history";
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
  { id: "inpaint", label: "Inpaint", icon: <PenTool className="h-4 w-4" /> },
  { id: "upscale", label: "Upscale", icon: <ImageUp className="h-4 w-4" /> },
  { id: "sharpen", label: "Sharpen", icon: <SlidersHorizontal className="h-4 w-4" /> },
  { id: "outpaint", label: "Expand", icon: <Expand className="h-4 w-4" /> },
  { id: "face_restore", label: "Face Restore", icon: <Wand2 className="h-4 w-4" /> },
  { id: "variations", label: "Variations", icon: <Layers className="h-4 w-4" /> },
  { id: "sketch", label: "Sketch→Photo", icon: <RefreshCw className="h-4 w-4" /> },
  { id: "pose", label: "Pose Control", icon: <Wand2 className="h-4 w-4" /> },
  { id: "depth", label: "Depth Guide", icon: <Layers className="h-4 w-4" /> },
  { id: "restore", label: "Restore Photo", icon: <RefreshCw className="h-4 w-4" /> },
  { id: "history", label: "History", icon: <Clock3 className="h-4 w-4" /> }
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [styles, setStyles] = useState(fallbackStyles);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [tab, setTab] = useState<Tab>("generate");
  const [historyImageSeed, setHistoryImageSeed] = useState<HistoryImageSeed | null>(null);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    me().then(setUser).catch(() => router.replace("/login"));
    getCapabilities().then(setCapabilities).catch(() => setCapabilities(null));
    getSuggestions().then(setSuggestions).catch(() => setSuggestions(null));
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
          {tab === "generate" && <GenerateTab capabilities={capabilities} styles={styles} suggestions={suggestions} />}
          {tab === "edit" && <EditTab capabilities={capabilities} styles={styles} historyImageSeed={historyImageSeed} suggestions={suggestions} />}
          {tab === "inpaint" && <InpaintTab styles={styles} historyImageSeed={historyImageSeed} suggestions={suggestions} />}
          {tab === "upscale" && <UpscaleTab historyImageSeed={historyImageSeed} />}
          {tab === "sharpen" && <SharpenTab historyImageSeed={historyImageSeed} />}
          {tab === "outpaint" && <OutpaintTab capabilities={capabilities} styles={styles} historyImageSeed={historyImageSeed} suggestions={suggestions} />}
          {tab === "face_restore" && <FaceRestoreTab />}
          {tab === "variations" && <VariationsTab styles={styles} />}
          {tab === "sketch" && <SketchToPhotoTab styles={styles} />}
          {tab === "pose" && <PoseControlTab styles={styles} />}
          {tab === "depth" && <DepthGuideTab styles={styles} />}
          {tab === "restore" && <RestorePhotoTab />}
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

function GenerateTab({ capabilities, styles, suggestions }: { capabilities: Capabilities | null; styles: typeof fallbackStyles; suggestions: Suggestions | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [controlImage, setControlImage] = useState<File | null>(null);
  const [controlMode, setControlMode] = useState<ControlMode>("edges");
  const [controlWeight, setControlWeight] = useState(0.7);
  const [seed, setSeed] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allExamples = Object.values(suggestions?.prompts_by_task?.["generate"] ?? {}).flat();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const seedValue = parseOptionalNumber(seed);
      const job = controlImage
        ? await generateImageWithReference({ prompt, style, control_image: controlImage, control_mode: controlMode, control_weight: controlWeight, fix_face: fixFace, fix_hands: fixHands, seed: seedValue })
        : await generateImage({ prompt, style, fix_face: fixFace, fix_hands: fixHands, seed: seedValue });
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
        <StyleSuggestionBanner prompt={prompt} currentStyle={style} styleKeywords={suggestions?.style_keywords ?? {}} onApply={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} suggestions={allExamples} />
        {suggestions && (
          <PromptSuggestions promptsByTask={suggestions.prompts_by_task} task="generate" currentStyle={style} onSelect={setPrompt} />
        )}
        <SeedField value={seed} onChange={setSeed} />
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
        <ImageResult job={result} onUseSeed={(s) => setSeed(String(s))} />
      </div>
    </Panel>
  );
}

function EditTab({ capabilities, styles, historyImageSeed, suggestions }: { capabilities: Capabilities | null; styles: typeof fallbackStyles; historyImageSeed: HistoryImageSeed | null; suggestions: Suggestions | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [controlImage, setControlImage] = useState<File | null>(null);
  const [controlMode, setControlMode] = useState<ControlMode>("edges");
  const [controlWeight, setControlWeight] = useState(0.7);
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "edit" ? historyImageSeed.file : null));
  const [seed, setSeed] = useState("");
  const [denoisingStrength, setDenoisingStrength] = useState<number | null>(null);
  const [interrogating, setInterrogating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allExamples = Object.values(suggestions?.prompts_by_task?.["edit"] ?? {}).flat();

  async function handleSuggestPrompt() {
    if (!file || interrogating) return;
    setInterrogating(true);
    setError("");
    try {
      const response = await interrogateImage(file);
      setPrompt(response.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suggest prompt");
    } finally {
      setInterrogating(false);
    }
  }

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
        control_weight: controlWeight,
        seed: parseOptionalNumber(seed),
        denoising_strength: denoisingStrength
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
        {file && <SuggestPromptButton loading={interrogating} onClick={handleSuggestPrompt} />}
        <StyleSelector value={style} onChange={setStyle} styles={styles} />
        <StyleSuggestionBanner prompt={prompt} currentStyle={style} styleKeywords={suggestions?.style_keywords ?? {}} onApply={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the change..." suggestions={allExamples} />
        {suggestions && (
          <PromptSuggestions promptsByTask={suggestions.prompts_by_task} task="edit" currentStyle={style} onSelect={setPrompt} />
        )}
        <SeedField value={seed} onChange={setSeed} />
        <DenoisingControl value={denoisingStrength} defaultValue={0.55} onChange={setDenoisingStrength} />
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
        <ImageResult job={result} onUseSeed={(s) => setSeed(String(s))} />
      </div>
    </Panel>
  );
}

function InpaintTab({ styles, historyImageSeed, suggestions }: { styles: typeof fallbackStyles; historyImageSeed: HistoryImageSeed | null; suggestions: Suggestions | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "inpaint" ? historyImageSeed.file : null));
  const [seed, setSeed] = useState("");
  const [denoisingStrength, setDenoisingStrength] = useState<number | null>(null);
  const [interrogating, setInterrogating] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<InpaintCanvasHandle>(null);

  const allExamples = Object.values(suggestions?.prompts_by_task?.["inpaint"] ?? {}).flat();

  async function handleSuggestPrompt() {
    if (!file || interrogating) return;
    setInterrogating(true);
    setError("");
    try {
      const response = await interrogateImage(file);
      setPrompt(response.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not suggest prompt");
    } finally {
      setInterrogating(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    if (!canvasRef.current?.hasMask()) {
      setError("Please paint the area you want to change first.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const maskBlob = await canvasRef.current.getMaskBlob();
      const maskFile = new File([maskBlob], "mask.png", { type: "image/png" });
      const job = await inpaintImage({
        prompt,
        style,
        image: file,
        mask: maskFile,
        seed: parseOptionalNumber(seed),
        denoising_strength: denoisingStrength
      });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start inpaint");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Inpaint">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        {file && <SuggestPromptButton loading={interrogating} onClick={handleSuggestPrompt} />}
        {file && (
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Paint the area to change</p>
            <InpaintCanvas ref={canvasRef} imageFile={file} />
          </div>
        )}
        <StyleSelector value={style} onChange={setStyle} styles={styles} />
        <StyleSuggestionBanner prompt={prompt} currentStyle={style} styleKeywords={suggestions?.style_keywords ?? {}} onApply={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe what should appear in the selected area..." suggestions={allExamples} />
        {suggestions && (
          <PromptSuggestions promptsByTask={suggestions.prompts_by_task} task="inpaint" currentStyle={style} onSelect={setPrompt} />
        )}
        <SeedField value={seed} onChange={setSeed} />
        <DenoisingControl value={denoisingStrength} defaultValue={0.75} onChange={setDenoisingStrength} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file || !prompt.trim()} icon={<PenTool className="h-4 w-4" />}>
          {loading ? "Starting..." : "Inpaint selected area"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} onUseSeed={(s) => setSeed(String(s))} />
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

function OutpaintTab({ capabilities, styles, historyImageSeed, suggestions }: { capabilities: Capabilities | null; styles: typeof fallbackStyles; historyImageSeed: HistoryImageSeed | null; suggestions: Suggestions | null }) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("realistic");
  const [fixFace, setFixFace] = useState(false);
  const [fixHands, setFixHands] = useState(false);
  const [direction, setDirection] = useState<Direction>("all");
  const [file, setFile] = useState<File | null>(() => (historyImageSeed?.target === "outpaint" ? historyImageSeed.file : null));
  const [seed, setSeed] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const allExamples = Object.values(suggestions?.prompts_by_task?.["outpaint"] ?? {}).flat();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    setResult(null);
    try {
      const job = await outpaintImage({ prompt, style, direction, image: file, fix_face: fixFace, fix_hands: fixHands, seed: parseOptionalNumber(seed) });
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
        <StyleSuggestionBanner prompt={prompt} currentStyle={style} styleKeywords={suggestions?.style_keywords ?? {}} onApply={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Optional context for the new area..." suggestions={allExamples} />
        {suggestions && (
          <PromptSuggestions promptsByTask={suggestions.prompts_by_task} task="outpaint" currentStyle={style} onSelect={setPrompt} />
        )}
        <SeedField value={seed} onChange={setSeed} />
        <FixOptions capabilities={capabilities} fixFace={fixFace} fixHands={fixHands} onFixFace={setFixFace} onFixHands={setFixHands} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<Expand className="h-4 w-4" />}>
          {loading ? "Starting..." : "Expand image"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} onUseSeed={(s) => setSeed(String(s))} />
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
  const [total, setTotal] = useState(0);
  const [featureFilter, setFeatureFilter] = useState<string>("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [busyImageId, setBusyImageId] = useState<string | null>(null);

  const load = useCallback(async (feature?: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await listJobs(feature || undefined);
      setJobs(data.items);
      setTotal(data.total);
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
        const data = await listJobs();
        if (!cancelled) {
          setJobs(data.items);
          setTotal(data.total);
        }
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

  function changeFilter(feature: string) {
    setFeatureFilter(feature);
    load(feature);
  }

  const featureFilters = [
    { value: "", label: "All" },
    { value: "txt2img", label: "Generate" },
    { value: "img2img", label: "Edit" },
    { value: "inpaint", label: "Inpaint" },
    { value: "upscale", label: "Upscale" },
    { value: "sharpen", label: "Sharpen" },
    { value: "outpaint", label: "Expand" },
  ];

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{loading ? "Loading..." : `${total} jobs`}</p>
        <ActionButton variant="secondary" onClick={() => load(featureFilter)}>
          Refresh
        </ActionButton>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {featureFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => changeFilter(f.value)}
            className={`focus-ring rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              featureFilter === f.value ? "border-accent bg-accent text-white" : "border-line bg-white text-ink hover:bg-panel"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      <HistoryGrid jobs={jobs} busyJobId={busyJobId} busyImageId={busyImageId} onDelete={removeJob} onUseImage={useImage} />
    </Panel>
  );
}

function SeedField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2 text-sm font-semibold">
      Seed
      <input
        type="number"
        step="1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="-1 for random"
        className="focus-ring h-11 rounded-md border border-line bg-white px-3 text-sm"
      />
      <span className="text-xs font-normal text-muted">Leave blank for random, or enter a seed to reproduce a result.</span>
    </label>
  );
}

function DenoisingControl({ value, defaultValue, onChange }: { value: number | null; defaultValue: number; onChange: (value: number | null) => void }) {
  const enabled = value !== null;
  const sliderValue = value ?? defaultValue;

  return (
    <div className="grid gap-3 rounded-md border border-line bg-white p-3">
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input
          className="h-4 w-4 accent-accent"
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked ? defaultValue : null)}
        />
        Custom denoising
      </label>
      {enabled && (
        <label className="grid gap-2 text-sm font-semibold">
          Denoising strength
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={sliderValue}
            onChange={(event) => onChange(Number(event.target.value))}
            className="accent-accent"
          />
          <span className="text-xs text-muted">{formatSliderValue(sliderValue)}</span>
        </label>
      )}
    </div>
  );
}

function SuggestPromptButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-panel disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {loading ? "Suggesting..." : "Suggest prompt"}
    </button>
  );
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function suggestStyle(prompt: string, styleKeywords: Record<string, string[]>): string | null {
  if (!prompt.trim()) return null;
  const lower = prompt.toLowerCase();
  for (const [style, keywords] of Object.entries(styleKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return style;
    }
  }
  return null;
}

function StyleSuggestionBanner({
  prompt,
  currentStyle,
  styleKeywords,
  onApply
}: {
  prompt: string;
  currentStyle: Style;
  styleKeywords: Record<string, string[]>;
  onApply: (style: Style) => void;
}) {
  const suggested = suggestStyle(prompt, styleKeywords);
  if (!suggested || suggested === currentStyle) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-4 py-2 text-sm">
      <span className="text-ink">
        💡 Suggested style: <strong className="capitalize">{suggested}</strong>
      </span>
      <button
        type="button"
        onClick={() => onApply(suggested)}
        className="focus-ring rounded-md border border-accent px-3 py-1 text-xs font-semibold text-accent transition hover:bg-accent hover:text-white"
      >
        Apply
      </button>
    </div>
  );
}

function formatSliderValue(value: number) {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

// ─── New Feature Tabs ───────────────────────────────────────────────────────

function FaceRestoreTab() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState("gfpgan");
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await faceRestoreImage({ image: file, mode });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start face restore");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Face Restore">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <select className="focus-ring h-11 rounded-md border border-line bg-white px-3" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="gfpgan">GFPGAN (natural)</option>
          <option value="codeformer">CodeFormer (sharp)</option>
          <option value="combined">Combined</option>
        </select>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<Wand2 className="h-4 w-4" />}>
          {loading ? "Starting..." : "Restore Faces"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function VariationsTab({ styles }: { styles: typeof fallbackStyles }) {
  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState("realistic");
  const [prompt, setPrompt] = useState("");
  const [strength, setStrength] = useState(0.3);
  const [numVariations, setNumVariations] = useState(2);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await createVariations({ image: file, style, prompt: prompt || undefined, denoising_strength: strength, num_variations: numVariations });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start variations");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Image Variations">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <StyleSelector styles={styles} value={style} onChange={setStyle} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Optional guidance prompt..." />
        <div className="grid gap-1">
          <label className="text-sm text-muted">Variation strength: {formatSliderValue(strength)}</label>
          <input type="range" min="0.1" max="0.5" step="0.05" value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="w-full" />
        </div>
        <div className="grid gap-1">
          <label className="text-sm text-muted">Number of variations: {numVariations}</label>
          <input type="range" min="1" max="4" step="1" value={numVariations} onChange={(e) => setNumVariations(Number(e.target.value))} className="w-full" />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<Layers className="h-4 w-4" />}>
          {loading ? "Starting..." : "Generate Variations"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function SketchToPhotoTab({ styles }: { styles: typeof fallbackStyles }) {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("realistic");
  const [cnMode, setCnMode] = useState("scribble");
  const [weight, setWeight] = useState(0.8);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !prompt) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await sketchToPhoto({ image: file, prompt, style, controlnet_mode: cnMode, controlnet_weight: weight });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sketch to photo");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Sketch → Photo">
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the photo to generate..." />
        <StyleSelector styles={styles} value={style} onChange={setStyle} />
        <select className="focus-ring h-11 rounded-md border border-line bg-white px-3" value={cnMode} onChange={(e) => setCnMode(e.target.value)}>
          <option value="scribble">Scribble (rough sketches)</option>
          <option value="lineart">Lineart (clean line art / anime)</option>
        </select>
        <div className="grid gap-1">
          <label className="text-sm text-muted">ControlNet weight: {formatSliderValue(weight)}</label>
          <input type="range" min="0.3" max="1.5" step="0.05" value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full" />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file || !prompt} icon={<RefreshCw className="h-4 w-4" />}>
          {loading ? "Starting..." : "Convert Sketch"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function PoseControlTab({ styles }: { styles: typeof fallbackStyles }) {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("realistic");
  const [weight, setWeight] = useState(0.8);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !prompt) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await poseControl({ pose_image: file, prompt, style, controlnet_weight: weight });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start pose control");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Pose Control">
      <p className="mb-4 text-sm text-muted">Upload a reference image with the desired pose, then describe the character to generate.</p>
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the character and scene..." />
        <StyleSelector styles={styles} value={style} onChange={setStyle} />
        <div className="grid gap-1">
          <label className="text-sm text-muted">Pose adherence: {formatSliderValue(weight)}</label>
          <input type="range" min="0.3" max="1.5" step="0.05" value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full" />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file || !prompt} icon={<Wand2 className="h-4 w-4" />}>
          {loading ? "Starting..." : "Generate with Pose"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function DepthGuideTab({ styles }: { styles: typeof fallbackStyles }) {
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("realistic");
  const [weight, setWeight] = useState(0.7);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !prompt) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await depthGuide({ reference_image: file, prompt, style, controlnet_weight: weight });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start depth guide");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Depth Guide">
      <p className="mb-4 text-sm text-muted">Upload a reference image to use its spatial depth structure as guidance for generation.</p>
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        <PromptInput value={prompt} onChange={setPrompt} placeholder="Describe the scene to generate..." />
        <StyleSelector styles={styles} value={style} onChange={setStyle} />
        <div className="grid gap-1">
          <label className="text-sm text-muted">Depth adherence: {formatSliderValue(weight)}</label>
          <input type="range" min="0.3" max="1.5" step="0.05" value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full" />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file || !prompt} icon={<Layers className="h-4 w-4" />}>
          {loading ? "Starting..." : "Generate with Depth"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}

function RestorePhotoTab() {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [result, setResult] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError(""); setLoading(true); setResult(null);
    try {
      const job = await restorePhoto({ image: file });
      setJobId(job.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start photo restoration");
    } finally { setLoading(false); }
  }

  return (
    <Panel title="Restore Old Photo">
      <p className="mb-4 text-sm text-muted">Upscale + face restore + denoise pipeline for old or damaged photos.</p>
      <form onSubmit={submit} className="grid gap-4">
        <ImageUpload file={file} onChange={setFile} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <ActionButton disabled={loading || !file} icon={<RefreshCw className="h-4 w-4" />}>
          {loading ? "Starting..." : "Restore Photo"}
        </ActionButton>
      </form>
      <div className="mt-5 grid gap-4">
        <JobStatus jobId={jobId} onDone={setResult} />
        <ImageResult job={result} />
      </div>
    </Panel>
  );
}
