/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#050505",
        surface: "#0A0A0A",
        card: "#111111",
        border: {
          DEFAULT: "#222222",
          strong: "#333333",
        },
        ink: {
          DEFAULT: "#E0E0E0",
          muted: "#888888",
          faint: "#666666",
        },
        vpn: {
          DEFAULT: "#34D399",
          dim: "#065F46",
        },
        host: {
          DEFAULT: "#60A5FA",
          dim: "#1E3A8A",
        },
        service: {
          DEFAULT: "#C084FC",
          dim: "#581C87",
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
