import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the Go server runs separately (`go run .` in backend/) and Vite
// proxies /api/* to it so the frontend can use plain relative fetch() calls
// identically in dev and production. Override if the Go server's dev port
// isn't the default.
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    // Built straight into the Go module so `go build` can go:embed it --
    // production is a single binary with no separate static file directory.
    outDir: "backend/web/dist",
    emptyOutDir: true,
  },
});
