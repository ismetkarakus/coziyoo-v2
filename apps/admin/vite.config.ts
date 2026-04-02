import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  cacheDir: ".vite",
  // Load VITE_* env vars from the monorepo root (.env / .env.local) so that
  // VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are available for realtime.
  envDir: path.resolve(__dirname, "../../"),
  server: {
    port: 5174,
    proxy: {
      "/v1": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
