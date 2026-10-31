import { useState } from "react";
import type { CSSProperties } from "react";
import {
  Check,
  History,
  Info,
  Network,
  Palette,
  PanelsTopLeft,
  RotateCcw,
  Settings,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  appDefaults,
  appVersion,
  defaultHistoryRange,
  historyRangeOptions,
  storageKeys,
  themeOptions,
  type ActiveView,
  type HistoryRangeId,
  type Theme,
} from "@/config/app-config";
import { cn } from "@/lib/utils";

type ChoiceIcon = (typeof themeOptions)[number]["icon"];

/**
 * Sections are the left rail of the dialog and the anchor of the right pane.
 * One list drives both, so a preference can never be added to a pane the rail
 * does not name.
 */
const settingsSections = [
  {
    id: "appearance",
    label: "外观",
    hint: "主题与配色",
    title: "外观",
    description: "控制台使用的颜色主题，与顶栏的主题切换器是同一个偏好。",
    icon: Palette,
  },
  {
    id: "history",
    label: "运行历史",
    hint: "范围与实时筛选",
    title: "运行历史",
    description:
      "RUN HISTORY 的默认加载范围，以及只显示正在执行消息的 Live 筛选。",
    icon: History,
  },
  {
    id: "canvas",
    label: "画布",
    hint: "拓扑与轨迹",
    title: "画布",
    description: "打开一条消息时默认展示的画布，以及拓扑的原子可见性。",
    icon: Network,
  },
  {
    id: "panels",
    label: "面板",
    hint: "分栏展开状态",
    title: "面板",
    description: "左右两列在打开控制台时的展开状态；面板头部的箭头可随时切换。",
    icon: PanelsTopLeft,
  },
  {
    id: "about",
    label: "关于",
    hint: "版本与本地存储",
    title: "关于",
    description: "当前控制台版本，以及这些偏好实际存放的位置。",
    icon: Info,
  },
] as const;

type SettingsSectionId = (typeof settingsSections)[number]["id"];

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
 *
 * The layout is a two-pane card — section rail on the left, the active
 * section's fields on the right — because a single stacked column either
 * scrolled the whole dialog or squeezed every control on a short window.
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
  const [section, setSection] = useState<SettingsSectionId>("appearance");
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

  const activeSection =
    settingsSections.find((entry) => entry.id === section) ?? settingsSections[0];
  // Every preference key starts with the same namespace; show the prefix once
  // instead of listing nine storage keys the user never types.
  const storagePrefix = `${
    storageKeys.theme.slice(0, storageKeys.theme.indexOf("_")) || "ASTROX"
  }_`;

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
      <DialogContent className="settings-dialog">
        <DialogHeader className="settings-dialog__header">
          <div className="settings-dialog__title">
            <span className="eyebrow">CONSOLE SETTINGS</span>
            <DialogTitle>设置</DialogTitle>
          </div>
          <DialogDescription>
            本地偏好，保存在当前浏览器的 localStorage，不会修改已采集的事件。
          </DialogDescription>
        </DialogHeader>

        <Tabs
          className="settings-dialog__layout"
          orientation="vertical"
          value={section}
          onValueChange={(value) => setSection(value as SettingsSectionId)}
        >
          <TabsList className="settings-nav" aria-label="设置分区">
            {settingsSections.map((entry) => {
              const Icon = entry.icon;
              return (
                <TabsTrigger
                  key={entry.id}
                  className="settings-nav__item"
                  value={entry.id}
                >
                  <Icon aria-hidden="true" className="settings-nav__icon" />
                  <span className="settings-nav__copy">
                    <strong>{entry.label}</strong>
                    <small>{entry.hint}</small>
                  </span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="settings-pane">
            <header className="settings-pane__head">
              <h3>{activeSection.title}</h3>
              <p>{activeSection.description}</p>
            </header>

            <TabsContent className="settings-section" value="appearance">
              <div className="settings-field">
                <div className="settings-field__copy">
                  <strong>主题</strong>
                  <span>
                    深色为默认外观，浅色适合投影与打印，跟随系统则随操作系统切换。
                  </span>
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
            </TabsContent>

            <TabsContent className="settings-section" value="history">
              <div className="settings-field">
                <div className="settings-field__copy">
                  <strong>默认时间范围</strong>
                  <span>
                    按该范围加载消息；窗口以最近一条消息为终点向前推算，隔夜打开仍能看到上次的会话。
                  </span>
                </div>
                <ChoiceGroup
                  label="默认时间范围"
                  value={historyRange}
                  columns={5}
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
            </TabsContent>

            <TabsContent className="settings-section" value="canvas">
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
            </TabsContent>

            <TabsContent className="settings-section" value="panels">
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
            </TabsContent>

            <TabsContent className="settings-section" value="about">
              <dl className="settings-about">
                <div>
                  <dt>控制台版本</dt>
                  <dd>
                    <code>v{appVersion}</code>
                  </dd>
                </div>
                <div>
                  <dt>偏好存储</dt>
                  <dd>
                    {`当前浏览器的 localStorage，键前缀 `}
                    <code>{storagePrefix}</code>
                    {`；清除站点数据会一并清除这些偏好。`}
                  </dd>
                </div>
                <div>
                  <dt>数据写入</dt>
                  <dd>
                    设置只影响展示，不会写回事件文件，也不会改变已记录的状态。
                  </dd>
                </div>
              </dl>
            </TabsContent>
          </div>
        </Tabs>

        <div className="settings-footer">
          <p className="settings-footer__note">
            <span aria-hidden="true" />
            更改即时生效，无需应用
          </p>
          <div className="settings-footer__actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="settings-footer__button"
              disabled={isDefault}
              onClick={restoreDefaults}
            >
              <RotateCcw data-icon="inline-start" />
              恢复默认
            </Button>
            <DialogClose asChild>
              <Button type="button" size="sm" className="settings-footer__button">
                完成
              </Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
