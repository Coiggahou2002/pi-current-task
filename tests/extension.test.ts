import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { parseState, STATE_ENTRY } from "../extensions/current-task/state.ts";

// Real Pi loader, command/tool registries and append-only session manager; no model/network.
test("Pi loads the extension; commands/tools persist and restore only the active branch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-current-task-test-"));
  try {
    const cwd = resolve(".");
    const loaded = await discoverAndLoadExtensions(
      [resolve("extensions/current-task/index.ts")],
      cwd,
      dir,
    );
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    const session = SessionManager.create(cwd, join(dir, "sessions"));
    session.appendMessage({
      role: "user",
      content: "Plugin acceptance test",
      timestamp: Date.now(),
    });
    loaded.runtime.appendEntry = (type, data) => {
      session.appendCustomEntry(type, data);
    };
    const models = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(dir, "models.json"),
      refreshOnCreate: false,
    });
    const runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      session,
      new ModelRegistry(models),
    );
    const errors: string[] = [];
    runner.onError((error) => errors.push(error.error));
    await runner.emit({ type: "session_start", reason: "startup" });
    // No /task command and no set_current_task call: old sessions get a default automatically.
    const automatic = session.getLeafEntry();
    assert.ok(automatic?.type === "custom");
    assert.equal(parseState(automatic.data).summary, "Plugin acceptance test");
    const command = runner.getCommand("task");
    const tool = runner.getToolDefinition("set_current_task");
    assert.ok(command);
    assert.ok(tool);
    const signal = new AbortController().signal;
    const runTool = (summary: string) =>
      tool.execute(
        "test",
        { summary },
        signal,
        undefined,
        runner.createToolContext("test", signal),
      );
    await command.handler("修复登录", runner.createCommandContext());
    const pinnedId = session.getLeafId();
    assert.ok(pinnedId);
    const count = session.getEntries().length;
    const pinnedResult = await runTool("不能覆盖固定任务");
    assert.match(JSON.stringify(pinnedResult.content), /pinned/);
    assert.equal(session.getEntries().length, count);
    await command.handler("auto", runner.createCommandContext());
    await runTool("自动任务");
    const latest = session.getLeafEntry();
    assert.equal(latest?.type, "custom");
    assert.ok(latest?.type === "custom");
    assert.equal(latest.customType, STATE_ENTRY);
    assert.equal(parseState(latest.data).summary, "自动任务");
    await runTool("自动任务");
    assert.equal(
      session.getLeafId(),
      latest.id,
      "unchanged summaries must not append entries",
    );

    session.branch(pinnedId);
    await runner.emit({
      type: "session_tree",
      newLeafId: pinnedId,
      oldLeafId: latest.id,
    });
    await runTool("不能从其他分支覆盖");
    assert.equal(session.getLeafId(), pinnedId);
    await command.handler("hide", runner.createCommandContext());
    const hidden = session.getLeafEntry();
    assert.ok(hidden?.type === "custom");
    assert.deepEqual(parseState(hidden.data), {
      version: 1,
      summary: "修复登录",
      mode: "manual",
      visible: false,
    });

    await runner.emit({ type: "session_start", reason: "reload" });
    await runTool("重载后依然固定");
    assert.equal(session.getLeafId(), hidden.id);
    const prompt = await runner.emitBeforeAgentStart(
      { messageType: "user", prompt: "测试" },
      { cwd },
    );
    assert.match(
      prompt.systemPromptOptions.sections.current_task_banner ?? "",
      /pinned/,
    );
    await command.handler("auto", runner.createCommandContext());
    const autoPrompt = await runner.emitBeforeAgentStart(
      { messageType: "user", prompt: "测试" },
      { cwd },
    );
    assert.match(
      autoPrompt.systemPromptOptions.sections.current_task_banner ?? "",
      /set_current_task/,
    );
    // A fresh runtime and SessionManager must reconstruct from disk, not closure state.
    await command.handler("hide", runner.createCommandContext());
    await command.handler(
      "修复登录重启后仍固定",
      runner.createCommandContext(),
    );
    const sessionFile = session.getSessionFile();
    assert.ok(sessionFile);
    const reopened = SessionManager.open(sessionFile);
    const reloaded = await discoverAndLoadExtensions(
      [resolve("extensions/current-task/index.ts")],
      cwd,
      dir,
    );
    assert.deepEqual(reloaded.errors, []);
    reloaded.runtime.appendEntry = (type, data) => {
      reopened.appendCustomEntry(type, data);
    };
    const resumed = new ExtensionRunner(
      reloaded.extensions,
      reloaded.runtime,
      cwd,
      reopened,
      new ModelRegistry(models),
    );
    resumed.onError((error) => errors.push(error.error));
    await resumed.emit({ type: "session_start", reason: "resume" });
    const resumedTool = resumed.getToolDefinition("set_current_task");
    assert.ok(resumedTool);
    const before = reopened.getLeafId();
    await resumedTool.execute(
      "test",
      { summary: "不应覆盖" },
      signal,
      undefined,
      resumed.createToolContext("test", signal),
    );
    assert.equal(reopened.getLeafId(), before);
    const resumedPrompt = await resumed.emitBeforeAgentStart(
      { messageType: "user", prompt: "测试" },
      { cwd },
    );
    assert.match(
      resumedPrompt.systemPromptOptions.sections.current_task_banner ?? "",
      /pinned/,
    );
    const freshLoaded = await discoverAndLoadExtensions(
      [resolve("extensions/current-task/index.ts")],
      cwd,
      dir,
    );
    assert.deepEqual(freshLoaded.errors, []);
    const freshSession = SessionManager.inMemory(cwd);
    freshLoaded.runtime.appendEntry = (type, data) => {
      freshSession.appendCustomEntry(type, data);
    };
    const freshRunner = new ExtensionRunner(
      freshLoaded.extensions,
      freshLoaded.runtime,
      cwd,
      freshSession,
      new ModelRegistry(models),
    );
    freshRunner.onError((error) => errors.push(error.error));
    await freshRunner.emit({ type: "session_start", reason: "new" });
    assert.equal(
      freshSession.getLeafEntry(),
      undefined,
      "empty sessions must not invent a task",
    );
    await freshRunner.emitBeforeAgentStart(
      { messageType: "user", prompt: "修复默认生成任务概括" },
      { cwd },
    );
    const firstRequest = freshSession.getLeafEntry();
    assert.ok(firstRequest?.type === "custom");
    assert.equal(parseState(firstRequest.data).summary, "修复默认生成任务概括");
    assert.deepEqual(errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
