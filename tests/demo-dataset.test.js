import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDemoDatasetReader,
  parseDemoDataset,
  resolveDemoDatasetPath,
} from "../server/demo-dataset.mjs";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const validDocument = {
  schemaVersion: 1,
  session: { id: "s-1", source: "codex", workspaceId: "w", cwd: "/repo" },
  events: [
    { offsetMs: -1_000, eventName: "SessionStart", payload: {} },
    { offsetMs: 0, eventName: "Stop", payload: {} },
  ],
};

function temporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "astro-demo-dataset-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeDataset(directory, document = validDocument) {
  mkdirSync(join(directory, "data"), { recursive: true });
  const file = join(directory, "data", "demo-events.json");
  writeFileSync(file, JSON.stringify(document));
  return file;
}

test("reads the sample dataset shipped with the repository", () => {
  // The service is the primary reader of `data/demo-events.json`; the console
  // only ever sees this document, so the shipped file must satisfy the
  // envelope this module enforces.
  const reader = createDemoDatasetReader({ projectDir, environment: {} });
  const result = reader.read();
  assert.equal(result.ok, true);
  assert.equal(result.path, "data/demo-events.json");
  assert.equal(result.dataset.events.length, 16);
  assert.equal(result.dataset.session.id, "demo-runtime-7f31");
});

test("reports a missing dataset as 404 instead of throwing", (t) => {
  const directory = temporaryDirectory(t);
  const reader = createDemoDatasetReader({
    projectDir: directory,
    environment: {},
  });
  const result = reader.read();
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "Demo dataset not found");
  assert.equal(result.path, "data/demo-events.json");
});

test("honours ASTRO_DEMO_EVENTS and resolves relative paths from the project", (t) => {
  const directory = temporaryDirectory(t);
  assert.equal(
    resolveDemoDatasetPath({
      projectDir: directory,
      environment: { ASTRO_DEMO_EVENTS: "/tmp/elsewhere.json" },
    }),
    "/tmp/elsewhere.json",
  );
  assert.equal(
    resolveDemoDatasetPath({
      projectDir: directory,
      environment: { ASTRO_DEMO_EVENTS: "var/sample.json" },
    }),
    join(directory, "var", "sample.json"),
  );
});

test("prefers the repository file over the built copy", (t) => {
  const directory = temporaryDirectory(t);
  mkdirSync(join(directory, "data"), { recursive: true });
  mkdirSync(join(directory, "dist", "data"), { recursive: true });
  writeFileSync(join(directory, "data", "demo-events.json"), JSON.stringify(validDocument));
  writeFileSync(
    join(directory, "dist", "data", "demo-events.json"),
    JSON.stringify(validDocument),
  );
  assert.equal(
    resolveDemoDatasetPath({ projectDir: directory, environment: {} }),
    join(directory, "data", "demo-events.json"),
  );
  // An installed runtime ships `dist` and `server` but not the repository
  // root, so the built copy is the path it can actually read.
  rmSync(join(directory, "data"), { recursive: true, force: true });
  assert.equal(
    resolveDemoDatasetPath({ projectDir: directory, environment: {} }),
    join(directory, "dist", "data", "demo-events.json"),
  );
});

