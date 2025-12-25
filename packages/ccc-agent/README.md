# CCC Agent

Remote agent for Claude Code terminal gateway. Connects to the gateway and exposes tmux sessions for remote access.

## Installation

```bash
cd packages/ccc-agent
bun install
bun run build
```

## Usage

### Start the agent daemon

```bash
# Set environment variables
export CCC_AGENT_ID="your-agent-id"
export CCC_AGENT_SECRET="your-agent-secret"

# Start the agent
bun run dev

# Or use the built binary
./dist/index.js start
```

### Command-line options

```bash
ccc-agent start [options]

Options:
  -g, --gateway <url>       Gateway WebSocket URL (default: "wss://cli.di4.dev/agent")
  -i, --agent-id <id>       Agent ID (default: $CCC_AGENT_ID)
  -s, --secret <secret>     Agent secret (default: $CCC_AGENT_SECRET)
  --poll-interval <ms>      Tmux poll interval (default: "5000")
```

## How it works

1. **Tmux Session Discovery**: The agent polls tmux to discover sessions with `CCC_SESSION_*` environment variables
2. **Gateway Connection**: Connects to the gateway via WebSocket with agent credentials
3. **Session Registration**: Registers discovered sessions with the gateway
4. **Terminal Streaming**: When a client connects, spawns `tmux attach-session` and streams I/O

## Environment Variables

Sessions must set these environment variables to be discovered:

- `CCC_SESSION_ID` - Unique session identifier (required)
- `CCC_SESSION_*` - Additional metadata (optional)

Example:
```bash
export CCC_SESSION_ID="my-session-$(date +%s)"
export CCC_SESSION_PROJECT="my-project"
export CCC_SESSION_USER="username"
tmux new-session
```

## Architecture

```
┌─────────────┐         WebSocket          ┌─────────────┐
│   Gateway   │ ◄─────────────────────────► │  CCC Agent  │
└─────────────┘                             └─────────────┘
                                                    │
                                                    │ tmux attach
                                                    ▼
                                            ┌──────────────┐
                                            │ Tmux Session │
                                            └──────────────┘
```

## Development

```bash
# Run in development mode with auto-reload
bun run dev

# Build for production
bun run build

# Run built version
bun run start
```

## Protocol

### Agent → Gateway

- `register` - Register a tmux session
- `unregister` - Unregister a tmux session
- `output` - Terminal output data (base64)
- `disconnected` - Session disconnected

### Gateway → Agent

- `connect` - Connect to session
- `input` - Terminal input data (base64)
- `resize` - Resize terminal
- `disconnect` - Disconnect from session
