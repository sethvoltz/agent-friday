---
description: Review a pull request or branch. Produces a structured code review covering correctness, design, style, and test coverage.
when_to_use: When the user asks to review a PR, audit code changes, check a branch before merging, or wants a code review.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Review the pending changes on the current branch and produce a structured code review report.

## Steps

1. Run `git diff main...HEAD` (or `git diff origin/main...HEAD`) to see all changes since branching from main. If no args were provided, review everything on the current branch.
2. If a PR number was provided as an argument, use `gh pr view <number> --json title,body,files` to get the PR context and changed files.
3. Examine each changed file. For each:
   - Read the full file to understand context
   - Identify correctness issues (bugs, edge cases, off-by-one errors)
   - Note design concerns (coupling, abstractions, complexity)
   - Flag style inconsistencies relative to the surrounding code
   - Check for missing or weak test coverage
4. Produce a report with these sections:
   - **Summary** — one paragraph describing what the changes do
   - **Issues** — numbered list of problems (label each: `bug`, `design`, `style`, `test`)
   - **Suggestions** — improvements that aren't blocking but would improve quality
   - **Verdict** — Approve / Request Changes / Comment, with a one-sentence rationale

Focus on substance. Don't flag cosmetic nits unless they affect readability. Prioritize bugs and correctness first.
