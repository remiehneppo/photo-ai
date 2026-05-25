"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState } from "react";

export type AdvancedSettings = {
  negativePrompt: string;
  steps: number | null;
  cfgScale: number | null;
  samplerName: string | null;
  tiling: boolean;
};

const DEFAULT_SETTINGS: AdvancedSettings = {
  negativePrompt: "",
  steps: null,
  cfgScale: null,
  samplerName: null,
  tiling: false,
};

export function AdvancedPanel({
  value,
  onChange,
  samplers = [],
}: {
  value: AdvancedSettings;
  onChange: (settings: AdvancedSettings) => void;
  samplers?: string[];
}) {
  const [open, setOpen] = useState(false);
  const controlId = useId();

  function set<K extends keyof AdvancedSettings>(key: K, val: AdvancedSettings[K]) {
    onChange({ ...value, [key]: val });
  }

  const hasChanges =
    value.negativePrompt.trim() ||
    value.steps !== null ||
    value.cfgScale !== null ||
    value.samplerName !== null ||
    value.tiling;

  return (
    <div className="rounded-md border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink"
      >
        <span>
          Advanced{" "}
          {hasChanges && <span className="ml-1 inline-block h-2 w-2 rounded-full bg-accent align-middle" />}
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
      </button>

      {open && (
        <div className="grid gap-4 border-t border-line px-4 pb-4 pt-3">
          {/* G2 – Negative prompt */}
          <div>
            <label htmlFor={`${controlId}-negative-prompt`} className="mb-1.5 block text-sm font-semibold text-ink">Negative Prompt</label>
            <textarea
              id={`${controlId}-negative-prompt`}
              value={value.negativePrompt}
              onChange={(e) => set("negativePrompt", e.target.value)}
              placeholder="Things to avoid (e.g. blurry, low quality, nsfw)"
              className="focus-ring min-h-20 w-full resize-y rounded-md border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-muted"
            />
          </div>

          {/* G3 – Steps */}
          <div>
            <label htmlFor={`${controlId}-steps`} className="mb-1.5 flex items-center justify-between text-sm font-semibold text-ink">
              <span>Steps</span>
              <span className="text-muted">{value.steps ?? "preset"}</span>
            </label>
            <input
              id={`${controlId}-steps`}
              type="range"
              min={10}
              max={50}
              step={1}
              value={value.steps ?? 20}
              onChange={(e) => set("steps", Number(e.target.value))}
              className="w-full accent-accent"
            />
            {value.steps !== null && (
              <button
                type="button"
                onClick={() => set("steps", null)}
                className="mt-1 text-xs text-accent hover:underline"
              >
                Reset to preset
              </button>
            )}
          </div>

          {/* G3 – CFG Scale */}
          <div>
            <label htmlFor={`${controlId}-cfg-scale`} className="mb-1.5 flex items-center justify-between text-sm font-semibold text-ink">
              <span>CFG Scale</span>
              <span className="text-muted">{value.cfgScale ?? "preset"}</span>
            </label>
            <input
              id={`${controlId}-cfg-scale`}
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={value.cfgScale ?? 7}
              onChange={(e) => set("cfgScale", Number(e.target.value))}
              className="w-full accent-accent"
            />
            {value.cfgScale !== null && (
              <button
                type="button"
                onClick={() => set("cfgScale", null)}
                className="mt-1 text-xs text-accent hover:underline"
              >
                Reset to preset
              </button>
            )}
          </div>

          {/* G3 – Sampler */}
          {samplers.length > 0 && (
            <div>
              <label htmlFor={`${controlId}-sampler`} className="mb-1.5 block text-sm font-semibold text-ink">Sampler</label>
              <select
                id={`${controlId}-sampler`}
                value={value.samplerName ?? ""}
                onChange={(e) => set("samplerName", e.target.value || null)}
                className="focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink"
              >
                <option value="">Use preset</option>
                {samplers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* I3 – Tiling */}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={value.tiling}
              onChange={(e) => set("tiling", e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            Seamless tiling (texture mode)
          </label>
        </div>
      )}
    </div>
  );
}

export const defaultAdvanced = (): AdvancedSettings => ({ ...DEFAULT_SETTINGS });
