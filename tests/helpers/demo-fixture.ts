/**
 * Test fixture for the Demo dataset.
 *
 * The sample run is no longer generated in code: it is the repository file
 * `data/demo-events.json`, read by the service at runtime. Tests that need a
 * realistic multi-turn run read the same file, so a change to the dataset is
 * exercised by them instead of drifting away from a second hardcoded copy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildDemoEvents,
  parseDemoDataset,
  type DemoDataset,
} from "../../src/lib/demo-events.ts";

export const demoDatasetFile = fileURLToPath(
  new URL("../../data/demo-events.json", import.meta.url),
);

export function readDemoDataset(): DemoDataset {
  return parseDemoDataset(
    JSON.parse(readFileSync(demoDatasetFile, "utf8")) as unknown,
  );
}

/** Canonical events anchored at `now`, exactly as the console builds them. */
export function createDemoEvents(now: number = Date.now()) {
  return buildDemoEvents(readDemoDataset(), now);
}
