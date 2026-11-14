import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = { "/api": { target: process.env.VITE_API_PROXY || "http://localhost:8000", changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  build: { chunkSizeWarningLimit: 2500 },
});
