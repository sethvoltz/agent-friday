# Pre-push validation

Before running `git push`, verify the project is in a shippable state:

1. Run the project's test suite and confirm all tests pass.
2. Run any type checking or linting the project uses.
3. Confirm there are no uncommitted changes you intended to include.

Only push after these checks are green. If any fail, fix the issue first.

---

**Project-specific commands** — replace these placeholders with the actual commands for this repo:

```
# Run tests
<test command>

# Type check (if applicable)
<typecheck command>

# Lint (if applicable)
<lint command>
```
