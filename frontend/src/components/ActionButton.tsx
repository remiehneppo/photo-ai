import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger";
};

export function ActionButton({ children, icon, variant = "primary", className = "", ...props }: Props) {
  const variants = {
    primary: "bg-accent text-white hover:bg-[#176557]",
    secondary: "border border-line bg-white text-ink hover:bg-panel",
    danger: "bg-danger text-white hover:bg-[#8f1c13]"
  };

  return (
    <button
      className={`focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition ${variants[variant]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
