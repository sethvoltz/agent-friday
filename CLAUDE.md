# Agent Friday

## Project

A local-first Slack-to-Claude-Code bridge with a multi-agent orchestration system. See `docs/` for full documentation.

## Documentation

This project has living documentation that must stay current with the code:

- `docs/architecture.md` — System overview, components, message flow, state layout, agent hierarchy, testing
- `docs/decisions.md` — Architecture Decision Records (ADRs)
- `docs/configure-friday.md` — Config file reference
- `docs/setup-friday.md` — Setup guide
- `docs/running.md` — How to run the daemon and services

**When you make changes**, update the relevant docs. If you add a module, update the architecture table. If you change message flow, update the flow diagrams. If you make an architectural decision, add an ADR. If you add a test file, update the testing coverage table. Documentation that drifts from the code is worse than no documentation.

## Design Principles

- **Preserve over delete.** Default to keeping data (logs, state, chat messages) rather than removing it. Patch and update rather than delete. Exceptions are fine case-by-case, but the default is always preserve.
- **Workspace containment.** Builders work exclusively in their assigned worktrees. The orchestrator never touches a Builder's workspace. Agents stay in their assigned directory.
- **User approval gates.** The orchestrator confirms plans with the user before creating Builders. Builders do not push or open PRs without explicit user approval relayed through the orchestrator.

## Structure

```
packages/shared    — Shared types and config
packages/cli       — CLI (@friday/cli)
services/friday    — Bridge daemon
services/dashboard — Management GUI (SvelteKit)
docs/              — Documentation
```

## Development

```bash
pnpm install                    # Install deps
pnpm test                       # Full test suite (via Turborepo)
pnpm --filter @friday/daemon exec vitest run src/path/to/file.test.ts  # Single test
```

- TypeScript throughout, Vitest for tests, pnpm workspaces + Turborepo
- Tests are co-located with source as `*.test.ts`
- All state lives in `~/.friday/` — never hardcode paths, use constants from `@friday/shared`
