"use client";

import { getJob } from "@/lib/api";
import type { JobDetail, JobStatus as JobStatusType } from "@/types";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

export function JobStatus({
  jobId,
  onDone
}: {
  jobId: string | null;
  onDone?: (job: JobDetail) => void;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!jobId) {
      return;
    }

    const activeJobId = jobId;
    let cancelled = false;
    async function poll() {
      try {
        const next = await getJob(activeJobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "done") onDone?.(next);
        if (next.status === "pending" || next.status === "processing") {
          window.setTimeout(poll, 1800);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load job status");
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, onDone]);

  if (!jobId) return null;

  const status = job?.status ?? "pending";
  const icon = statusIcon(status);

  return (
    <div className="rounded-md border border-line bg-white p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <div className="text-sm font-semibold capitalize">{status}</div>
          <div className="text-xs text-muted">{jobId}</div>
        </div>
      </div>
      {(error || job?.error_message) && <p className="mt-3 text-sm text-danger">{error || job?.error_message}</p>}
    </div>
  );
}

function statusIcon(status: JobStatusType) {
  if (status === "done") return <CheckCircle2 className="h-5 w-5 text-accent" aria-hidden="true" />;
  if (status === "failed") return <XCircle className="h-5 w-5 text-danger" aria-hidden="true" />;
  return <Loader2 className="h-5 w-5 animate-spin text-muted" aria-hidden="true" />;
}
