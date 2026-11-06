import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { installPerfMetrics } from "@/lib/perf-metrics";
import "./styles.css";

// Metrics collection starts before React so first-paint entries are not
// missed; the HUD panel itself is mounted from the app root, driven by the
// Settings → 性能 preference.
installPerfMetrics();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element was not found.");
}

createRoot(root).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
