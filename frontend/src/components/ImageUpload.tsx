"use client";

import { ImagePlus } from "lucide-react";
import { useEffect, useMemo } from "react";

export function ImageUpload({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return (
    <label className="focus-within:ring-accent flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-white p-4 text-center transition hover:bg-panel focus-within:ring-2">
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
          <span className="text-sm font-semibold">Choose an image</span>
        </div>
      )}
    </label>
  );
}
