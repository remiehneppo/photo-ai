"use client";

import { fetchImageBlob } from "@/lib/api";
import type { HistoryImageTarget, ImageOut, JobDetail } from "@/types";
import { Brush, Download, Expand, ImageUp, PenTool, SlidersHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export function HistoryGrid({
  jobs,
  busyJobId,
  busyImageId,
  onDelete,
  onUseImage
}: {
  jobs: JobDetail[];
  busyJobId?: string | null;
  busyImageId?: string | null;
  onDelete?: (job: JobDetail) => void;
  onUseImage?: (target: HistoryImageTarget, image: ImageOut) => void;
}) {
  if (jobs.length === 0) {
    return <div className="rounded-md border border-line bg-white p-6 text-sm text-muted">No jobs yet.</div>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {jobs.map((job) => {
        const output = job.images.find((image) => image.type === "output" && image.url);
        return (
          <article key={job.id} className="rounded-md border border-line bg-white p-3">
            <div className="aspect-square overflow-hidden rounded-md bg-panel">
              {output ? (
                <AuthImage src={output.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted">{job.status}</div>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{job.feature}</div>
                <div className="truncate text-xs text-muted">{new Date(job.created_at).toLocaleString()}</div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {output && (
                  <>
                    <HistoryIconButton title="Use in Edit" disabled={busyImageId === output.id} onClick={() => onUseImage?.("edit", output)}>
                      <Brush className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                    <HistoryIconButton title="Use in Upscale" disabled={busyImageId === output.id} onClick={() => onUseImage?.("upscale", output)}>
                      <ImageUp className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                    <HistoryIconButton title="Use in Sharpen" disabled={busyImageId === output.id} onClick={() => onUseImage?.("sharpen", output)}>
                      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                    <HistoryIconButton title="Use in Expand" disabled={busyImageId === output.id} onClick={() => onUseImage?.("outpaint", output)}>
                      <Expand className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                    <HistoryIconButton title="Use in Inpaint" disabled={busyImageId === output.id} onClick={() => onUseImage?.("inpaint", output)}>
                      <PenTool className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                    <HistoryIconButton title="Download" disabled={busyImageId === output.id} onClick={() => downloadImage(output)}>
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </HistoryIconButton>
                  </>
                )}
                {onDelete && (
                  <HistoryIconButton title="Delete history item" disabled={busyJobId === job.id} danger onClick={() => onDelete(job)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </HistoryIconButton>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

async function downloadImage(image: ImageOut) {
  const blob = await fetchImageBlob(image.url);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = image.filename || "image.png";
  link.click();
  URL.revokeObjectURL(objectUrl);
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

function HistoryIconButton({
  title,
  disabled,
  danger,
  onClick,
  children
}: {
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`focus-ring rounded-md border border-line p-2 hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "text-danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
