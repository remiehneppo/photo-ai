"use client";

import type { Style } from "@/types";

const styles: Array<{ value: Style; label: string }> = [
  { value: "realistic", label: "Realistic" },
  { value: "anime", label: "Anime" },
  { value: "advertisement", label: "Advertisement" },
  { value: "portrait", label: "Portrait" },
  { value: "artistic", label: "Artistic" }
];

export function StyleSelector({ value, onChange }: { value: Style; onChange: (style: Style) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {styles.map((style) => (
        <button
          key={style.value}
          type="button"
          onClick={() => onChange(style.value)}
          className={`focus-ring h-10 rounded-md border px-3 text-sm font-semibold transition ${
            value === style.value
              ? "border-accent bg-accent text-white"
              : "border-line bg-white text-ink hover:bg-panel"
          }`}
        >
          {style.label}
        </button>
      ))}
    </div>
  );
}
