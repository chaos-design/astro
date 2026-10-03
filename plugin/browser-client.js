const defaultEndpoint = "http://127.0.0.1:4318/api/events";

function createId(prefix) {
  const value =
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

export class AstroClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || defaultEndpoint;
    this.source = options.source || "browser";
    this.sessionId = options.sessionId || createId("session");
    this.workspaceId =
      options.workspaceId ||
      globalThis.location?.host ||
      "browser-extension";
    this.context = options.context || {};
  }

  async capture(eventName, payload = {}, options = {}) {
    const event = {
      schemaVersion: 2,
      id: options.id || createId("event"),
      capturedAt: options.capturedAt || new Date().toISOString(),
      source: this.source,
      sourceVersion: options.sourceVersion || null,
      workspaceId: options.workspaceId || this.workspaceId,
      sessionId: options.sessionId || this.sessionId,
      turnId: options.turnId || null,
      parentId: options.parentId || null,
      eventName,
      nativeEventName: options.nativeEventName || eventName,
      toolUseId: options.toolUseId || null,
      toolName: options.toolName || null,
      cwd: options.cwd || globalThis.location?.href || null,
      status: options.status || null,
      payload: {
        ...this.context,
        ...payload,
      },
    };
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Astro-Source": this.source,
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(
        `ASTRO ingest failed with HTTP ${response.status}.`,
      );
    }
    const result = await response.json();
    return { ...event, ...result.events?.[0] };
  }

  startSession(payload = {}) {
    return this.capture("SessionStart", payload);
  }

  submitPrompt(prompt, payload = {}) {
    return this.capture("UserPromptSubmit", { ...payload, prompt });
  }

  startTool(toolName, toolInput, options = {}) {
    const toolUseId = options.toolUseId || createId("tool");
    return this.capture(
      "PreToolUse",
      { ...options.payload, tool_input: toolInput },
      { ...options, toolName, toolUseId },
    ).then((event) => ({ ...event, toolUseId }));
  }

  finishTool(toolName, toolUseId, toolResponse, options = {}) {
    return this.capture(
      options.failed ? "PostToolUseFailure" : "PostToolUse",
      { ...options.payload, tool_response: toolResponse },
      {
        ...options,
        status: options.failed ? "failed" : options.status,
        toolName,
        toolUseId,
      },
    );
  }

  agentMessage(message, payload = {}) {
    return this.capture("AgentMessage", { ...payload, message });
  }

  stop(payload = {}) {
    return this.capture("Stop", payload);
  }

  async search(query, filters = {}) {
    const url = new URL(this.endpoint.replace(/\/events$/, "/search"));
    url.searchParams.set("q", query);
    if (filters.sessionId) {
      url.searchParams.set("session", filters.sessionId);
    }
    if (filters.source) {
      url.searchParams.set("source", filters.source);
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `ASTRO search failed with HTTP ${response.status}.`,
      );
    }
    return response.json();
  }
}

export function createAstroClient(options) {
  return new AstroClient(options);
}
