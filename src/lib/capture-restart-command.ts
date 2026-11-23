/**
 * Out-of-band commands for a capture adapter whose running process is older
 * than the files on disk. A static console cannot restart a host process, so
 * when the service reports capture-version drift it copies the right command
 * instead of claiming to have applied it.
 *
 * The source spellings are the ones TraceEvent uses (`opencode`, `pi`). Only
 * long-lived adapters need this — hook clients start a fresh process per call.
 */
export function captureRestartCommand(source: string): string | null {
  if (source === "opencode") {
    return "opencode service restart";
  }
  if (source === "pi") {
    return "# Pi 没有常驻服务：退出并重新打开对应的 Pi 会话以加载新扩展";
  }
  return null;
}

export function captureRestartNotice(source: string, copied: boolean): string {
  const command = captureRestartCommand(source);
  if (!command) {
    return `请重启 ${source} 的采集进程以加载新插件。`;
  }
  return copied
    ? `已复制 ${source} 的处理指令：${command}`
    : `请手动执行 ${source} 的处理指令：${command}`;
}
