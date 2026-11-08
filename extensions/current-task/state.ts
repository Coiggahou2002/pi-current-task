import { stripTerminalSequences } from "@earendil-works/pi-tui";

export const STATE_ENTRY = "pi-current-task/state";
export const MAX_SUMMARY_LENGTH = 160;

export interface TaskState {
  version: 1;
  summary: string | null;
  mode: "auto" | "manual";
  visible: boolean;
}

export type Activity = "idle" | "running" | "waiting" | "aborted" | "error";

export function initialState(): TaskState {
  return { version: 1, summary: null, mode: "auto", visible: true };
}

/** Keep untrusted model/user text inert in both a terminal and a prompt section. */
export function normalizeSummary(text: string): string {
  const summary = stripTerminalSequences(text)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const length = Array.from(summary).length;
  if (length === 0 || length > MAX_SUMMARY_LENGTH) {
    throw new Error(
      `Task summary must contain 1–${MAX_SUMMARY_LENGTH} characters.`,
    );
  }
  return summary;
}

export function parseState(value: unknown): TaskState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("summary" in value) ||
    !("mode" in value) ||
    (value.mode !== "auto" && value.mode !== "manual") ||
    !("visible" in value) ||
    typeof value.visible !== "boolean" ||
    (value.summary !== null && typeof value.summary !== "string")
  ) {
    throw new Error("Invalid current-task session state (expected version 1).");
  }
  const summary =
    value.summary === null ? null : normalizeSummary(value.summary);
  if (value.mode === "manual" && summary === null) {
    throw new Error("A pinned task must have a summary.");
  }
  return { version: 1, summary, mode: value.mode, visible: value.visible };
}

export type TaskCommand =
  | { kind: "show" | "hide" | "auto" | "clear" | "help" | "inspect" }
  | { kind: "set"; summary: string };

export function parseCommand(args: string): TaskCommand {
  const text = args.trim();
  switch (text) {
    case "":
      return { kind: "inspect" };
    case "show":
    case "hide":
    case "auto":
    case "clear":
    case "help":
      return { kind: text };
    default:
      return {
        kind: "set",
        summary: normalizeSummary(
          text.startsWith("set ") ? text.slice(4) : text,
        ),
      };
  }
}

export function applyCommand(
  state: TaskState,
  command: TaskCommand,
): TaskState {
  switch (command.kind) {
    case "set":
      return {
        ...state,
        summary: command.summary,
        mode: "manual",
        visible: true,
      };
    case "auto":
      return { ...state, mode: "auto" };
    case "clear":
      return { ...initialState(), visible: state.visible };
    case "show":
      return { ...state, visible: true };
    case "hide":
      return { ...state, visible: false };
    case "inspect":
    case "help":
      return state;
  }
}

/** Runtime activity is deliberately not persisted: a resumed session isn't still running. */
export class TaskActivity {
  private running = false;
  private waiting = false;
  private failed = false;
  private stopped: Activity = "idle";

  get value(): Activity {
    return this.waiting ? "waiting" : this.running ? "running" : this.stopped;
  }

  start(): void {
    this.running = true;
    this.failed = false;
  }

  prompt(open: boolean): void {
    this.waiting = open;
  }
  response(failed: boolean): void {
    this.failed = failed;
  }

  settle(aborted: boolean): void {
    this.running = false;
    this.waiting = false;
    this.stopped = aborted ? "aborted" : this.failed ? "error" : "idle";
  }
}
