import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Activity, TaskState } from "./state.ts";

const LABELS: Record<Activity, string> = {
  idle: "等待输入",
  running: "进行中",
  waiting: "等待确认",
  aborted: "已中断",
  error: "运行出错",
};

export function renderTask(
  state: TaskState,
  activity: Activity,
  width: number,
  theme: Pick<Theme, "fg" | "bold">,
): string[] {
  if (!state.visible || width <= 0) return [];
  const color =
    activity === "error"
      ? "error"
      : activity === "waiting" || activity === "aborted"
        ? "warning"
        : activity === "running"
          ? "accent"
          : "muted";
  const pinned = state.mode === "manual" ? " · 固定" : "";
  return [
    theme.fg(color, `─ 当前任务 · ${LABELS[activity]}${pinned}`),
    theme.fg("accent", "  ") +
      theme.bold(state.summary ?? "等待任务概括 · /task 设置一句话"),
  ].map((line) => truncateToWidth(line, width, "…"));
}
