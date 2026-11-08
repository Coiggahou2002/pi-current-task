# Changelog

## 0.2.0

- Generate task summaries inside the plugin by default, independently of main-agent tool calls.
- Show an immediate request-derived title; initialize missing banners when loading existing conversations.
- Refresh summaries asynchronously with the active model and recent user requests; retain existing titles on failure or timeout.
- Cancel stale work on newer requests, pinning, clearing, aborts, and session/branch changes.
- Record auxiliary model usage in session entries and document the additional provider cost.

## 0.1.0

- Add a persistent two-row current-task banner above the Pi editor.
- Let the active agent maintain a one-sentence objective with `set_current_task`.
- Add `/task` commands for pinning, automatic mode, visibility, and clearing.
- Restore state from the active session branch, including reload and tree navigation.
- Show runtime activity without equating idle with completion.
