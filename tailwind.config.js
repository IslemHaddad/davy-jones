/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Values come from CSS custom properties (see index.css) so every
        // one of these tokens can swap between the dark and light themes
        // without touching a single component -- they all already just
        // use e.g. bg-canvas/text-ink/bg-vpn-dim, never a raw hex.
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          strong: "rgb(var(--color-border-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          muted: "rgb(var(--color-ink-muted) / <alpha-value>)",
          faint: "rgb(var(--color-ink-faint) / <alpha-value>)",
        },
        vpn: {
          DEFAULT: "rgb(var(--color-vpn) / <alpha-value>)",
          dim: "rgb(var(--color-vpn-dim) / <alpha-value>)",
        },
        host: {
          DEFAULT: "rgb(var(--color-host) / <alpha-value>)",
          dim: "rgb(var(--color-host-dim) / <alpha-value>)",
        },
        service: {
          DEFAULT: "rgb(var(--color-service) / <alpha-value>)",
          dim: "rgb(var(--color-service-dim) / <alpha-value>)",
        },
      },
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
