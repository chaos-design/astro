import type { CSSProperties } from "react";
import { Check, RotateCcw, Settings } from "lucide-react";

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
  appDefaults,
  defaultHistoryRange,
  getHistoryRangeOption,
  historyRangeOptions,
  themeOptions,
  type ActiveView,
  type HistoryRangeId,
  type Theme,
} from "@/config/app-config";
import { cn } from "@/lib/utils";

type ChoiceIcon = (typeof themeOptions)[number]["icon"];

/**
 * A pick-one row inside a settings section. The tick keeps its slot when the
 * option is unselected (see `.settings-option__check`), so selecting never
 * reflows the grid.
 */
function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  columns,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string; icon?: ChoiceIcon }>;
  value: T;
  columns: number;
  onChange: (next: T) => void;
}) {
  return (
    <div
      className="settings-options"
      role="radiogroup"
      aria-label={label}
      style={{ "--settings-columns": columns } as CSSProperties}
    >
      {options.map((option) => {
        const selected = option.id === value;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            className={cn("settings-option", selected && "is-selected")}
            onClick={() => onChange(option.id)}
          >
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span>{option.label}</span>
            <Check aria-hidden="true" className="settings-option__check" />
          </button>
        );
      })}
    </div>
  );
}

/** A boolean preference: label and explanation left, switch right. */
function SwitchField({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-field settings-field--row">
      <div className="settings-field__copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        className={cn("settings-switch", value && "is-on")}
        onClick={() => onChange(!value)}
      >
        <span className="settings-switch__thumb" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Console settings: every browser-local preference the console has, grouped by
 * what it changes — appearance, RUN HISTORY, the canvas, and the two panels.
 *
 * The dialog edits the same values the panels restore on reload, so there is
 * no apply step and no server round trip. Preferences that also have an inline
 * control (the theme switcher, the deep-view toggle, the panel toggles) are
 * listed here on purpose: one place that lists everything beats hunting the
 * header for the switch that changes what you are looking at.
 */
export function SettingsDialog({
  activeView,
  consoleOpen,
  deepView,
  historyOpen,
  historyRange,
  liveView,
  theme,
  onActiveViewChange,
  onConsoleOpenChange,
  onDeepViewChange,
  onHistoryOpenChange,
  onHistoryRangeChange,
  onLiveViewChange,
  onThemeChange,
}: {
  activeView: ActiveView;
  consoleOpen: boolean;
  deepView: boolean;
  historyOpen: boolean;
  historyRange: HistoryRangeId;
  liveView: boolean;
  theme: Theme;
  onActiveViewChange: (view: ActiveView) => void;
  onConsoleOpenChange: (open: boolean) => void;
  onDeepViewChange: (deepView: boolean) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onHistoryRangeChange: (range: HistoryRangeId) => void;
  onLiveViewChange: (liveView: boolean) => void;
  onThemeChange: (theme: Theme) => void;
}) {
  const activeOption = getHistoryRangeOption(historyRange);
  // Panels open by default on a wide viewport; that width is the default the
  // reset restores (there is no constant "panel is open" value to fall back to).
  const defaultHistoryOpen = window.innerWidth >= appDefaults.historyOpenMinWidth;
  const defaultConsoleOpen = window.innerWidth >= appDefaults.consoleOpenMinWidth;
  const isDefault =
    historyRange === defaultHistoryRange &&
    liveView === appDefaults.liveView &&
    theme === appDefaults.theme &&
    activeView === appDefaults.activeView &&
    deepView === appDefaults.deepView &&
    historyOpen === defaultHistoryOpen &&
    consoleOpen === defaultConsoleOpen;

  const restoreDefaults = () => {
    onHistoryRangeChange(defaultHistoryRange);
    onLiveViewChange(appDefaults.liveView);
    onThemeChange(appDefaults.theme);
    onActiveViewChange(appDefaults.activeView);
    onDeepViewChange(appDefaults.deepView);
    onHistoryOpenChange(defaultHistoryOpen);
    onConsoleOpenChange(defaultConsoleOpen);
  };

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
              <Settings />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">设置</TooltipContent>
      </Tooltip>
      <DialogContent className="settings-dialog sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>
            本地偏好，保存在当前浏览器的 localStorage，不会修改已采集的事件。
          </DialogDescription>
        </DialogHeader>

        <div className="settings-dialog__body">
          <section className="settings-section">
            <header className="settings-section__head">
              <span>外观</span>
              <small>颜色主题</small>
            </header>
            <div className="settings-field">
              <div className="settings-field__copy">
                <strong>主题</strong>
                <span>与顶栏的主题切换器是同一个偏好。</span>
              </div>
              <ChoiceGroup
                label="主题"
                value={theme}
                columns={3}
                onChange={onThemeChange}
                options={themeOptions.map((option) => ({
                  id: option.id,
                  label: option.label,
                  icon: option.icon,
                }))}
              />
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section__head">
              <span>运行历史</span>
              <small>加载范围与 Live 筛选</small>
            </header>
            <div className="settings-field">
              <div className="settings-field__copy">
                <strong>默认时间范围</strong>
                <span>
                  按该范围加载消息，窗口以最近一条消息为终点向前推算（隔夜打开仍能看到
                  上次的会话）；当前：{activeOption.label}。
                </span>
              </div>
              <ChoiceGroup
                label="默认时间范围"
                value={historyRange}
                columns={4}
                onChange={onHistoryRangeChange}
                options={historyRangeOptions.map((option) => ({
                  id: option.id,
                  label: option.shortLabel,
                }))}
              />
            </div>
            <SwitchField
              label="Live 筛选"
              description="只显示正在执行的消息，不受时间范围限制；没有消息在执行时列表为空。面板头部的 LIVE 胶囊可随时切换。"
              value={liveView}
              onChange={onLiveViewChange}
            />
          </section>

          <section className="settings-section">
            <header className="settings-section__head">
              <span>画布</span>
              <small>拓扑与轨迹</small>
            </header>
            <div className="settings-field">
              <div className="settings-field__copy">
                <strong>默认视图</strong>
                <span>打开一条消息时先显示哪种画布。</span>
              </div>
              <ChoiceGroup
                label="默认视图"
                value={activeView}
                columns={2}
                onChange={onActiveViewChange}
                options={[
                  { id: "topology" as const, label: "执行拓扑" },
                  { id: "trajectory" as const, label: "运行轨迹" },
                ]}
              />
            </div>
            <SwitchField
              label="仅显示运行时原子"
              description="拓扑图隐藏不参与本次执行的原子，只保留运行时路径。"
              value={deepView}
              onChange={onDeepViewChange}
            />
          </section>

          <section className="settings-section">
            <header className="settings-section__head">
              <span>面板</span>
              <small>左右两列的展开状态</small>
            </header>
            <SwitchField
              label="展开 RUN HISTORY"
              description="左侧运行历史列默认展开。"
              value={historyOpen}
              onChange={onHistoryOpenChange}
            />
            <SwitchField
              label="展开 EVENTS"
              description="右侧事件日志与检查器默认展开。"
              value={consoleOpen}
              onChange={onConsoleOpenChange}
            />
          </section>
        </div>

        <div className="settings-footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isDefault}
            onClick={restoreDefaults}
          >
            <RotateCcw data-icon="inline-start" />
            恢复默认
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
