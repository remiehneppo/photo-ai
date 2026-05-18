"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { fetchImageBlob } from "@/lib/api";
import type { JobDetail } from "@/types";
import { Copy, Dices, Download } from "lucide-react";

export function ImageResult({ job, onUseSeed }: { job: JobDetail | null; onUseSeed?: (seed: number) => void }) {
  const outputs = job?.images.filter((image) => image.type === "output" && image.url) ?? [];
  const input = job?.images.find((image) => image.type === "input" && image.url);

  if (!job || outputs.length === 0) return null;

  const beforeSrc = input?.url ?? null;
  const beforeFilename = input?.filename || "before.png";

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {outputs.map((image) => {
          const afterSrc = image.url;
          const afterFilename = image.filename || "output.png";
          return beforeSrc ? (
            <ComparisonSlider key={image.id} before={beforeSrc} after={afterSrc} beforeFilename={beforeFilename} afterFilename={afterFilename} />
          ) : (
            <ImagePanel key={image.id} title="Output" src={afterSrc} filename={afterFilename} />
          );
        })}
      </div>
      {job.seed != null && <SeedPanel seed={job.seed} onUseSeed={onUseSeed} />}
    </div>
  );
}

function ComparisonSlider({ before, after, beforeFilename, afterFilename }: { before: string; after: string; beforeFilename: string; afterFilename: string }) {
  const [split, setSplit] = useState(50);

  return (
    <div className="relative select-none overflow-hidden rounded-md border border-line bg-white">
      <div className="relative" style={{ aspectRatio: "4/3" }}>
        <AuthImage src={before} alt="Before" className="absolute inset-0 h-full w-full object-contain" />
        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
          <AuthImage src={after} alt="After" className="absolute inset-0 h-full w-full object-contain" />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }}>
          <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-bold shadow-md">⇔</div>
        </div>
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">Before</span>
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/50 px-1.5 py-0.5 text-xs text-white">After</span>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          onChange={(event) => setSplit(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-col-resize opacity-0"
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-line p-2">
        <DownloadButton src={before} filename={beforeFilename} className="focus-ring flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-panel">
          <Download className="h-3 w-3" /> Before
        </DownloadButton>
        <DownloadButton src={after} filename={afterFilename} className="focus-ring flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-panel">
          <Download className="h-3 w-3" /> After
        </DownloadButton>
      </div>
    </div>
  );
}

function ImagePanel({ title, src, filename }: { title: string; src: string; filename: string }) {
  return (
    <figure className="rounded-md border border-line bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <DownloadButton className="focus-ring rounded-md border border-line p-2 hover:bg-panel" src={src} filename={filename} title="Download">
          <Download className="h-4 w-4" aria-hidden="true" />
        </DownloadButton>
      </div>
      <AuthImage src={src} alt={title} className="max-h-[520px] w-full rounded-md object-contain" />
    </figure>
  );
}

function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [objectUrl, setObjectUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    let nextUrl = "";
    fetchImageBlob(src)
      .then((blob) => {
        if (cancelled) return;
        nextUrl = URL.createObjectURL(blob);
        setObjectUrl(nextUrl);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl("");
      });
    return () => {
      cancelled = true;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [src]);

  if (!objectUrl) return <div className={className} aria-label={alt} />;
  return <img src={objectUrl} alt={alt} className={className} />;
}

function DownloadButton({ src, filename, className, title, children }: { src: string; filename: string; className?: string; title?: string; children: ReactNode }) {
  async function download() {
    const blob = await fetchImageBlob(src);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <button type="button" onClick={download} className={className} title={title}>
      {children}
    </button>
  );
}

function SeedPanel({ seed, onUseSeed }: { seed: number; onUseSeed?: (seed: number) => void }) {
  const [copied, setCopied] = useState(false);

  async function copySeed() {
    await navigator.clipboard.writeText(String(seed));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white px-3 py-2 text-sm">
      <span className="font-medium text-ink">Seed: {seed}</span>
      <button type="button" onClick={copySeed} className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-panel">
        <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
      </button>
      {onUseSeed && (
        <button type="button" onClick={() => onUseSeed(seed)} className="focus-ring inline-flex items-center gap-1 rounded-md border border-line px-2 py-1.5 text-xs font-semibold hover:bg-panel">
          <Dices className="h-3 w-3" /> Use seed
        </button>
      )}
    </div>
  );
}
