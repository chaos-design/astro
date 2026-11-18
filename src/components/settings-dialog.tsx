import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Bell,
  Check,
  CheckCircle2,
  CircleStop,
  CircleX,
  Gauge,
  History,
  Info,
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
  appDefaults,
  appVersion,
  chimeStyleOptions,
  defaultHistoryRange,
  historyRangeOptions,
  maxSyncOptions,
  storageKeys,
  themeOptions,
  type ActiveView,
  type ChimeStyleId,
  type HistoryRangeId,
  type MaxSyncId,
  type QuestionPanelMode,
  type Theme,
} from "@/config/app-config";
import { playTaskCompletionChime } from "@/lib/task-completion-chime";
import {
  questionPanelModeLabels,
  questionPanelModes,
} from "@/lib/question-panel-model";
import { cn } from "@/lib/utils";

type ChoiceIcon = (typeof themeOptions)[number]["icon"];

/** Terminal states the chime distinguishes, in the same order in every style. */
const chimePreviewOptions = [
  { status: "complete", label: "完成音", icon: CheckCircle2 },
  { status: "failed", label: "失败音", icon: CircleX },
  { status: "terminated", label: "终止音", icon: CircleStop },
] as const;

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
      "RUN HISTORY 的默认加载范围、只显示正在执行消息的 Live 筛选，以及控制台接收事件流的最长时间。",
    icon: History,
  },
  {
    id: "layout",
    label: "布局",
    hint: "画布与面板",
    title: "布局",
    description:
      "一条菜单管完观看方式：画布默认显示哪种视图、显示哪些原子，左右两栏打开到什么程度，以及问题面板停在哪里。",
    icon: PanelsTopLeft,
  },
  {
    id: "perf",
    label: "性能",
    hint: "诊断面板",
    title: "性能",
    description:
      "页面性能诊断面板：滚动帧率、列表渲染与长任务。只采集、不修改已记录的事件。",
    icon: Gauge,
  },
  {
    id: "notifications",
    label: "通知",
    hint: "任务完成提示音",
    title: "通知",
    description: "运行进入完成、失败或终止状态时是否播放一段简短提示音。",
    icon: Bell,
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

/**
 * One labelled cluster inside a section. The layout section holds two kinds of
 * preference — how the canvas draws and how the panels open — and a reader
 * should be able to tell them apart without parsing every row.
 */
function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <header className="settings-group__head">
        <h4>{title}</h4>
        <p>{description}</p>
      </header>
      {children}
    </section>
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
 * what it changes — appearance, RUN HISTORY, the canvas, the two panels,
 * notifications, and the performance HUD.
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
  chimeStyle,
  consoleOpen,
  deepView,
  historyOpen,
  historyRange,
  liveView,
  maxSync,
  perfHud,
  questionPanelMode,
  taskCompletionChime,
  theme,
  onActiveViewChange,
  onChimeStyleChange,
  onConsoleOpenChange,
  onDeepViewChange,
  onHistoryOpenChange,
  onHistoryRangeChange,
  onLiveViewChange,
  onMaxSyncChange,
  onPerfHudChange,
  onQuestionPanelModeChange,
  onTaskCompletionChimeChange,
  onThemeChange,
}: {
  activeView: ActiveView;
  chimeStyle: ChimeStyleId;
  consoleOpen: boolean;
  deepView: boolean;
  historyOpen: boolean;
  historyRange: HistoryRangeId;
  liveView: boolean;
  maxSync: MaxSyncId;
  perfHud: boolean;
  questionPanelMode: QuestionPanelMode;
  taskCompletionChime: boolean;
  theme: Theme;
  onActiveViewChange: (view: ActiveView) => void;
  onChimeStyleChange: (style: ChimeStyleId) => void;
  onConsoleOpenChange: (open: boolean) => void;
  onDeepViewChange: (deepView: boolean) => void;
  onHistoryOpenChange: (open: boolean) => void;
  onHistoryRangeChange: (range: HistoryRangeId) => void;
  onLiveViewChange: (liveView: boolean) => void;
  onMaxSyncChange: (maxSync: MaxSyncId) => void;
  onPerfHudChange: (perfHud: boolean) => void;
  onQuestionPanelModeChange: (mode: QuestionPanelMode) => void;
  onTaskCompletionChimeChange: (value: boolean) => void;
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
    maxSync === appDefaults.maxSync &&
    perfHud === appDefaults.perfHud &&
    taskCompletionChime === appDefaults.taskCompletionChime &&
    chimeStyle === appDefaults.chimeStyle &&
    theme === appDefaults.theme &&
    activeView === appDefaults.activeView &&
    deepView === appDefaults.deepView &&
    questionPanelMode === appDefaults.questionPanelMode &&
    historyOpen === defaultHistoryOpen &&
    consoleOpen === defaultConsoleOpen;

  const restoreDefaults = () => {
    onHistoryRangeChange(defaultHistoryRange);
    onLiveViewChange(appDefaults.liveView);
    onMaxSyncChange(appDefaults.maxSync);
    onPerfHudChange(appDefaults.perfHud);
    onTaskCompletionChimeChange(appDefaults.taskCompletionChime);
    onChimeStyleChange(appDefaults.chimeStyle);
    onThemeChange(appDefaults.theme);
    onActiveViewChange(appDefaults.activeView);
    onDeepViewChange(appDefaults.deepView);
    onQuestionPanelModeChange(appDefaults.questionPanelMode);
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
      {/* A gear is unambiguous, so the trigger keeps only its `aria-label`
          instead of a hover card that repeats "设置". */}
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
                description="只显示当前智能体正在执行的消息，不受时间范围限制；该智能体没有消息在执行时列表为空。面板头部的 LIVE 胶囊可随时切换。"
                value={liveView}
                onChange={onLiveViewChange}
              />
              <div className="settings-field">
                <div className="settings-field__copy">
                  <strong>最长同步时长</strong>
                  <span>
                    控制台连续接收事件流的上限，默认 8 小时。到点后自动断开事件流、不再
                    接收新消息以控制内存；顶部 synced 标记会变成 paused，点击它或重启本地
                    服务即可继续同步。
                  </span>
                </div>
                <ChoiceGroup
                  label="最长同步时长"
                  value={maxSync}
                  columns={3}
                  onChange={onMaxSyncChange}
                  options={maxSyncOptions.map((option) => ({
                    id: option.id,
                    label: option.label,
                  }))}
                />
              </div>
            </TabsContent>

            <TabsContent className="settings-section" value="layout">
              <SettingsGroup
                description="打开一条消息时先看哪种画法，以及拓扑里留下哪些原子。画布只影响作图范围，不改动已采集的事件。"
                title="画布"
              >
                <div className="settings-field">
                  <div className="settings-field__copy">
                    <strong>默认视图</strong>
                    <span>
                      打开一条消息时先显示哪种画布：执行拓扑看原子与连线，运行轨迹按轮次顺序看每一步。顶栏的两个图标可随时切换。
                    </span>
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
                  description="拓扑图隐藏不参与本次执行的原子，只保留运行时路径；关闭后显示完整的原子定义。"
                  value={deepView}
                  onChange={onDeepViewChange}
                />
              </SettingsGroup>

              <SettingsGroup
                description="左右两列各自占多少宽度，以及提问作答面板停在哪里。两者都是展示偏好，不影响事件流。"
                title="面板"
              >
                <SwitchField
                  label="展开 RUN HISTORY"
                  description="左侧运行历史列默认展开；收起后只留一条竖排文字，点箭头随时展开。"
                  value={historyOpen}
                  onChange={onHistoryOpenChange}
                />
                <SwitchField
                  label="展开 EVENTS"
                  description="右侧事件日志与检查器默认展开；收起后同样留一条竖排标签。"
                  value={consoleOpen}
                  onChange={onConsoleOpenChange}
                />
                <div className="settings-field">
                  <div className="settings-field__copy">
                    <strong>问题面板布局</strong>
                    <span>
                      提问到达时作答面板停在哪里：区域半屏占用检查器下半部分，区域全屏铺满 Tab 以下整个详情区，悬浮则浮在画布上、只在高亮的提问原子上出现。面板头部的三个图标可随时切换。
                    </span>
                  </div>
                  <ChoiceGroup
                    label="问题面板布局"
                    value={questionPanelMode}
                    columns={3}
                    onChange={onQuestionPanelModeChange}
                    options={questionPanelModes.map((mode) => ({
                      id: mode,
                      label: questionPanelModeLabels[mode],
                    }))}
                  />
                </div>
              </SettingsGroup>
            </TabsContent>

            <TabsContent className="settings-section" value="perf">
              <SwitchField
                label="性能面板"
                description="在页面右下角浮出性能诊断面板：滚动帧率、列表渲染、长任务，可拖动；状态保存在浏览器本地，只采集、不写回事件。"
                value={perfHud}
                onChange={onPerfHudChange}
              />
            </TabsContent>

            <TabsContent className="settings-section" value="notifications">
              <SwitchField
                label="任务完成提示音"
                description="某条运行进入完成、失败或终止状态时播放一段简短提示音，状态不同音调不同：完成上行、失败下行、终止中性双击；示例数据不会触发。默认开启，可在设置里关闭；浏览器在首次交互后才允许播放声音。"
                value={taskCompletionChime}
                onChange={onTaskCompletionChimeChange}
              />
              <div className="settings-field">
                <div className="settings-field__copy">
                  <strong>提示音音色</strong>
                  <span>
                    更换提示音的音色与节奏；无论选哪种，完成上行、失败下行、终止中性的状态区分保持不变。
                  </span>
                </div>
                <ChoiceGroup
                  label="提示音音色"
                  columns={3}
                  value={chimeStyle}
                  onChange={onChimeStyleChange}
                  options={chimeStyleOptions.map((option) => ({
                    id: option.id,
                    label: option.label,
                  }))}
                />
              </div>
              <div className="settings-field">
                <div className="settings-field__copy">
                  <strong>试听</strong>
                  <span>
                    用当前音色播放一次对应终态的声音，挑选时可以先听再选。
                  </span>
                </div>
                <div
                  aria-label="试听任务完成提示音"
                  className="settings-chime-preview"
                  role="group"
                >
                  {chimePreviewOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        className={`settings-option settings-chime-option settings-chime-option--${option.status}`}
                        key={option.status}
                        onClick={() =>
                          playTaskCompletionChime(option.status, chimeStyle)
                        }
                        type="button"
                      >
                        <Icon aria-hidden="true" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
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
