---
description: Rebase the current branch on the latest main, resolving conflicts clearly and force-pushing the result.
when_to_use: When the user asks to rebase, when a PR has merge conflicts with main, or when the branch has fallen behind main and needs to be brought current.
disable-model-invocation: false
user-invocable: true
scope: [builder]
---

Rebase the current branch on `origin/main` and force-push the result.

## Steps

1. **Confirm starting state:**
   - Run `git status` — there must be no uncommitted changes. If there are, stash them first (`git stash`) and note this so you can pop after.
   - Run `git log --oneline main..HEAD` to see the commits being rebased.

2. **Fetch and rebase:**
   ```
   git fetch origin
   git rebase origin/main
   ```

3. **Handle conflicts** (if any arise):
   - For each conflicting file, show the user:
     - Which file has the conflict
     - What the incoming change (from main) is doing
     - What the current branch change is doing
     - Your recommendation for resolution (prefer whichever change aligns with the task at hand)
   - Resolve each conflict, then `git add <file>` and `git rebase --continue`.
   - If a conflict is ambiguous or the resolution would require understanding the user's intent, pause and ask before continuing.

4. **Verify after rebase:**
   - Run the project test suite to confirm nothing broke during the rebase.
   - If tests fail, investigate whether the failure was pre-existing (existed on main) or introduced by a conflict resolution.

5. **Force-push:**
   ```
   git push --force-with-lease origin HEAD
   ```
   Use `--force-with-lease` (not `--force`) — it refuses to push if the remote has changed since your last fetch, protecting against accidental overwrites.

6. **Pop the stash** if you stashed changes in step 1:
   ```
   git stash pop
   ```

7. **Report back:** State the new HEAD commit, how many commits were rebased, and whether any conflicts were resolved and how.
