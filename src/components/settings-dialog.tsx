import { Check, RotateCcw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  defaultHistoryRange,
  getHistoryRangeOption,
  historyRangeOptions,
  type HistoryRangeId,
} from "@/config/app-config";
import { cn } from "@/lib/utils";

/**
 * Console settings. Everything here is a persisted browser preference, so the
 * dialog edits the same values the panels restore on reload — there is no
 * apply step and no server round trip.
 *
 * The only setting for now is the default history range: RUN HISTORY's visible
 * window and the global search dialog's initial time range, so "the messages I
 * load by default" means one thing rather than two.
 */
export function SettingsDialog({
  historyRange,
  onHistoryRangeChange,
}: {
  historyRange: HistoryRangeId;
  onHistoryRangeChange: (range: HistoryRangeId) => void;
}) {
  const activeOption = getHistoryRangeOption(historyRange);
  const isDefault = historyRange === defaultHistoryRange;

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="console"
              size="console-icon"
              className="settings-trigger"
              aria-label="打开设置"
            >
              <SlidersHorizontal />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">设置</TooltipContent>
      </Tooltip>
      <DialogContent className="settings-dialog sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            本地偏好，保存在当前浏览器的 localStorage，不会修改已采集的事件。
          </DialogDescription>
        </DialogHeader>

        <section className="settings-field">
          <div className="settings-field__copy">
            <strong>默认时间范围</strong>
            <span>
              RUN HISTORY 与历史搜索按该范围加载消息。当前：
              {activeOption.label}。
            </span>
          </div>
          <div
            className="settings-range-grid"
            role="radiogroup"
            aria-label="默认时间范围"
          >
            {historyRangeOptions.map((option) => {
              const selected = option.id === historyRange;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    "settings-range-option",
                    selected && "is-selected",
                  )}
                  onClick={() => onHistoryRangeChange(option.id)}
                >
                  <span>{option.shortLabel}</span>
                  <Check
                    aria-hidden="true"
                    className="settings-range-option__check"
                  />
                </button>
              );
            })}
          </div>
        </section>

        <p className="settings-note">
          时间范围以最近一条消息的时间为终点向前推算，因此隔夜或长时间空闲后打开
          控制台仍能看到上次的消息；正在执行的消息不受时间范围限制，始终置顶显示。
        </p>

        <div className="settings-footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDefault}
            onClick={() => onHistoryRangeChange(defaultHistoryRange)}
          >
            <RotateCcw data-icon="inline-start" />
            恢复默认（3 小时）
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
