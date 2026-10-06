import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import recorder from "../plugin/trace-recorder.cjs";
import runtimeConfigLoader from "../plugin/runtime-config.cjs";
import storagePaths from "../plugin/storage-paths.cjs";
import { TraceRepository } from "./trace-repository.mjs";

const serverDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(serverDir, "..");
const publicDir = join(projectDir, "dist");
const runtimeConfig = runtimeConfigLoader.loadRuntimeConfig({
  environment: process.env,
  initialize: true,
});
for (const diagnostic of runtimeConfig.diagnostics) {
  console.error(runtimeConfigLoader.formatRuntimeConfigDiagnostic(diagnostic));
}
const environment = runtimeConfig.environment;
const host =
  environment.ASTRO_HOST ||
  environment.AGENT_TRACE_HOST ||
  environment.TRAE_TRACE_HOST ||
  "127.0.0.1";
const requestedPort = Number(
  environment.ASTRO_PORT ||
    environment.AGENT_TRACE_PORT ||
    environment.TRAE_TRACE_PORT ||
    4318,
);
const maxBodyBytes = Number(
  environment.ASTRO_MAX_BODY_BYTES ||
    environment.AGENT_TRACE_MAX_BODY_BYTES ||
    5_242_880,
);
const clients = new Set();
let dashboardUrl = "";
const store = new TraceRepository(environment);
const { createTraceEvent } = recorder;
const { resolveAstroHome, resolveTraceDirectory } = storagePaths;
const dataRoot =
  environment.ASTRO_TRACE_DIR ||
  environment.AGENT_TRACE_DIR ||
  environment.TRAE_TRACE_DIR
    ? resolveTraceDirectory("generic", {}, environment)
    : resolveAstroHome(environment);
const pidFile =
  environment.ASTRO_PID_FILE ||
  join(resolveAstroHome(environment), `dashboard-${requestedPort}.pid`);
