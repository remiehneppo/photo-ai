import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#141414",
        muted: "#6f6a61",
        line: "#ded8cc",
        panel: "#f8f5ef",
        accent: "#1f7a6a",
        danger: "#b42318"
      }
    }
  },
  plugins: []
};

export default config;
