/**
 * Types for the interaction contract. The implementation is the adjacent
 * `interaction-contract.mjs`, shared by the hook, the service and the console.
 */

export type InteractionHookEventName = "PreToolUse" | "PermissionRequest";
export type InteractionToolName = "AskUserQuestion" | "ExitPlanMode";
export type InteractionAction =
  | "select"
  | "deselect"
  | "text"
  | "edit"
  | "submit"
  | "cancel"
  | "skip"
  | "timeout"
  | "takeover"
  | "expire"
  | "replace";
export type InteractionResultStatus =
  | "answered"
  | "cancelled"
  | "timeout"
  | "expired";
export type AgentNotificationKind =
  | "answer_applied"
  | "answer_cancelled"
  | "interaction_timeout"
  | "fallback_prompt"
  | "question_replaced"
  | "device_takeover";
export type AgentNotificationTarget = "agent" | "user" | "both";
export type AgentNotificationChannel =
  | "additionalContext"
  | "systemMessage"
  | "permissionDecisionReason"
  | "terminalSequence"
  | "sse"
  | "trace";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionDescriptor {
  question: string;
  header?: string;
  options: Array<QuestionOption | string>;
  multiSelect?: boolean;
  required?: boolean;
}

export interface InteractionRequest {
  requestId: string;
  schemaVersion: 1;
  hookEventName: InteractionHookEventName;
  toolName: InteractionToolName;
  toolUseId: string | null;
  sessionId: string;
  source: string;
  cwd: string;
  createdAt: string;
  expiresAt: string;
  ttlMs: number;
  revision: number;
  questions: QuestionDescriptor[];
}

export interface InteractionEvent {
  requestId: string;
  eventId: string;
  seq: number;
  action: InteractionAction;
  deviceId: string;
  at: string;
  question?: string;
  optionLabel?: string;
  text?: string;
  previous?: string;
  next?: string;
  reason?: string;
  questions?: QuestionDescriptor[];
  revision?: number;
  final?: boolean;
  answers?: Record<string, string>;
}

export interface InteractionResult {
  requestId: string;
  status: InteractionResultStatus;
  answers: Record<string, string>;
  answeredBy: string;
  answeredAt: string;
  elapsedMs: number;
}

export interface AgentNotification {
  schemaVersion: 1;
  notificationId: string;
  requestId: string;
  kind: AgentNotificationKind;
  target: AgentNotificationTarget;
  channel: AgentNotificationChannel;
  sessionId: string;
  toolUseId: string | null;
  at: string;
  summary: string;
  detail: Record<string, unknown>;
  ttlMs: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AnswerValidation extends ValidationResult {
  answers: Record<string, string>;
}

export declare const INTERACTION_SCHEMA_VERSION: 1;
export declare const INTERACTION_HOOK_EVENTS: readonly InteractionHookEventName[];
export declare const INTERACTION_TOOLS: readonly InteractionToolName[];
export declare const INTERACTION_ACTIONS: readonly InteractionAction[];
export declare const INTERACTION_FINAL_ACTIONS: readonly InteractionAction[];
export declare const INTERACTION_RESULT_STATUSES: readonly InteractionResultStatus[];
export declare const INTERACTION_NOTIFICATION_KINDS: readonly AgentNotificationKind[];
export declare const INTERACTION_NOTIFICATION_TARGETS: readonly AgentNotificationTarget[];
export declare const INTERACTION_NOTIFICATION_CHANNELS: readonly AgentNotificationChannel[];
export declare const INTERACTION_LIMITS: Readonly<{
  minQuestions: number;
  maxQuestions: number;
  minOptions: number;
  maxOptions: number;
  questionLength: number;
  headerLength: number;
  labelLength: number;
  textLength: number;
  eventBytes: number;
  answersChars: number;
  summaryLength: number;
  notificationString: number;
  hookTimeoutMs: number;
  ttlMarginMs: number;
}>;

export declare function normalizeQuestionOptions(
  options: unknown,
): QuestionOption[];
export declare function resolveInteractionTtl(timeoutMs?: number): number;
export declare function isFinalInteractionAction(
  action: string,
): boolean;
export declare function validateQuestionDescriptor(value: unknown): ValidationResult;
export declare function validateInteractionRequest(value: unknown): ValidationResult;
export declare function validateInteractionEvent(
  value: unknown,
  context?: { previousSeq?: number; revision?: number },
): ValidationResult;
export declare function validateAnswers(
  value: unknown,
  questions: readonly QuestionDescriptor[],
  options?: { allowText?: boolean },
): AnswerValidation;
export declare function buildInteractionRequest(
  input: {
    hookEventName: InteractionHookEventName;
    toolName: InteractionToolName;
    toolUseId?: string;
    sessionId: string;
    source?: string;
    cwd?: string;
    revision?: number;
    questions: QuestionDescriptor[];
  },
  options?: { now?: number; timeoutMs?: number },
): InteractionRequest;
export declare function buildInteractionResult(
  request: Pick<InteractionRequest, "requestId" | "createdAt">,
  status: InteractionResultStatus,
  answers: Record<string, string>,
  options?: { now?: number; answeredBy?: string },
): InteractionResult;
export declare function validateAgentNotification(value: unknown): ValidationResult;
export declare function buildAgentNotification(
  input: {
    notificationId?: string;
    requestId: string;
    kind: AgentNotificationKind;
    target?: AgentNotificationTarget;
    channel: AgentNotificationChannel;
    sessionId?: string;
    toolUseId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
    ttlMs?: number;
  },
  options?: { now?: number },
): AgentNotification;
export declare function aggregateDecisionOutputs(
  outputs: readonly unknown[],
): "deny" | "ask" | "allow" | "none";