const shouldOpenBrowser = !["", "0", "false", "no", "off"].includes(
  String(environment.ASTRO_OPEN_BROWSER || "").trim().toLowerCase(),
);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function sendSse(response, eventName, value) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(value)}\n\n`);
}

function broadcast(eventName, value) {
  for (const response of clients) {
    sendSse(response, eventName, value);
  }
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    let bodyBytes = 0;

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > maxBodyBytes) {
        reject(new RangeError("Request body is too large."));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        reject(new SyntaxError("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function collectSearchFields(value, path = "", output = [], seen = new WeakSet()) {
  if (value === null || value === undefined) {
    return output;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return output;
    }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      collectSearchFields(child, path ? `${path}.${key}` : key, output, seen);
    }
    return output;
  }
  output.push({ path, value: String(value) });
  return output;
}

function createSnippet(value, index, length) {
  const start = Math.max(0, index - 72);
  const end = Math.min(value.length, index + length + 112);
  return `${start ? "..." : ""}${value.slice(start, end)}${
    end < value.length ? "..." : ""
  }`;
}

function searchEvents(events, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return events.flatMap((event) => {
    const fields = collectSearchFields({
      id: event.id,
      locator: event.locator,
      source: event.source,
      sessionId: event.sessionId,
      eventName: event.eventName,
      toolName: event.toolName,
      cwd: event.cwd,
      payload: event.payload,
    });
    const match = fields.find(
      ({ path, value }) =>
        path.toLowerCase().includes(needle) ||
        value.toLowerCase().includes(needle),
    );
    if (!match) {
      return [];
    }
    const searchableValue = match.path.toLowerCase().includes(needle)
      ? `${match.path}: ${match.value}`
      : match.value;
    const matchIndex = searchableValue.toLowerCase().indexOf(needle);
    return [{
      eventId: event.id,
      sessionId: event.sessionId,
      source: event.source,
      workspaceId: event.workspaceId,
      eventName: event.eventName,
      capturedAt: event.capturedAt,
      locator: event.locator,
      path: match.path,
      snippet: createSnippet(searchableValue, matchIndex, needle.length),
    }];
  });
}

function serveStatic(requestPath, response) {
  const pathname = decodeURIComponent(requestPath.split("?")[0]);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = normalize(join(publicDir, relativePath));
  const safePath =
    candidate === publicDir || candidate.startsWith(`${publicDir}${sep}`)
      ? candidate
      : "";
  const filePath =
    safePath && existsSync(safePath) && statSync(safePath).isFile()
      ? safePath
      : join(publicDir, "index.html");

  if (!existsSync(filePath)) {
    sendJson(response, 503, {
      error: "Dashboard is not built. Run pnpm build first.",
    });
    return;
  }

  response.writeHead(200, {
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "Content-Type":
      mimeTypes[extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(response);
}

function openDashboard(url) {
  const command =
    platform() === "darwin"
      ? ["open", [url]]
      : platform() === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const opener = spawn(command[0], command[1], {
      detached: true,
      stdio: "ignore",
    });
    opener.on("error", () => {});
    opener.unref();
  } catch {
    // Opening a browser must never stop the local dashboard.
  }
}

function createDashboardUrl(url) {
  const selectedUrl = new URL(url);
  const source = String(environment.ASTRO_OPEN_SOURCE || "").trim();
  const sessionId = String(environment.ASTRO_OPEN_SESSION || "").trim();
  if (source) {
    selectedUrl.searchParams.set("source", source);
  }
  if (sessionId) {
    selectedUrl.searchParams.set("session", sessionId);
  }
  return selectedUrl.toString();
}

await store.initialize();
store.start();
store.on("event", (event) => broadcast("trace", event));
store.on("reset", () => broadcast("reset", store.getEvents()));
store.on("error", (error) => {
  console.error(`[trace-store] ${error.message}`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${host}`);

  if (request.method === "OPTIONS" && requestUrl.pathname === "/api/events") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers":
        "Content-Type, X-Astro-Source, X-Agent-Trace-Source",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      pid: process.pid,
      url: dashboardUrl,
      clientCount: clients.size,
      eventCount: store.getEvents().length,
      dataRoot,
      traceFiles: store.getTraceFiles(),
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/events") {
    const sessionId = requestUrl.searchParams.get("session");
    const source = requestUrl.searchParams.get("source");
    const events = store
      .getEvents()
      .filter((event) => !sessionId || event.sessionId === sessionId)
      .filter((event) => !source || event.source === source);
    sendJson(response, 200, { events });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/search") {
    const query = requestUrl.searchParams.get("q") || "";
    const sessionId = requestUrl.searchParams.get("session");
    const source = requestUrl.searchParams.get("source");
    const events = store
      .getEvents()
      .filter((event) => !sessionId || event.sessionId === sessionId)
      .filter((event) => !source || event.source === source);
    sendJson(response, 200, {
      query,
      matches: searchEvents(events, query),
    });
    return;
  }

  if (
    request.method === "GET" &&
    requestUrl.pathname.startsWith("/api/events/")
  ) {
    const eventId = decodeURIComponent(
      requestUrl.pathname.slice("/api/events/".length),
    );
    const event = store.getEvent(eventId);
    sendJson(
      response,
      event ? 200 : 404,
      event ? { event } : { error: "Event not found" },
    );
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/events") {
    try {
      const body = await readJsonBody(request);
      const payloads = Array.isArray(body)
        ? body
        : Array.isArray(body.events)
          ? body.events
          : [body.event || body];
      const headerSource =
        request.headers["x-astro-source"] ||
        request.headers["x-agent-trace-source"];
      const events = payloads.map((payload) =>
        createTraceEvent(payload, {
          source: headerSource || payload.source || undefined,
        }),
      );
      const appended = await store.append(events);
      sendJson(
        response,
        202,
        {
          accepted: appended.length,
          events: appended.map(({ id, locator }) => ({ id, locator })),
        },
        { "Access-Control-Allow-Origin": "*" },
      );
    } catch (error) {
      sendJson(
        response,
        error instanceof RangeError ? 413 : 400,
        { error: error.message },
        { "Access-Control-Allow-Origin": "*" },
      );
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/stream") {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    // Keep the snapshot and later events on one ordered connection, including reconnects.
    const events = store.getEvents();
    sendSse(response, "reset", events);
    sendSse(response, "ready", {
      eventCount: events.length,
      connectedAt: new Date().toISOString(),
    });
    request.on("close", () => clients.delete(response));
    return;
  }

  if (request.method === "DELETE" && requestUrl.pathname === "/api/events") {
    store.clear();
    sendJson(response, 200, { status: "cleared" });
    return;
  }

  if (request.method === "GET") {
    serveStatic(requestUrl.pathname, response);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(`[http] ${error.message}`);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const invalidRequest = error instanceof URIError || error instanceof TypeError;
    sendJson(response, invalidRequest ? 400 : 500, {
      error: invalidRequest ? "Invalid request URL." : "Request failed.",
    });
  });
});

function listen(port) {
  const handleListening = () => {
    const url = `http://${host}:${port}`;
    dashboardUrl = url;
    mkdirSync(dirname(pidFile), { recursive: true });
    writeFileSync(
      pidFile,
      `${JSON.stringify({
        pid: process.pid,
        server: fileURLToPath(import.meta.url),
        url,
      })}\n`,
      "utf8",
    );
    console.log(`ASTRO: ${url}`);
    console.log(`Trace data root: ${dataRoot}`);
    if (shouldOpenBrowser) {
      openDashboard(createDashboardUrl(url));
    }
  };

  server.once("listening", handleListening);
  server.once("error", (error) => {
    server.off("listening", handleListening);
    if (error.code === "EADDRINUSE" && port < requestedPort + 20) {
      listen(port + 1);
      return;
    }
    throw error;
  });

  server.listen(port, host);
}

listen(requestedPort);

function removePidFile() {
  if (!pidFile || !existsSync(pidFile)) {
    return;
  }
  try {
    const record = JSON.parse(readFileSync(pidFile, "utf8"));
    if (Number(record.pid) === process.pid) {
      rmSync(pidFile, { force: true });
    }
  } catch {
    // A stale or externally managed PID file is handled by the next launch.
  }
}

function shutdown() {
  store.stop();
  for (const response of clients) {
    response.end();
  }
  server.close(() => {
    removePidFile();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
