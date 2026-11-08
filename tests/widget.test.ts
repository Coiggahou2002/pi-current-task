import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  initialState,
  type Activity,
} from "../extensions/current-task/state.ts";
import { renderTask } from "../extensions/current-task/widget.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("mixed scripts and emoji fit every terminal width, including zero", () => {
  const state = {
    ...initialState(),
    summary: "修复登录 👩‍💻 / café e\u0301 / 超长文件名",
  };
  for (const width of [0, 1, 2, 5, 10, 20, 40, 80, 120]) {
    const lines = renderTask(state, "running", width, theme);
    for (const line of lines)
      assert.ok(visibleWidth(line) <= width, `${width}: ${line}`);
  }
});

test("render reflects state and current theme, without implying completion", () => {
  for (const activity of [
    "idle",
    "running",
    "waiting",
    "aborted",
    "error",
  ] satisfies Activity[]) {
    const lines = renderTask(
      { ...initialState(), summary: "修复登录", mode: "manual" },
      activity,
      100,
      theme,
    );
    assert.match(lines.join("\n"), /修复登录/);
    assert.match(lines[0] ?? "", /固定/);
    assert.doesNotMatch(lines.join("\n"), /已完成/);
  }
  assert.match(
    renderTask(initialState(), "idle", 80, theme).join("\n"),
    /等待任务概括/,
  );
  assert.deepEqual(
    renderTask({ ...initialState(), visible: false }, "idle", 80, theme),
    [],
  );
  const colored = { ...theme, bold: (text: string) => `\x1b[1m${text}\x1b[0m` };
  assert.match(
    renderTask(initialState(), "idle", 80, colored)[1] ?? "",
    /\x1b\[1m/,
  );
});
