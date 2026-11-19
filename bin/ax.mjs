#!/usr/bin/env node

/**
 * ax - the short, one-command entry for ASTRO's quick start.
 *
 * `ax` runs the same aggregated flow as `astrox ax`: bring the dashboard up on
 * the configured port, register both global shorthands, then report service
 * and integration readiness on one screen. All of the work lives in
 * `bin/astrox.mjs`; this file is only a launcher so the command can be
 * installed globally (`npm i -g astro-plugin`) or invoked from a checkout.
 */

import { run } from "./astrox.mjs";

try {
  await run([process.execPath, "ax", "ax", ...process.argv.slice(2)]);
} catch (error) {
  console.error(
    `ax: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
