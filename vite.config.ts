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
