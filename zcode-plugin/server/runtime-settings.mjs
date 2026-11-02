/**
 * Runtime settings the console may change.
 *
 * Kept separate from `server.mjs` so the file rewriting is testable without
 * starting a service. The only setting so far is the trace directory: it is
 * persisted into the plugin `.env` because an installed runtime is started by
 * a recorder hook, not a shell, and `.env` is already read on every launch by
 * both the service and the recorders.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const traceDirectoryLine =
  /^\s*(?:export\s+)?(?:ASTRO_TRACE_DIR|AGENT_TRACE_DIR|TRAE_TRACE_DIR)\s*=/;

/**
 * Replace (or remove) the trace-directory entry in `.env`.
 *
 * `value` is what the reader typed. An empty value clears the override and
 * falls back to `defaultRoot`; a non-empty one must resolve to an existing
 * absolute directory, so a typo fails loudly instead of creating an empty
 * tree. Every other line, including comments, is preserved in order.
 */
export function writeTraceDirectory({
  envFile,
  defaultRoot,
  value,
  home = homedir(),
}) {
  const trimmed = String(value ?? "").trim();
  let dataRoot = defaultRoot;
  let line = "";
  if (trimmed) {
    const expanded =
      trimmed === "~"
        ? home
        : trimmed.startsWith("~/")
          ? join(home, trimmed.slice(2))
          : trimmed;
    if (!isAbsolute(expanded)) {
      return { ok: false, error: "数据目录必须是绝对路径，或以 ~/ 开头。" };
    }
    let stats;
    try {
      stats = statSync(expanded);
    } catch {
      return { ok: false, error: "数据目录不存在，请先创建该文件夹。" };
    }
    if (!stats.isDirectory()) {
      return { ok: false, error: "数据目录不是文件夹。" };
    }
    dataRoot = expanded;
    line = `ASTRO_TRACE_DIR=${expanded}`;
  }

  let text = "";
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    // A missing .env is normal on a runtime that never wrote one.
  }
  const kept = text
    .split(/\r?\n/)
    .filter((entry) => !traceDirectoryLine.test(entry));
  while (kept.length && !kept.at(-1).trim()) {
    kept.pop();
  }
  if (line) {
    kept.push(line);
  }
  mkdirSync(dirname(envFile), { recursive: true });
  writeFileSync(envFile, `${kept.join("\n")}\n`, { mode: 0o600 });
  return { ok: true, dataRoot };
}
