import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import runtimeConfigLoader from "./plugin/runtime-config.cjs";

const defaultAstroHost = "127.0.0.1";
const defaultAstroPort = 4318;

export function resolveAstroProxyTarget(
  environment: Record<string, string | undefined>,
) {
  const host = environment.ASTRO_HOST || defaultAstroHost;
  const configuredPort = Number(environment.ASTRO_PORT);
  const port =
    Number.isSafeInteger(configuredPort) &&
    configuredPort > 0 &&
    configuredPort <= 65_535
      ? configuredPort
      : defaultAstroPort;
  return `http://${host}:${port}`;
}

export default defineConfig(() => {
  const environment = runtimeConfigLoader.loadRuntimeConfig({
    environment: process.env,
  }).environment;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Split stable vendor code from fast-moving application code so
          // repeat visits reuse cached chunks while the app bundle iterates.
          // React and react-dom share one chunk: react-dom imports react and
          // keeping them together avoids cross-chunk initialization order.
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return undefined;
            }
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return "vendor-react";
            }
            if (/[\\/]node_modules[\\/](radix-ui|@radix-ui)[\\/]/.test(id)) {
              return "vendor-radix";
            }
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
              return "vendor-icons";
            }
            if (/[\\/]node_modules[\\/]date-fns[\\/]/.test(id)) {
              return "vendor-date";
            }
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": {
          target: resolveAstroProxyTarget(environment),
          changeOrigin: false,
        },
      },
    },
  };
});
