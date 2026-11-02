import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import runtimeConfigLoader from "./plugin/runtime-config.cjs";

const defaultAstroHost = "127.0.0.1";
const defaultAstroPort = 5678;

/**
 * The console's Demo dataset is one local file, `data/demo-events.json`. The
 * service reads it directly and serves `GET /api/demo-events`; this plugin
 * keeps the second, service-free path working:
 *
 * - `serve`: answer `/data/demo-events.json` from the repository file, so
 *   `pnpm dev` still renders the sample run when the API is not running.
 * - `build`: copy it into `dist/data/`, so a built console served by a static
 *   host (or by anything that lost the endpoint) can fall back to it.
 *
 * A missing file is not a build error: without sample data the console keeps
 * its truthful empty state.
 */
function demoDatasetAsset(): Plugin {
  const projectDir = import.meta.dirname;
  const source = path.join(projectDir, "data", "demo-events.json");
  let outDir = path.join(projectDir, "dist");
  return {
    name: "astro-demo-dataset",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? "").split("?")[0];
        if (pathname !== "/data/demo-events.json") {
          next();
          return;
        }
        try {
          const body = readFileSync(source);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        } catch {
          next();
        }
      });
    },
    closeBundle() {
      if (!existsSync(source)) {
        return;
      }
      mkdirSync(path.join(outDir, "data"), { recursive: true });
      copyFileSync(source, path.join(outDir, "data", "demo-events.json"));
    },
  };
}

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
    plugins: [react(), tailwindcss(), demoDatasetAsset()],
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
