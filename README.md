```
                                                                   
     ▄▄                              ▄▄▄▄▄▄▄                       
   ▄█▀▀█▄                     █▄    █▀██▀▀▀          █▄            
   ██  ██      ▄▄       ▄    ▄██▄     ██  ▄    ▀▀    ██            
   ██▀▀██   ▄████ ▄█▀█▄ ████▄ ██      ███▀████▄██ ▄████ ▄▀▀█▄ ██ ██
 ▄ ██  ██   ██ ██ ██▄█▀ ██ ██ ██    ▄ ██  ██   ██ ██ ██ ▄█▀██ ██▄██
 ▀██▀  ▀█▄█▄▀████▄▀█▄▄▄▄██ ▀█▄██    ▀██▀ ▄█▀  ▄██▄█▀███▄▀█▄██▄▄▀██▀
               ██                                               ██ 
             ▀▀▀                                              ▀▀▀  

```

Your local Slack-to-Claude-Code bridge. Command an AI agent from anywhere -- just send a Slack message.

---

## What is Friday?

Friday is a local-first daemon that connects Slack to [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions running on your machine. You message a Slack channel, Friday routes it to Claude's Agent SDK, and the response streams back -- with full access to your local filesystem, tools, and dev environment.

No servers to deploy. No API keys to manage. Runs on your existing Claude Pro/Max subscription.

**How it works:**

```
Slack (Socket Mode) --> Friday Daemon --> Claude Agent SDK --> Claude Code --> Your Machine
```

**Key features:**

- **Persistent sessions** -- each Slack channel maps to a Claude Code session with full conversation history
- **Message queuing** -- send messages while the agent is busy; they queue up and batch automatically
- **Streaming responses** -- see the agent's output as it types, not after it finishes
- **Slash commands** -- `/friday reset`, `/friday session`, `/friday help`
- **Usage tracking** -- per-turn cost, token, and cache hit rate logging
- **Management CLI** -- `friday start`, `friday stop`, `friday status`, `friday usage`
- **Dashboard** -- optional SvelteKit web UI for monitoring

## Quick Start

### Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Claude Code** installed and authenticated (`claude` CLI on PATH)
- A **Slack workspace** you can create apps in

### 1. Clone and install

```bash
git clone <repo-url> agent-friday
cd agent-friday
pnpm install
```

### 2. Create a Slack app

See [SETUP.md](SETUP.md) for the full Slack app manifest and token setup.

The short version: create a Socket Mode app with bot scopes for `chat:write`, `channels:history`, `reactions:write`, and a `/friday` slash command. You'll get two tokens:

- **App Token** (`xapp-...`) -- for Socket Mode
- **Bot Token** (`xoxb-...`) -- for API calls

### 3. Configure Friday

```bash
mkdir -p ~/.friday/sessions
```

Add your tokens to `~/.friday/.env`:

```bash
SLACK_APP_TOKEN=xapp-your-token
SLACK_BOT_TOKEN=xoxb-your-token
```

Set your orchestrator channel in `~/.friday/config.json`:

```json
{
  "slack": {
    "orchestratorChannelId": "C0123ABCDEF"
  },
  "agent": {
    "workingDirectory": "/path/to/your/project"
  }
}
```

Don't forget to `/invite @Friday` in the channel.

### 4. Run

```bash
# Daemon only
pnpm --filter @friday/daemon dev

# Daemon + dashboard
pnpm dev
```

Send a message in your orchestrator channel. Friday will pick it up.

## CLI

The `friday` CLI manages services and reports usage without needing the daemon running.

```bash
# During development, use the shim:
./bin/friday <command>

# Commands:
friday status                  # Check what's running
friday start [daemon|dashboard] # Start services (detached)
friday stop [daemon|dashboard]  # Stop services
friday restart <service>        # Restart a service
friday usage                   # Cost/token report
friday usage -v                # Verbose token breakdown
friday config                  # Print resolved config
friday config --validate       # Validate config
```

## Project Structure

```
agent-friday/
├── packages/
│   ├── shared/          # Shared types and config (FridayConfig, UsageEntry)
│   └── cli/             # CLI entrypoint (@friday/cli)
├── services/
│   ├── friday/          # Bridge daemon (@friday/daemon)
│   └── dashboard/       # SvelteKit management UI
├── tools/
│   └── usage-report/    # Standalone usage CLI (absorbed into CLI)
├── bin/friday            # Dev shim
└── docs/
    └── architecture.md  # Detailed system design
```

**Stack:** TypeScript, pnpm workspaces, Turborepo, Vitest, SvelteKit

## Developing

### Setup

```bash
pnpm install
pnpm build        # Build all packages
```

### Dev mode

```bash
# Start everything with hot reload
pnpm dev

# Or start a specific service
./bin/friday dev start daemon
./bin/friday dev start dashboard
```

### Testing

```bash
# Full suite (110 tests across 3 packages)
pnpm test

# Single package
pnpm --filter @friday/cli run test
pnpm --filter @friday/daemon run test
pnpm --filter @friday/shared run test
```

Tests are co-located with source as `*.test.ts` and run via Vitest. All tests are deterministic -- no network calls, no real Slack or Claude connections. See [docs/architecture.md](docs/architecture.md#testing) for conventions.

### Build

```bash
pnpm build        # Turborepo builds shared first, then services in parallel
```

### Validate config

```bash
./bin/friday config --validate
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design, including message flow, queue behavior, session management, and slash command handling.

## License

Private.
