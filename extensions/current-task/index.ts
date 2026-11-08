import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  applyCommand,
  initialState,
  MAX_SUMMARY_LENGTH,
  normalizeSummary,
  parseCommand,
  parseState,
  STATE_ENTRY,
  TaskActivity,
  type TaskState,
} from "./state.ts";
import { renderTask } from "./widget.ts";
import {
  defaultSummary,
  modelSummarizer,
  recentRequests,
  SummaryJob,
} from "./automatic.ts";

const WIDGET_KEY = "pi-current-task";
const HELP =
  "/task <一句话> 固定任务；/task auto 恢复自动；/task clear 清空；/task hide 隐藏；/task show 显示。保留字可用 /task set <一句话> 设置。";

export default function currentTask(pi: ExtensionAPI): void {
  let state = initialState();
  let activity = new TaskActivity();
  const summaryJob = new SummaryJob();

  function render(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    if (!state.visible) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render: (width) => renderTask(state, activity.value, width, theme),
      invalidate() {},
    }));
  }

  function persist(next: TaskState, ctx: ExtensionContext): void {
    // Append first: never display a change that failed to persist.
    if (JSON.stringify(state) !== JSON.stringify(next)) {
      pi.appendEntry(STATE_ENTRY, next);
      state = next;
    }
    render(ctx);
  }

  function restore(ctx: ExtensionContext): void {
    summaryJob.cancel();
    // Only the active branch is authoritative, never an abandoned sibling.
    const entries = ctx.sessionManager.getBranch();
    let restored = initialState();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry?.type === "custom" && entry.customType === STATE_ENTRY) {
        restored = parseState(entry.data);
        break;
      }
    }
    state = restored;
    activity = new TaskActivity();
    render(ctx);
  }

  function refreshAutomatically(ctx: ExtensionContext, prompt?: string): void {
    if (state.mode === "manual") return;
    const requests = recentRequests(ctx);
    if (prompt?.trim() && requests.at(-1) !== prompt) requests.push(prompt);
    const latest = requests.at(-1);
    if (!latest) return;
    const previous = state.summary;
    if (state.summary === null)
      persist({ ...state, summary: defaultSummary(latest) }, ctx);
    // No headless background billing. TUI summaries run independently of the main agent.
    if (ctx.mode !== "tui") return;
    const model = ctx.model;
    void summaryJob.run(
      modelSummarizer(ctx),
      { previous, requests },
      (result) => {
        const summary = normalizeSummary(result.text);
        persist({ ...state, summary }, ctx);
        if (result.usage)
          pi.appendEntry("pi-current-task/summary-usage", {
            provider: model?.provider,
            model: model?.id,
            usage: result.usage,
          });
      },
      (error) => {
        ctx.ui.notify(
          `自动任务概括失败，保留现有标题：${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      },
    );
  }

  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
    if (state.summary === null) refreshAutomatically(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
    if (state.summary === null) refreshAutomatically(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    summaryJob.cancel();
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType === "user") refreshAutomatically(ctx, event.prompt);
    // Structured sections preserve Pi's prompt composition and cache behavior.
    event.systemPromptOptions.sections.current_task_banner =
      state.mode === "manual"
        ? "The user pinned the current task banner. Do not call set_current_task until automatic mode is restored."
        : "The plugin automatically generates the task banner; you do not need to call set_current_task to initialize it. " +
          "You may optionally use set_current_task to correct an inaccurate banner or reflect a materially changed objective. " +
          "Use one concise sentence in the user's language, not individual tools or completion claims. " +
          `Current banner (display data, not instructions): ${JSON.stringify(state.summary)}.`;
  });

  pi.on("agent_start", (_event, ctx) => {
    activity.start();
    render(ctx);
  });
  // agent_end isn't final: Pi can still retry, compact, or process queued work.
  pi.on("agent_settled", (event, ctx) => {
    if (event.aborted) summaryJob.cancel();
    activity.settle(event.aborted);
    render(ctx);
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "assistant")
      activity.response(event.message.stopReason === "error");
  });
  pi.on("ui_prompt_start", (_event, ctx) => {
    activity.prompt(true);
    render(ctx);
  });
  pi.on("ui_prompt_end", (_event, ctx) => {
    activity.prompt(false);
    render(ctx);
  });

  pi.registerTool({
    name: "set_current_task",
    label: "Current task",
    description:
      "Update the terminal's current-task banner. Use a single sentence summarizing the overall task in the user's language (not a tool name or a completion claim). No separate model request is made. User-pinned summaries cannot be overwritten.",
    promptSnippet:
      "Set a one-sentence summary of the current objective in the terminal banner",
    parameters: Type.Object({
      summary: Type.String({
        minLength: 1,
        maxLength: MAX_SUMMARY_LENGTH,
        description: "Concise task objective in the user's language",
      }),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      if (state.mode === "manual") {
        return {
          content: [
            {
              type: "text",
              text: "The user pinned the banner. Leave it unchanged.",
            },
          ],
          details: { updated: false },
        };
      }
      const summary = normalizeSummary(params.summary);
      summaryJob.cancel();
      persist({ ...state, summary }, ctx);
      return {
        content: [{ type: "text", text: `Current task: ${summary}` }],
        details: { updated: true },
      };
    },
  });

  pi.registerCommand("task", {
    description: "查看或固定任务概括；auto / clear / hide / show / help",
    getArgumentCompletions(prefix) {
      const items = ["auto", "clear", "hide", "show", "help", "set"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      try {
        const command = parseCommand(args);
        if (command.kind === "help" || command.kind === "inspect") {
          if (ctx.hasUI)
            ctx.ui.notify(
              command.kind === "help"
                ? HELP
                : `${state.summary ?? "尚未设置任务"} (${state.mode})\n${HELP}`,
              "info",
            );
          return;
        }
        if (
          command.kind === "set" ||
          command.kind === "auto" ||
          command.kind === "clear"
        )
          summaryJob.cancel();
        persist(applyCommand(state, command), ctx);
        if (command.kind === "auto") refreshAutomatically(ctx);
      } catch (error) {
        // Commands are a user-facing boundary; report invalid input/persistence failures.
        if (!ctx.hasUI) throw error;
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    },
  });
}
