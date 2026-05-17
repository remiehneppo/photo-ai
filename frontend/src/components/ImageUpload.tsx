"use client";

import { ImagePlus } from "lucide-react";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";

export function ImageUpload({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped && dropped.type.startsWith("image/")) onChange(dropped);
  }

  return (
    <label
      className={`focus-within:ring-accent flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-4 text-center transition focus-within:ring-2 ${
        dragging ? "border-accent bg-accent/5" : "border-line bg-white hover:bg-panel"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {previewUrl ? (
        <img src={previewUrl} alt="" className="max-h-64 w-full rounded-md object-contain" />
      ) : (
        <div className="flex flex-col items-center gap-3 text-muted">
          <ImagePlus className="h-8 w-8" aria-hidden="true" />
          <span className="text-sm font-semibold">{dragging ? "Drop image here" : "Choose or drop an image"}</span>
        </div>
      )}
    </label>
  );
}
