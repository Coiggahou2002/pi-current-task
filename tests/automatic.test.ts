import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  defaultSummary,
  SummaryJob,
  type GeneratedSummary,
} from "../extensions/current-task/automatic.ts";
import { MAX_SUMMARY_LENGTH } from "../extensions/current-task/state.ts";

const input = { previous: null, requests: ["请修复登录，并补齐测试"] };

test("model-independent default is nonempty, terminal-safe, and bounded", () => {
  assert.equal(
    defaultSummary("  修复\n登录\x1b[31m问题\x1b[0m  "),
    "修复 登录问题",
  );
  assert.equal(defaultSummary("\t\n"), "处理用户请求");
  const long = defaultSummary("😀".repeat(200));
  assert.equal(Array.from(long).length, MAX_SUMMARY_LENGTH);
  assert.ok(long.endsWith("…"));
});

test("automatic summary commits without any main-agent tool call", async () => {
  const job = new SummaryJob();
  const summaries: string[] = [];
  const errors: unknown[] = [];
  await job.run(
    async (received) => {
      assert.deepEqual(received, input);
      return { text: "修复登录并补齐测试" };
    },
    input,
    (result) => summaries.push(result.text),
    (error) => errors.push(error),
  );
  assert.deepEqual(summaries, ["修复登录并补齐测试"]);
  assert.deepEqual(errors, []);
});

test("latest request wins even if the old provider ignores cancellation", async () => {
  const job = new SummaryJob();
  const summaries: string[] = [];
  let finishOld: (value: GeneratedSummary) => void = () => {
    throw new Error("not started");
  };
  const oldResponse = new Promise<GeneratedSummary>((resolve) => {
    finishOld = resolve;
  });
  const old = job.run(
    async () => oldResponse,
    input,
    (result) => summaries.push(result.text),
    (error) => assert.fail(String(error)),
  );
  await job.run(
    async () => ({ text: "新的任务" }),
    input,
    (result) => summaries.push(result.text),
    (error) => assert.fail(String(error)),
  );
  finishOld({ text: "过期任务" });
  await old;
  assert.deepEqual(summaries, ["新的任务"]);
});

test("pinning, clearing, shutdown or branch change can cancel pending writes", async () => {
  for (const reason of ["pin", "clear", "shutdown", "branch"]) {
    const job = new SummaryJob();
    let finish: (value: GeneratedSummary) => void = () => {
      throw new Error("not started");
    };
    const response = new Promise<GeneratedSummary>((resolve) => {
      finish = resolve;
    });
    const results: string[] = [];
    const pending = job.run(
      async () => response,
      input,
      (result) => results.push(result.text),
      (error) => assert.fail(String(error)),
    );
    job.cancel();
    finish({ text: reason });
    await pending;
    assert.deepEqual(results, []);
  }
});

test("provider failures are reported while the already-visible default is retained", async () => {
  const job = new SummaryJob();
  const summaries = [defaultSummary(input.requests[0] ?? "")];
  const errors: unknown[] = [];
  await job.run(
    async () => {
      throw new Error("provider unavailable");
    },
    input,
    (result) => summaries.push(result.text),
    (error) => errors.push(error),
  );
  assert.equal(summaries.length, 1);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /provider unavailable/);
});

test("timeout finishes and reports even if provider never settles", async () => {
  const job = new SummaryJob();
  const errors: unknown[] = [];
  const pending = job.run(
    async () => new Promise<GeneratedSummary>(() => {}),
    input,
    () => assert.fail("timed out result must not commit"),
    (error) => errors.push(error),
    5,
  );
  await Promise.all([pending, delay(20)]);
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]), /timed out/);
});
