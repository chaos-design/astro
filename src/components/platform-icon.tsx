import type { CSSProperties } from "react";
import type { PlatformId } from "../types/trace";
import {
  ClaudeIcon,
  ClineIcon,
  CopilotIcon,
  CursorIcon,
  GeminiIcon,
  GptIcon,
  IflowIcon,
  LlamaIcon,
  OpencodeIcon,
  PiAgentIcon,
  QwenIcon,
  TraeIcon,
  WindsurfIcon,
  ZCodeIcon,
} from "./agent-icons";

/**
 * Agents with an official brand mark render it through a lucide icon so the
 * dropdown keeps one sizing and coloring contract for every entry. Codex uses
 * the OpenAI knot. DeepSeek and WorkBuddy ship raster logos and are
 * special-cased below.
 */
const brandIcons: Readonly<
  Partial<Record<PlatformId, typeof ClaudeIcon>>
> = {
  claude: ClaudeIcon,
  codex: GptIcon,
  gemini: GeminiIcon,
  llama: LlamaIcon,
  pi: PiAgentIcon,
  qwen: QwenIcon,
  copilot: CopilotIcon,
  cursor: CursorIcon,
  cline: ClineIcon,
  windsurf: WindsurfIcon,
  iflow: IflowIcon,
  trae: TraeIcon,
  opencode: OpencodeIcon,
  zcode: ZCodeIcon,
};

type PlatformIconProps = {
  platform: PlatformId;
  className?: string;
  height?: number | string;
  style?: CSSProperties;
  width?: number | string;
};

export function PlatformIcon({
  platform,
  className,
  ...props
}: PlatformIconProps) {
  const iconClassName = [
    "platform-icon",
    `platform-icon--${platform}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (platform === "deepseek") {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={iconClassName}
        decoding="async"
        loading="lazy"
        src="/icons/deepseek.svg"
        {...props}
      />
    );
  }
  if (platform === "workbuddy") {
    return (
      <svg
        aria-hidden="true"
        className={iconClassName}
        focusable="false"
        viewBox="0 0 560 560"
        {...props}
      >
        <image
          height="560"
          href="/icons/workbuddy-logo.png"
          preserveAspectRatio="xMinYMid slice"
          width="1620"
        />
      </svg>
    );
  }
  const BrandIcon = brandIcons[platform];
  if (!BrandIcon) {
    // Defensive: every PlatformId is covered above; an unknown id keeps the
    // icon slot filled with a neutral dot instead of rendering nothing.
    return (
      <svg
        aria-hidden="true"
        className={iconClassName}
        fill="currentColor"
        viewBox="0 0 24 24"
        {...props}
      >
        <circle cx="12" cy="12" r="6" />
      </svg>
    );
  }
  return <BrandIcon aria-hidden="true" className={iconClassName} {...props} />;
}
