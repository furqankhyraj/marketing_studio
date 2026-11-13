import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = process.env.API_URL ?? "http://localhost:4300";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/files": { target: API, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: API, changeOrigin: true },
      "/files": { target: API, changeOrigin: true },
    },
  },
});
