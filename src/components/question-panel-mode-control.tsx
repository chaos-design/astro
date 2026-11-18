import { AppWindow, Maximize2, PanelBottom } from "lucide-react";
import type { QuestionPanelMode } from "@/config/app-config";
import {
  questionPanelModeLabels,
  questionPanelModes,
} from "../lib/question-panel-model";

const modeIcons = {
  "dock-half": PanelBottom,
  "dock-full": Maximize2,
  float: AppWindow,
} as const;

/**
 * One layout switch for every question surface: the docked panel inside the
 * EVENTS inspector and the floating card over the canvas read the same
 * preference, so switching placement cannot leave one surface docked while the
 * other one still floats.
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
        const label = questionPanelModeLabels[item];
        return (
          <button
            aria-label={label}
            aria-pressed={mode === item}
            className="question-mode-control__button"
            key={item}
            onClick={() => onChange(item)}
            title={label}
            type="button"
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
