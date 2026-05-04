---
description: Investigate a bug, failure, or unexpected behavior. Spawns a context-free sub-agent that gathers evidence, identifies root cause, and reports findings without bias from the current conversation.
when_to_use: When the user reports a bug, asks "why is X happening", wants to understand a failure, or needs root-cause analysis before deciding how to fix something.
disable-model-invocation: false
user-invocable: true
scope: [orchestrator, builder]
---

Investigate the reported issue by spawning a fresh, context-free reviewer. The goal is evidence-first, unbiased root-cause analysis.

## Steps

1. Gather the raw materials:
   - If a specific error message, log line, or stack trace was provided, capture it verbatim.
   - Run `git log --oneline -10` to see recent commits that may have introduced the issue.
   - Run `git diff main...HEAD` (or `git diff HEAD~1`) to see recent changes in scope.

2. Spawn a context-free sub-agent via the `Agent` tool. Pass it ONLY:
   - The issue description (what was observed, what was expected)
   - The relevant log/error output
   - The git diff or file contents you collected above
   - This investigation prompt (do NOT pass conversation history):

   ```
   You are a fresh investigator with no prior context. Your job is to identify the root cause of the reported issue.

   Issue: <paste issue description>

   Evidence collected:
   <paste logs, stack traces, git diff, file contents>

   Steps:
   1. Read through all evidence carefully.
   2. Identify the specific code path, condition, or interaction that causes the observed behavior.
   3. Distinguish symptoms from root cause — symptoms are what the user sees, root cause is what actually went wrong.
   4. Note any related issues or risks you spot along the way.
   5. Produce a findings report:
      - **Root cause** — one or two sentences, specific and actionable
      - **Evidence trail** — the specific lines/commits/conditions that led you to this conclusion
      - **Affected surface** — what else could be broken by the same root cause
      - **Suggested fix direction** — what change would address the root cause (not a full implementation)
   ```

3. Relay the sub-agent's findings back to the user or parent agent.

Keep the investigation tight. If you find the root cause early, stop gathering and report — don't keep digging for completeness.
