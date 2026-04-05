import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const monorepoRoot = path.resolve(__dirname, "../../");
  const rootEnv = loadEnv(mode, monorepoRoot, "");
  const adminEnv = loadEnv(mode, __dirname, "");

  // Let admin-specific env files override monorepo defaults without breaking
  // shell-provided variables.
  process.env = {
    ...rootEnv,
    ...adminEnv,
    ...process.env,
  };

  const apiProxyTarget = process.env.VITE_API_BASE_URL?.trim() || "http://localhost:3000";

  return {
    plugins: [react()],
    cacheDir: ".vite",
    // Admin reads its own .env first and can still inherit shared root values
    // from the merged process.env above.
    envDir: __dirname,
    server: {
      port: 5174,
      proxy: {
        "/v1": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