test("a deleted dataset is a 404, not the copy an older build left behind", (t) => {
  // `dist/data` outlives a deleted `data/demo-events.json`. Serving it would
  // hide the deletion and quietly show stale sample data, so the repository
  // data directory — when it exists — decides, missing file included.
  const directory = temporaryDirectory(t);
  mkdirSync(join(directory, "data"), { recursive: true });
  mkdirSync(join(directory, "dist", "data"), { recursive: true });
  writeFileSync(
    join(directory, "dist", "data", "demo-events.json"),
    JSON.stringify(validDocument),
  );
  assert.equal(
    resolveDemoDatasetPath({ projectDir: directory, environment: {} }),
    join(directory, "data", "demo-events.json"),
  );
  const reader = createDemoDatasetReader({ projectDir: directory, environment: {} });
  const result = reader.read();
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test("caches an unchanged file and reloads an edited one", (t) => {
  const directory = temporaryDirectory(t);
  const file = writeDataset(directory);
  let reads = 0;
  const reader = createDemoDatasetReader({
    projectDir: directory,
    environment: {},
    readFile: (path, encoding) => {
      reads += 1;
      return readFileSync(path, encoding);
    },
  });

  const first = reader.read();
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  const second = reader.read();
  assert.equal(second.cached, true);
  assert.equal(reads, 1);

  // A hand edit must show up without a restart: the cache key is mtime+size.
  writeFileSync(
    file,
    JSON.stringify({
      ...validDocument,
      events: [
        ...validDocument.events,
        { offsetMs: 500, eventName: "AgentMessage", payload: { message: "hi" } },
      ],
    }),
  );
  const third = reader.read();
  assert.equal(third.ok, true);
  assert.equal(third.cached, false);
  assert.equal(third.dataset.events.length, 3);
});

test("answers 500 with a readable reason for a broken file", (t) => {
  const directory = temporaryDirectory(t);
  const file = writeDataset(directory);
  const reader = createDemoDatasetReader({ projectDir: directory, environment: {} });

  writeFileSync(file, "{ not json");
  const broken = reader.read();
  assert.equal(broken.ok, false);
  assert.equal(broken.status, 500);
  assert.match(broken.error, /is not valid JSON/);

  writeFileSync(file, JSON.stringify({ ...validDocument, schemaVersion: 9 }));
  const outdated = reader.read();
  assert.equal(outdated.ok, false);
  assert.equal(outdated.status, 500);
  assert.match(outdated.error, /schemaVersion 1/);

  // Fixing the file is enough: failures are never cached.
  writeFileSync(file, JSON.stringify(validDocument));
  assert.equal(reader.read().ok, true);
});

test("validates the envelope without inventing events", () => {
  assert.throws(
    () => parseDemoDataset(JSON.stringify({ schemaVersion: 1, session: { id: "s" }, events: [] })),
    /session\.source/,
  );
  assert.deepEqual(
    parseDemoDataset(JSON.stringify(validDocument), "data/demo-events.json"),
    validDocument,
  );
});

async function startServer(t, environment) {
  const root = mkdtempSync(join(tmpdir(), "astro-demo-http-"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((done) => probe.close(done));
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      ASTRO_HOME: root,
      ASTRO_PORT: String(port),
      ASTRO_HOST: "127.0.0.1",
      ASTRO_OPEN_BROWSER: "0",
      ASTRO_TRACE_DIR: "",
      AGENT_TRACE_DIR: "",
      TRAE_TRACE_DIR: "",
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(async () => {
    child.kill("SIGTERM");
    await exited;
    rmSync(root, { recursive: true, force: true });
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    if (output.includes("ASTRO:")) break;
  }
  assert.match(output, /ASTRO:/, stderr);
  return `http://127.0.0.1:${port}`;
}

test("serves the dataset over HTTP and reports a vanished file as 404", async (t) => {
  const directory = temporaryDirectory(t);
  const file = join(directory, "dataset.json");
  writeFileSync(file, JSON.stringify(validDocument));
  const url = await startServer(t, { ASTRO_DEMO_EVENTS: file });

  const response = await fetch(`${url}/api/demo-events`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.eventCount, 2);
  assert.equal(payload.dataset.session.id, "s-1");
  assert.equal(payload.path, file);

  // The file is read per request: removing it degrades to 404 without a
  // restart, which is what the console's error notice is built on.
  rmSync(file);
  const missing = await fetch(`${url}/api/demo-events`);
  assert.equal(missing.status, 404);
  const failure = await missing.json();
  assert.equal(failure.error, "Demo dataset not found");
  assert.equal(failure.path, file);
});
