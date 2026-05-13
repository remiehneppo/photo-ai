"use client";

import { imageUrl } from "@/lib/api";
import type { JobDetail } from "@/types";
import { Download } from "lucide-react";

export function ImageResult({ job }: { job: JobDetail | null }) {
  const outputs = job?.images.filter((image) => image.type === "output" && image.url) ?? [];
  const inputs = job?.images.filter((image) => image.type === "input" && image.url) ?? [];

  if (!job || outputs.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {inputs.length > 0 && (
        <ImagePanel title="Input" src={imageUrl(inputs[0].url)} filename={inputs[0].filename || "input.png"} />
      )}
      {outputs.map((image) => (
        <ImagePanel key={image.id} title="Output" src={imageUrl(image.url)} filename={image.filename || "output.png"} />
      ))}
    </div>
  );
}

function ImagePanel({ title, src, filename }: { title: string; src: string; filename: string }) {
  return (
    <figure className="rounded-md border border-line bg-white p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <a className="focus-ring rounded-md border border-line p-2 hover:bg-panel" href={src} download={filename} title="Download">
          <Download className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
      <img src={src} alt="" className="max-h-[520px] w-full rounded-md object-contain" />
    </figure>
  );
}
