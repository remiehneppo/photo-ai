"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import type { Style } from "@/types";

export function PromptSuggestions({
  promptsByTask,
  task,
  currentStyle,
  onSelect
}: {
  promptsByTask: Record<string, Record<string, string[]>>;
  task: string;
  currentStyle: Style;
  onSelect: (prompt: string) => void;
}) {
  const taskData = promptsByTask[task] ?? {};
  const categories = Object.keys(taskData);
  const defaultCategory = task === "generate" ? (currentStyle in taskData ? currentStyle : categories[0]) : categories[0];
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState(defaultCategory ?? "");

  const examples = taskData[activeCategory] ?? [];

  return (
    <div className="rounded-md border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="focus-ring flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink hover:bg-panel"
      >
        <span className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-accent" />
          Example prompts
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t border-line p-3">
          <div className="mb-3 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`focus-ring rounded-full border px-3 py-1 text-xs font-semibold capitalize transition ${
                  activeCategory === cat
                    ? "border-accent bg-accent text-white"
                    : "border-line bg-white text-ink hover:bg-panel"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
          <ul className="grid gap-2">
            {examples.map((example, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onSelect(example)}
                  className="focus-ring w-full rounded-md border border-line px-3 py-2 text-left text-sm text-ink transition hover:border-accent hover:bg-panel"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
