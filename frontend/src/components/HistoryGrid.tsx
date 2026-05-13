"use client";

import { imageUrl } from "@/lib/api";
import type { JobDetail } from "@/types";
import { Download } from "lucide-react";

export function HistoryGrid({ jobs }: { jobs: JobDetail[] }) {
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
              {output && (
                <a className="focus-ring rounded-md border border-line p-2 hover:bg-panel" href={imageUrl(output.url)} download={output.filename || "image.png"} title="Download">
                  <Download className="h-4 w-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
