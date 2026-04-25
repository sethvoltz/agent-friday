---
description: Before pushing to remote, run the full validation suite and confirm everything passes.
globs: *
---

Before running `git push`, you MUST:

1. Run `pnpm test` (full test suite via Turborepo) and confirm all tests pass
2. Run `pnpm --filter @friday/daemon exec tsc --noEmit` to verify type checking passes
3. Run `pnpm --filter @friday/cli exec tsc --noEmit` to verify CLI types
4. Run `pnpm --filter @friday/shared build` to verify shared package builds

Only push after all four steps are green. If any fail, fix the issue and re-run before pushing.
