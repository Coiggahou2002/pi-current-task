# pi-current-task

**Know what this Pi terminal is working on, at a glance.**

A small [Pi](https://github.com/earendil-works/pi) extension that keeps a one-sentence task banner above the input editor. Built for switching between several terminal sessions without losing track of their purpose.

```text
─ 当前任务 · 进行中
  为 Cradle 实现登录鉴权，并验证端到端流程
────────────────────────────────────────────────────
> …
```

## Install

Requires the Earendil distribution of Pi. Tested with **1.5.0** and Node.js 22. The UI labels are currently Chinese; automatically generated summaries follow the user's language. Compatibility with other Pi distributions has not been verified.

```sh
pi install git:github.com/Coiggahou2002/pi-current-task
```

Then run `/reload` in an existing Pi session, or start a new one.

Try without installing:

```sh
pi -e git:github.com/Coiggahou2002/pi-current-task
```

Local development:

```sh
git clone https://github.com/Coiggahou2002/pi-current-task.git
cd pi-current-task
npm ci
pi -e ./extensions/current-task/index.ts
```

## Usage

Automatic mode is enabled by default. The active agent is instructed to call `set_current_task` when a new task starts or the objective changes materially—not after every read, edit, or shell command. This is model-driven, not a guarantee: if the agent does not update the banner, the previous summary stays visible. Set it manually when precision matters.

| Command                        | Action                                                          |
| ------------------------------ | --------------------------------------------------------------- |
| `/task`                        | Inspect the full summary and show help                          |
| `/task 修复登录鉴权并补齐测试` | Set and **pin** a summary; the agent cannot overwrite it        |
| `/task auto`                   | Allow the agent to update again, retaining the existing summary |
| `/task clear`                  | Clear the summary and return to automatic mode                  |
| `/task hide`                   | Hide the widget; automatic updates still work                   |
| `/task show`                   | Show the widget                                                 |
| `/task help`                   | Show command help                                               |
| `/task set auto`               | Pin the literal word `auto` (likewise for other reserved words) |

Summaries allow 1–160 Unicode code points. Whitespace is collapsed and terminal control sequences are stripped. Long summaries are truncated to the available terminal columns; `/task` shows the full text. The banner takes two rows and preserves Pi's existing header, footer, editor, and keybindings.

### Status is not completion

- **进行中** — the agent is running, including automatic continuations.
- **等待确认** — a Pi extension dialog is open; this does not detect arbitrary questions in assistant prose or external processes.
- **等待输入** — the agent has settled; this does **not** mean the task succeeded.
- **已中断** — the run was aborted.
- **运行出错** — the last assistant response failed.

An idle or resumed session never claims the task is complete. Tool-level errors may be recovered by the agent and do not independently mark the whole run failed.

## Persistence and privacy

Task summary, manual/automatic mode, and visibility are stored as versioned custom entries **inside the Pi session**, not in a separate global file. Reloading, resuming, forking, and `/tree` navigation reconstruct state from the active branch. Runtime activity is not persisted. Like other Pi session data, a banner in a brand-new empty session is only written to disk after the first conversation message; `--no-session` is never durable. Invalid saved state is reported as an extension error rather than silently ignored.

No telemetry, background processes, additional model requests, or external services. Automatic updates use the model already running your session and add a small tool-call/token overhead. The current banner and update instructions are included in model context; task data and tool calls are stored by Pi according to its normal session behavior. Do not put secrets in summaries. This extension does not inspect other terminals, change session names, or take over terminal titles.

The widget renders only in TUI mode. The command and tool can maintain state in other modes, but no custom TUI is rendered there.

## Development

```sh
npm ci
npm run check
npm test
```

- Strict TypeScript, without type assertions or `any` in project code.
- Unit tests cover input validation, pinning, visibility, runtime lifecycle, and mixed-width terminal layout.
- Integration tests use Pi's actual TypeScript extension loader, command/tool registry, and append-only session manager to verify disk restart and branch restoration without a model or network.
- Manually smoke-tested in real Pi TUI processes in fullscreen and regular modes at 40 and 100 columns: pin, hide, show, auto, and clear.
- CI runs on Node.js 22 and 24.

Source: [`extensions/current-task/`](extensions/current-task/). This repository contains one plugin; sibling plugins live in separate repositories.

## Uninstall

```sh
pi remove git:github.com/Coiggahou2002/pi-current-task
```

Run `/reload` or restart Pi. Historical custom entries remain in their original sessions but are no longer displayed or updated.

## License

MIT
