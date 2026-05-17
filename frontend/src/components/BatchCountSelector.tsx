"use client";

const OPTIONS = [1, 2, 4] as const;
export type BatchCount = (typeof OPTIONS)[number];

export function BatchCountSelector({
  value,
  onChange,
}: {
  value: BatchCount;
  onChange: (count: BatchCount) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink">Batch</p>
      <div className="flex gap-2">
        {OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`focus-ring h-9 w-12 rounded-md border text-sm font-semibold transition ${
              value === n
                ? "border-accent bg-accent text-white"
                : "border-line bg-white text-ink hover:bg-panel"
            }`}
          >
            {n === 1 ? "×1" : `×${n}`}
          </button>
        ))}
      </div>
    </div>
  );
}
