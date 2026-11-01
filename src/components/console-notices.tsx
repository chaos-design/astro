import { CheckCircle2, CircleX, Info, X } from "lucide-react";
import { useEffect } from "react";

export type NoticeTone = "info" | "success" | "error";

export type Notice = {
  id: number;
  message: string;
  /** Optional second line: the cause of a failure, never the whole stack. */
  detail?: string;
  tone: NoticeTone;
};

const noticeIcons = {
  error: CircleX,
  info: Info,
  success: CheckCircle2,
} as const;

/** How long a notice stays on screen; errors stay twice as long. */
const NOTICE_LIFETIME_MS = 4200;

/**
 * Transient feedback for actions that used to interrupt with `window.alert`
 * (import, clear, reload). Native alerts block the page, cannot be styled and
 * carry no detail, which is why an import failure inside a dark console looked
 * like a browser error rather than a console message.
 *
 * The stack is pointer-events-none except on the notices themselves, so it
 * never steals clicks from the panels underneath.
 */
export function ConsoleNotices({
  notices,
  onDismiss,
}: {
  notices: readonly Notice[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="console-notices" role="region" aria-label="操作提示">
      {notices.map((notice) => (
        <NoticeCard key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function NoticeCard({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: number) => void;
}) {
  const Icon = noticeIcons[notice.tone];
  useEffect(() => {
    const timer = window.setTimeout(
      () => onDismiss(notice.id),
      notice.tone === "error" ? NOTICE_LIFETIME_MS * 2 : NOTICE_LIFETIME_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.tone, onDismiss]);

  return (
    <div
      className={`console-notice console-notice--${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className="console-notice__icon" />
      <div className="console-notice__copy">
        <span>{notice.message}</span>
        {notice.detail ? <small>{notice.detail}</small> : null}
      </div>
      <button
        aria-label="关闭提示"
        className="console-notice__dismiss"
        onClick={() => onDismiss(notice.id)}
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
