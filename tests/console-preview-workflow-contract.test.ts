import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/console-preview.yml", import.meta.url),
  "utf8",
);

const stepIndex = (name: string) => workflow.indexOf(`name: ${name}`);

/**
 * The Pages deploy once failed with "No artifacts named github-pages were
 * found" even though the upload had finalized successfully: ListArtifacts is
 * eventually consistent, and `deploy-pages` has no artifact-id input to avoid
 * reading that index. A bounded wait between upload and deploy is the only
 * local remedy, so pin both its position and its bound — reordering the steps
 * silently reintroduces a flaky deploy that only shows up on GitHub.
 */
test("the Pages artifact cleanup, upload, metadata wait and deploy stay in order", () => {
  const cleanup = stepIndex(
    "Remove stale Pages artifacts from earlier attempts",
  );
  const upload = stepIndex("Upload Pages artifact");
  const wait = stepIndex("Wait for Pages artifact metadata");
  const deploy = stepIndex("Deploy to GitHub Pages");
  assert.ok(cleanup > 0, "the stale-artifact cleanup step must exist");
  assert.ok(upload > cleanup, "cleanup must run before the upload");
  assert.ok(wait > upload, "the metadata wait must run after the upload");
  assert.ok(deploy > wait, "deploy must run after the metadata wait");
});

test("the metadata wait polls the run's artifacts with a bound", () => {
  const start = stepIndex("Wait for Pages artifact metadata");
  const body = workflow.slice(start, stepIndex("Deploy to GitHub Pages"));
  assert.match(body, /repos\/\$GITHUB_REPOSITORY\/actions\/runs\/\$GITHUB_RUN_ID\/artifacts/);
  assert.match(body, /select\(\.name == "github-pages"\)/);
  assert.match(body, /for attempt in \$\(seq 1 24\)/);
  assert.match(body, /sleep 5/);
  assert.match(body, /seen_successive/);
  assert.match(body, /exit 1/, "a genuinely missing artifact must fail loudly");
});
