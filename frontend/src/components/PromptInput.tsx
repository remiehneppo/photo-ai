"use client";

export function PromptInput({
  value,
  onChange,
  placeholder = "Describe the image you want..."
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="focus-ring min-h-32 w-full resize-y rounded-md border border-line bg-white px-4 py-3 text-sm leading-6 text-ink placeholder:text-muted"
    />
  );
}
