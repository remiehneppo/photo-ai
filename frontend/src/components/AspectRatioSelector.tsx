"use client";

export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "3:2" | "2:3";

const RATIOS: Array<{ value: AspectRatio; label: string }> = [
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
];

export function AspectRatioSelector({
  value,
  onChange,
}: {
  value: AspectRatio | null;
  onChange: (ratio: AspectRatio | null) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink">Aspect Ratio</p>
      <div className="flex flex-wrap gap-2">
        {RATIOS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => onChange(value === r.value ? null : r.value)}
            className={`focus-ring rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              value === r.value
                ? "border-accent bg-accent text-white"
                : "border-line bg-white text-ink hover:bg-panel"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );
}
