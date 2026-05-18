"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export function PromptInput({
  value,
  onChange,
  placeholder = "Describe the image you want...",
  suggestions = []
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed || suggestions.length === 0) {
      return [];
    }
    const lower = trimmed.toLowerCase();
    return suggestions
      .filter((s) => s.toLowerCase().includes(lower) && s.toLowerCase() !== lower)
      .slice(0, 5);
  }, [value, suggestions]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <textarea
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => filtered.length > 0 && setShowDropdown(true)}
        placeholder={placeholder}
        className="focus-ring min-h-32 w-full resize-y rounded-md border border-line bg-white px-4 py-3 text-sm leading-6 text-ink placeholder:text-muted"
      />
      {showDropdown && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line bg-white shadow-md">
          {filtered.map((suggestion, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  onChange(suggestion);
                  setShowDropdown(false);
                }}
                className="w-full overflow-hidden truncate px-4 py-2 text-left text-sm text-ink hover:bg-panel"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
