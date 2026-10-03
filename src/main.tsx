import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

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
