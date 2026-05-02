# Linear protocol (Builder / Helper)

Your epic in Beads may be a **lightweight shim** for a Linear ticket — the bead description is intentionally a 1–2 line summary because the full ticket lives in Linear.

## When you start

After running `bd show <epicId> --json`, check the metadata for `linear_ticket`:

```json
{
  "id": "friday-42",
  "metadata": { "linear_ticket": "FRI-17" },
  ...
}
```

If `linear_ticket` is present, fetch the full Linear ticket *immediately*:

```
linear_getIssueById(id="FRI-17")
```

That gives you the real description, comments, blockers, and the canonical git branch name. Treat the Linear ticket as the source of truth for *what* to build; the bead is your local space to track *how*.

## Branch naming

When you create a git branch for the work, use the Linear ticket's `gitBranchName` field exactly. Linear's GitHub integration auto-links PRs created against this branch and will auto-flip the ticket Ready for Review → Done when the PR merges.

```
# Example value from linear_getIssueById:
# gitBranchName: "seth/fri-17-cli-architecture-refactor-into-proper-command-hierarchy"
git checkout -b seth/fri-17-cli-architecture-refactor-into-proper-command-hierarchy
```

If you skip this convention, the orchestrator will have to flip the Linear status manually — annoying and error-prone. **Use the canonical branch name.**

## What you can and cannot do in Linear

**You can:**
- Read tickets (`linear_getIssueById`, `linear_searchIssues`, `linear_getIssues`).
- Read comments (`linear_getComments`).
- Post a comment to record discoveries (duplicate detection, related tickets, surfaced findings):
  ```
  linear_createComment(issueId="FRI-17", body="Looks like FRI-22 is closely related — same hook system question.")
  ```

**You must not:**
- Flip Linear status (Backlog/Todo/In Progress/Ready for Review/Done/Cancelled). The Orchestrator owns lifecycle transitions.
- Claim other Linear tickets. If you find work that needs a separate ticket, mail the Orchestrator and let it triage.
- Add or remove `blockedBy` relations. Mail the Orchestrator with what's blocking; it will create the relation.

## Reporting completion

When work is done, mail the Orchestrator (don't touch Linear). Include:
- The PR URL (if you opened one).
- A 1–2 sentence summary of what you did.
- Any follow-ups worth filing as separate Linear tickets.

The Orchestrator will flip Linear → Ready for Review and post the summary as a Linear comment. PR merge will auto-close.

## Soft-degrade

If `linear_*` tools aren't available (no `LINEAR_API_KEY` configured) but your bead has a `linear_ticket` metadata field, you're seeing a misconfigured install. Mail the Orchestrator with the issue and proceed using only the bead description for context — flag the gap so the user can run `friday setup linear`.
