/**
 * Out-of-band commands for a local service that cannot answer HTTP.
 *
 * A static console cannot spawn a process on the reader's machine. When the
 * service is unreachable the restart control copies one of these commands
 * instead of pretending the `/api/restart` call worked. The port comes from the
 * same resolved API base every other request uses, with the page origin as the
 * same-origin fallback, so the command always targets the service this page
 * was configured for.
 */
export function servicePortFromApiBase(apiBase: string, origin = "") {
  for (const candidate of [apiBase, origin]) {
    if (!candidate) {
      continue;
    }
    try {
      const parsed = new URL(candidate);
      const port = Number(parsed.port);
      if (port > 0) {
        return port;
      }
      return parsed.protocol === "https:" ? 443 : 80;
    } catch {
      // Try the next candidate.
    }
  }
  return 5678;
}

export interface ServiceCliCommands {
  /** Command for a repository checkout (has the `service:*` scripts). */
  repo: string;
  /** Command for an installed bundle (ships only `astro-trace serve`). */
  installed: string;
}

export function buildServiceCliCommands(
  apiBase: string,
  origin = "",
): ServiceCliCommands {
  const port = servicePortFromApiBase(apiBase, origin);
  return {
    repo: `pnpm service:up --port=${port}`,
    installed: `ASTRO_PORT=${port} astro-trace serve`,
  };
}

/** Compact notice that never claims the command was copied when it was not. */
export function offlineRestartNotice(copied: boolean, commands: ServiceCliCommands) {
  return copied
    ? `已复制启动命令：${commands.repo}（安装态：${commands.installed}）`
    : `请手动复制启动命令：${commands.repo}（安装态：${commands.installed}）`;
}

export function serviceCardHint(syncPaused: boolean, offline: boolean) {
  if (offline) {
    return "服务不可达：重启按钮只复制启动命令，不会向死端口发起请求。启动后再点按钮即可原地重启。";
  }
  return syncPaused
    ? "已按「最长同步时长」停止接收新事件；重启服务、点击顶部 paused 标记，或在设置中调高「最长同步时长」，都可以继续同步。"
    : "重启会保留当前端口，页面与事件流会自动重连。";
}
