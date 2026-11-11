import type { CSSProperties } from "react";
// `?inline` forces a data URI: the tile must be decoded with the first paint,
// never fetched after the dropdown mounts.
import workbuddyIcon from "../assets/workbuddy-icon.png?inline";
import type { PlatformId } from "../types/trace";
import {
  ClaudeIcon,
  ClineIcon,
  CopilotIcon,
  CursorIcon,
  DeepSeekIcon,
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
 * the OpenAI knot, DeepSeek inlines its whale path, and WorkBuddy is the one
 * raster tile (inlined at build time) — every mark is available synchronously,
 * so opening the dropdown never paints an empty icon slot first.
 */
const brandIcons: Readonly<
  Partial<Record<PlatformId, typeof ClaudeIcon>>
> = {
  claude: ClaudeIcon,
  codex: GptIcon,
  deepseek: DeepSeekIcon,
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

  if (platform === "workbuddy") {
    // The mark is a raster app tile. Vite inlines it (well under the asset
    // limit), and `decoding="sync"` forces the decode before the first paint:
    // a lazily fetched `<img>`/`<image>` painted an empty square for a frame
    // every time the picker opened.
    return (
      <img
        alt=""
        aria-hidden="true"
        className={iconClassName}
        decoding="sync"
        draggable={false}
        loading="eager"
        src={workbuddyIcon}
        {...props}
      />
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
