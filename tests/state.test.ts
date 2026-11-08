import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCommand,
  initialState,
  MAX_SUMMARY_LENGTH,
  normalizeSummary,
  parseCommand,
  parseState,
  TaskActivity,
} from "../extensions/current-task/state.ts";

test("summaries normalize whitespace and strip terminal control sequences", () => {
  assert.equal(
    normalizeSummary("  修复\n登录\t问题 \x1b[31m红色\x1b[0m\x07 "),
    "修复 登录 问题 红色",
  );
  assert.equal(normalizeSummary("build 👩‍💻 tooling"), "build 👩‍💻 tooling");
  assert.equal(normalizeSummary("\x1b]0;injected title\x07safe"), "safe");
});

test("empty and overlong input fail at the boundary", () => {
  for (const value of ["", " \n\t", "a".repeat(MAX_SUMMARY_LENGTH + 1)]) {
    assert.throws(() => normalizeSummary(value));
  }
  assert.equal(
    Array.from(normalizeSummary("😀".repeat(MAX_SUMMARY_LENGTH))).length,
    MAX_SUMMARY_LENGTH,
  );
});

test("manual task is pinned; auto and visibility changes preserve the summary", () => {
  const pinned = applyCommand(initialState(), parseCommand("修复登录"));
  assert.equal(pinned.mode, "manual");
  const hidden = applyCommand(pinned, parseCommand("hide"));
  assert.equal(hidden.visible, false);
  const auto = applyCommand(hidden, parseCommand("auto"));
  assert.deepEqual(auto, { ...hidden, mode: "auto" });
  const cleared = applyCommand(auto, parseCommand("clear"));
  assert.deepEqual(cleared, { ...initialState(), visible: false });
  assert.equal(applyCommand(cleared, parseCommand("show")).visible, true);
});

test("reserved words can be pinned explicitly, inspect/help do not mutate", () => {
  const state = applyCommand(initialState(), parseCommand("set auto"));
  assert.equal(state.summary, "auto");
  assert.equal(applyCommand(state, parseCommand("")), state);
  assert.equal(applyCommand(state, parseCommand("help")), state);
});

test("persisted data is validated, including version and pinned invariant", () => {
  assert.deepEqual(parseState(initialState()), initialState());
  for (const value of [
    null,
    [],
    {},
    { ...initialState(), version: 2 },
    { ...initialState(), visible: "true" },
    { ...initialState(), summary: 10 },
    { ...initialState(), mode: "manual" },
    { ...initialState(), summary: "" },
  ]) {
    assert.throws(() => parseState(value));
  }
});

test("activity stays running until settled and never equates idle with complete", () => {
  const activity = new TaskActivity();
  assert.equal(activity.value, "idle");
  activity.start();
  assert.equal(activity.value, "running");
  activity.prompt(true);
  assert.equal(activity.value, "waiting");
  activity.prompt(false);
  assert.equal(activity.value, "running");
  activity.settle(false);
  assert.equal(activity.value, "idle");
  activity.start();
  activity.settle(true);
  assert.equal(activity.value, "aborted");
});

test("a successful retry clears earlier errors; idle prompts restore prior status", () => {
  const activity = new TaskActivity();
  activity.start();
  activity.response(true);
  activity.settle(false);
  assert.equal(activity.value, "error");
  activity.prompt(true);
  activity.prompt(false);
  assert.equal(activity.value, "error");
  activity.start();
  activity.response(false);
  activity.settle(false);
  assert.equal(activity.value, "idle");
});
