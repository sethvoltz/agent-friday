---
description: Review a pull request or branch. Produces a structured code review covering correctness, design, style, and test coverage.
when_to_use: When the user asks to review a PR, audit code changes, check a branch before merging, or wants a code review.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Review the pending changes on the current branch using a context-free sub-agent. Spawning a fresh reviewer eliminates bias from the conversation that produced the code.

## Steps

1. **Gather the raw materials** (do this yourself, before spawning the sub-agent):
   - Run `git diff main...HEAD` (or `git diff origin/main...HEAD`) to get all changes since branching from main.
   - If a PR number was provided as an argument, also run `gh pr view <number> --json title,body,files` to capture the PR title, description, and file list.
   - Note the names of all changed files.

2. **Spawn a context-free sub-agent** via the `Agent` tool. Pass it ONLY the materials you gathered — not the conversation history, not the task brief, not any prior context. The reviewer must evaluate the diff on its own merits.

   Prompt the sub-agent with exactly this structure:

   ```
   You are a code reviewer with no prior context about this change. Review the following diff and produce a structured report.

   PR title: <title or "N/A">
   PR description: <body or "N/A">

   Diff:
   <paste full git diff output>

   For each changed file, examine:
   - Correctness: bugs, off-by-one errors, unhandled edge cases, incorrect logic
   - Design: coupling, unnecessary abstractions, missing abstractions, complexity
   - Style: inconsistencies relative to the surrounding code visible in the diff
   - Test coverage: missing tests for new behavior, tests that don't actually verify anything

   Produce a report with these sections:
   - **Summary** — one paragraph describing what the changes do
   - **Issues** — numbered list of problems (label each: `bug`, `design`, `style`, `test`). Be specific: quote the file path and the relevant line or pattern.
   - **Suggestions** — non-blocking improvements that would raise quality
   - **Verdict** — one of: Approve / Request Changes / Comment, with a one-sentence rationale

   Focus on substance. Skip cosmetic nits unless they harm readability. Prioritize bugs and correctness first. If you find nothing wrong, say so explicitly.
   ```

3. **Relay the sub-agent's report** verbatim back to the user (or to the Orchestrator via mail if you're a Builder).

The sub-agent does all the reading and analysis. Your job is to collect the materials and route the result.
