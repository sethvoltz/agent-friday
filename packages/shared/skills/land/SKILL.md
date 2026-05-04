---
description: Land the current branch by pushing it and opening a pull request. Reports the PR URL when done. Does NOT merge — the merge decision belongs to the human or Orchestrator.
when_to_use: When the user says "land this", "open a PR", "push and create a PR", or "ship it". Also use at the end of a task when the work is complete and needs review.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Push the current branch and open a pull request. Stop at PR open — do not merge.

## Steps

1. **Verify the branch is ready:**
   - Run `git status` — confirm no uncommitted changes. If there are, ask the user whether to commit them or stash them first.
   - Run `git log main..HEAD --oneline` to see what commits will be in the PR.

2. **Run tests** (if a test command is configured in the project):
   - Check `package.json` for a `test` script, or look for `pnpm test` / `npm test` / `make test`.
   - Run it. If tests fail, report the failures and stop — do not push a broken branch.

3. **Push the branch:**
   ```
   git push -u origin HEAD
   ```
   If the push fails (e.g. branch already exists with diverged history), report the error and stop. Do not force-push without explicit user confirmation.

4. **Open a pull request** (if one doesn't already exist):
   - Check for an existing PR: `gh pr view --json url,state 2>/dev/null`
   - If no PR exists: `gh pr create --title "<title>" --body "<body>"`
     - Title: concise imperative summary of what the branch does (e.g. "add /land skill")
     - Body: bullet-point summary of what changed and why, plus a basic test plan

5. **Report back:**
   - State the PR URL
   - Note how many commits are in the PR
   - Call out anything the reviewer should pay particular attention to

The PR is now open for review. Merging is the human's decision.
