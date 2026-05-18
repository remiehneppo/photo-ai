"use client";

import { cancelJob, getJob } from "@/lib/api";
import type { JobDetail, JobStatus as JobStatusType } from "@/types";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function JobStatus({
  jobId,
  onDone
}: {
  jobId: string | null;
  onDone?: (job: JobDetail) => void;
}) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const onDoneRef = useRef(onDone);
  const completedJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!jobId) {
      completedJobIdRef.current = null;
      return;
    }

    const activeJobId = jobId;
    completedJobIdRef.current = null;
    let cancelled = false;
    let timeoutId: number | null = null;
    async function poll() {
      try {
        const next = await getJob(activeJobId);
        if (cancelled) return;
        setJob(next);
        if (next.status === "done" && completedJobIdRef.current !== activeJobId) {
          completedJobIdRef.current = activeJobId;
          onDoneRef.current?.(next);
        }
        if (next.status === "pending" || next.status === "processing") {
          timeoutId = window.setTimeout(poll, 1800);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load job status");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [jobId]);

  if (!jobId) return null;

  const status = job?.status ?? "pending";
  const icon = statusIcon(status);
  const progress = Math.max(0, Math.min(100, job?.progress_percent ?? 0));
  const stepText =
    job?.current_step != null && job?.total_steps
      ? `Step ${job.current_step}/${job.total_steps}`
      : job?.progress_label || "Queued";
  const waitText = formatWait(job?.eta_seconds ?? job?.estimated_seconds ?? null, job?.eta_seconds != null);
  const canCancel = status === "pending" || status === "processing";

  async function handleCancel() {
    if (!jobId || !canCancel || cancelling) return;
    setError("");
    setCancelling(true);
    try {
      await cancelJob(jobId);
      setJob((current) =>
        current
          ? {
              ...current,
              status: "failed",
              error_message: "Cancelled by user",
              progress_label: "Cancelled"
            }
          : current
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel job");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-white p-4">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold capitalize">{status}</div>
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="focus-ring rounded-md border border-danger px-2 py-1 text-xs font-semibold text-danger hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelling ? "Cancelling..." : "Cancel"}
              </button>
            )}
          </div>
          <div className="truncate text-xs text-muted">{jobId}</div>
        </div>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
          <span>{stepText}</span>
          <span>{waitText}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-panel">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
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

function formatWait(seconds: number | null, isEta: boolean) {
  if (seconds == null) return "Estimating";
  if (seconds <= 0) return isEta ? "ETA now" : "Starting";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const time = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return isEta ? `ETA ${time}` : `~${time}`;
}
