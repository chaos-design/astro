import { Plugin } from "@opencode/plugin"
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const recorder = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "plugin",
  "trace-recorder.cjs",
)

function send(payload: Record<string, unknown>) {
  try {
    const child = spawn("node", [recorder, "--source=opencode", "--quiet"], {
      stdio: ["pipe", "ignore", "pipe"],
    })
    child.stdin.on("error", () => {})
    child.stderr.on("data", () => {})
    child.stdin.end(JSON.stringify(payload))
  } catch {
    // Observability must never interrupt the agent execution path.
  }
}

export default Plugin.define({
  id: "astro-capture",
  async setup(ctx) {
    const location = ctx.location.directory
    const seenSessions = new Set<string>()
    const sessionDirs = new Map<string, string>()

    const eventDirectory = (event: any): string => {
      const direct =
        event?.location?.directory ||
        event?.data?.location?.directory ||
        event?.data?.info?.location?.directory ||
        ""
      if (direct) {
        return direct
      }
      const sessionId = event?.data?.sessionID
      return (sessionId && sessionDirs.get(sessionId)) || ""
    }

    const emit = (
      event: any,
      eventName: string,
      extra: Record<string, unknown> = {},
    ) => {
      const sessionId = event?.data?.sessionID
      if (!sessionId) {
        return
      }
      const directory = eventDirectory(event)
      if (directory) {
        sessionDirs.set(sessionId, directory)
      }
      // The event stream is global and every location runs a plugin instance;
      // only the instance that owns this session's directory may record it.
      if (directory && directory !== location) {
        return
      }
      if (!directory && sessionDirs.has(sessionId) === false) {
        return
      }
      if (!seenSessions.has(sessionId)) {
        seenSessions.add(sessionId)
        send({ eventName: "SessionStart", sessionId, cwd: directory })
      }
      send({ eventName, sessionId, cwd: directory, ...extra })
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        }) as AsyncIterable<any>) {
          const type = event?.type
          const data = event?.data ?? {}
          switch (type) {
            case "session.created": {
              const sessionId = data?.sessionID
              if (!sessionId) break
              const directory = eventDirectory(event)
              if (directory) sessionDirs.set(sessionId, directory)
              if (directory && directory !== location) break
              if (!seenSessions.has(sessionId)) {
                seenSessions.add(sessionId)
                send({ eventName: "SessionStart", sessionId, cwd: directory })
              }
              break
            }
            case "session.inbox.enqueued":
              if (data?.item?.type === "user") {
                emit(event, "UserPromptSubmit", {
                  prompt: data?.item?.payload?.text,
                })
              }
              break
            case "session.step.started":
              emit(event, "Notification", {
                message: `step started (${data?.model?.id ?? "unknown"})`,
              })
              break
            case "session.tool.called":
              emit(event, "PreToolUse", {
                toolUseId: data?.id,
                toolName: data?.name,
                tool_input: data?.input,
              })
              break
            case "session.tool.success":
              emit(event, "PostToolUse", {
                toolUseId: data?.id,
                tool_response: data?.content,
              })
              break
            case "session.tool.error":
            case "session.tool.failed":
              emit(event, "PostToolUseFailure", {
                toolUseId: data?.id,
                tool_response: data?.error ?? data?.content,
                status: "failed",
              })
              break
            case "session.reasoning.ended":
              emit(event, "Reasoning", { message: data?.text })
              break
            case "session.text.ended":
              emit(event, "AgentMessage", { message: data?.text })
              break
            case "session.execution.succeeded":
              emit(event, "Stop")
              break
            case "session.execution.failed":
              emit(event, "StopFailure", { status: "failed" })
              break
            case "session.execution.interrupted":
            case "session.execution.aborted":
              emit(event, "Interrupt")
              break
            case "session.deleted":
              emit(event, "SessionEnd")
              break
          }
        }
      } catch {
        // Stream closed or plugin unloaded.
      }
    })()

    return () => controller.abort()
  },
})
