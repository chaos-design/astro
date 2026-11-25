#!/usr/bin/env node

/**
 * ax - the short, one-command entry for ASTRO's quick start.
 *
 * Bare `ax` runs the same aggregated flow as `astrox ax`: bring the dashboard
 * up on the configured port (bootstrapping the runtime when nothing is
 * installed yet), register both global shorthands, verify /api/health, then
 * report service and integration readiness on one screen. Any other astrox
 * command is forwarded unchanged (`run` and the delegated `astro-trace` entry
 * resolve `ax <command>` the same way through `commandNames`), so `ax status`,
 * `ax stop` and `ax open` behave exactly like their astrox equivalents. All of
 * the work lives in `bin/astrox.mjs`; this file is only a launcher so the
 * command can be installed globally (`npm i -g astro-plugin`) or run as
 * `npx astro-plugin ax` from a checkout.
 */

import { commandNames, run } from "./astrox.mjs";

const arguments_ = process.argv.slice(2);

const command =
  arguments_.length > 0 && commandNames.has(arguments_[0])
    ? arguments_[0]
    : // Flags and unknown tokens stay with the quick start, whose positional
      // check reports unknown commands instead of silently swallowing them.
      "ax";

try {
  await run([process.execPath, "ax", command, ...arguments_]);
} catch (error) {
  console.error(
    `ax: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
