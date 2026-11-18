import { PanelBottom, PanelRightOpen, Rows2 } from "lucide-react";
import type { QuestionPanelMode } from "@/config/app-config";
import { questionPanelModes } from "../lib/question-panel-model";

const modeIcons = {
  half: Rows2,
  bottom: PanelBottom,
  side: PanelRightOpen,
} as const;

const modeLabels: Record<QuestionPanelMode, string> = {
  half: "半区域",
  bottom: "底部全部区域",
  side: "侧边展开",
};

/**
 * One layout switch for both question surfaces: the floating card and the
 * inspector answer box read the same preference, so switching modes cannot
 * leave one surface narrow while the other is expanded.
 */
export function QuestionPanelModeControl({
  mode,
  onChange,
  className,
}: {
  mode: QuestionPanelMode;
  onChange: (mode: QuestionPanelMode) => void;
  className?: string;
}) {
  return (
    <div
      aria-label="问题面板布局"
      className={
        className
          ? `question-mode-control ${className}`
          : "question-mode-control"
      }
      role="group"
    >
      {questionPanelModes.map((item) => {
        const Icon = modeIcons[item];
        return (
          <button
            aria-label={modeLabels[item]}
            aria-pressed={mode === item}
            className="question-mode-control__button"
            key={item}
            onClick={() => onChange(item)}
            title={modeLabels[item]}
            type="button"
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
