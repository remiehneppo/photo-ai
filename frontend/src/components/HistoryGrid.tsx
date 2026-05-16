"use client";

import { imageUrl } from "@/lib/api";
import type { HistoryImageTarget, ImageOut, JobDetail } from "@/types";
import { Brush, Download, Expand, ImageUp, PenTool, SlidersHorizontal, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

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
                <img src={imageUrl(output.url)} alt="" className="h-full w-full object-cover" />
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
                    <a className="focus-ring rounded-md border border-line p-2 hover:bg-panel" href={imageUrl(output.url)} download={output.filename || "image.png"} title="Download" aria-label="Download">
                      <Download className="h-4 w-4" aria-hidden="true" />
                    </a>
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
