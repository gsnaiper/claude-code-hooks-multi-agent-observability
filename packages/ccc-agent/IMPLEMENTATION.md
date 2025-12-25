# CCC Agent Implementation Guide

## Overview

The `ccc-agent` package is a CLI tool that connects to the terminal gateway and exposes tmux sessions for remote access. It consists of three main components:

1. **CLI Entry Point** (`src/index.ts`) - Commander-based CLI
2. **Agent Core** (`src/agent.ts`) - WebSocket client and session manager
3. **Tmux Watcher** (`src/tmux-watcher.ts`) - Tmux session discovery

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CCC Agent                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐          ┌─────────────────┐        │
│  │     CLI      │          │  Tmux Watcher   │        │
│  │  (index.ts)  │          │                 │        │
│  └──────┬───────┘          │  - Poll tmux    │        │
│         │                  │  - Discover     │        │
│         │ creates          │    sessions     │        │
│         ▼                  │  - Emit events  │        │
│  ┌──────────────┐          └────────┬────────┘        │
│  │    Agent     │◄──────────────────┘                 │
│  │  (agent.ts)  │                                      │
│  │              │                                      │
│  │  - Gateway   │          ┌────────────────┐         │
│  │    WS conn   │──────────┤ Tmux Sessions  │         │
│  │  - Session   │          │  (spawned)     │         │
│  │    mgmt      │          └────────────────┘         │
│  └──────┬───────┘                                      │
└─────────┼────────────────────────────────────────────┘
          │
          │ WebSocket
          ▼
   ┌─────────────┐
   │   Gateway   │
   └─────────────┘
```

## Component Details

### 1. CLI Entry Point (`src/index.ts`)

**Purpose**: Command-line interface using Commander.js

**Commands**:
- `start` - Start the agent daemon
- `register` - Register agent with gateway (placeholder)

**Key Features**:
- Validates required credentials (agent ID and secret)
- Accepts configuration via CLI flags or environment variables
- Handles graceful shutdown on SIGINT/SIGTERM

**Implementation**:
```typescript
program
  .command('start')
  .option('-g, --gateway <url>', 'Gateway WebSocket URL')
  .option('-i, --agent-id <id>', 'Agent ID')
  .option('-s, --secret <secret>', 'Agent secret')
  .option('--poll-interval <ms>', 'Tmux poll interval')
  .action(async (options) => {
    const agent = new Agent(config);
    await agent.start();
  });
```

### 2. Agent Core (`src/agent.ts`)

**Purpose**: Main agent logic - WebSocket client and session manager

**Responsibilities**:
1. Connect to gateway via WebSocket
2. Handle reconnection with exponential backoff
3. Listen to tmux-watcher events
4. Register/unregister sessions with gateway
5. Spawn tmux attach processes for active connections
6. Stream terminal I/O between tmux and gateway

**Key Methods**:

- `start()` - Initialize agent and connect to gateway
- `stop()` - Graceful shutdown
- `connect()` - Establish WebSocket connection
- `registerSession(session)` - Send session metadata to gateway
- `connectSession(sessionId)` - Spawn tmux attach process
- `disconnectSession(sessionId)` - Kill tmux process
- `sendInput(sessionId, data)` - Forward input to tmux
- `resizeSession(sessionId, rows, cols)` - Resize terminal

**WebSocket Messages**:

**Agent → Gateway**:
```typescript
{ type: 'register', sessionId, metadata }
{ type: 'unregister', sessionId }
{ type: 'output', sessionId, data: base64 }
{ type: 'disconnected', sessionId }
```

**Gateway → Agent**:
```typescript
{ type: 'connect', sessionId, rows, cols }
{ type: 'input', sessionId, data: base64 }
{ type: 'resize', sessionId, rows, cols }
{ type: 'disconnect', sessionId }
```

**Session Connection Flow**:
```
1. Gateway sends: { type: 'connect', sessionId, rows, cols }
2. Agent spawns: tmux attach-session -t <sessionId> -r
3. Agent forwards: stdout → { type: 'output', data: base64 }
4. Gateway sends: { type: 'input', data: base64 }
5. Agent writes: base64 → tmux stdin
```

### 3. Tmux Watcher (`src/tmux-watcher.ts`)

**Purpose**: Discover and monitor tmux sessions with CCC environment variables

**Responsibilities**:
1. Poll tmux at regular intervals
2. List all tmux sessions
3. Extract environment variables from each session
4. Filter sessions with `CCC_SESSION_*` variables
5. Emit events when sessions start/end

**Key Methods**:

- `start()` - Begin polling tmux
- `stop()` - Stop polling
- `scan()` - Single poll iteration
- `listTmuxSessions()` - Get all tmux session IDs
- `getSessionEnvironment(sessionId)` - Extract env vars
- `getSessions()` - Get all active sessions

**Session Discovery Flow**:
```
1. Run: tmux list-sessions -F '#{session_id}'
2. For each session ID:
   a. Run: tmux show-environment -t <sessionId>
   b. Parse output for CCC_SESSION_* variables
   c. If found, create TmuxSession object
3. Compare with previous scan:
   - New sessions → emit 'session-start'
   - Ended sessions → emit 'session-end'
```

**Environment Variable Format**:
```bash
export CCC_SESSION_ID="unique-id"
export CCC_SESSION_PROJECT="my-project"
export CCC_SESSION_USER="username"
# Any CCC_SESSION_* variables become session metadata
```

## Setup Instructions

### 1. Initial Setup

```bash
cd packages/ccc-agent

# Run setup script (handles package.json creation)
chmod +x setup.sh
./setup.sh
```

Or manually:

```bash
# Move package.json.tmp to package.json
mv package.json.tmp package.json

# Install dependencies
bun install

# Build
bun run build
```

### 2. Configuration

Set required environment variables:

```bash
export CCC_AGENT_ID="your-agent-id-here"
export CCC_AGENT_SECRET="your-agent-secret-here"
```

### 3. Running the Agent

**Development mode** (with auto-reload):
```bash
bun run dev
```

**Production mode**:
```bash
# Build first
bun run build

# Run built binary
./dist/index.js start

# Or with custom options
./dist/index.js start \
  --gateway wss://your-gateway.com/agent \
  --poll-interval 3000
```

### 4. Testing with Tmux

Create a test tmux session with CCC environment variables:

```bash
# Start a new tmux session
tmux new-session -s test

# Inside tmux, set environment variables
tmux set-environment CCC_SESSION_ID "test-$(date +%s)"
tmux set-environment CCC_SESSION_PROJECT "my-project"
tmux set-environment CCC_SESSION_USER "$USER"

# Detach from session
# Press Ctrl+b, then d

# The agent should automatically discover this session
```

## Protocol Specification

### WebSocket Connection

**URL**: `wss://gateway-host/agent`

**Headers**:
```
x-agent-id: <agent-id>
x-agent-secret: <agent-secret>
```

### Message Types

#### Agent → Gateway

**Register Session**:
```json
{
  "type": "register",
  "sessionId": "test-1234567890",
  "metadata": {
    "CCC_SESSION_ID": "test-1234567890",
    "CCC_SESSION_PROJECT": "my-project",
    "CCC_SESSION_USER": "username"
  }
}
```

**Unregister Session**:
```json
{
  "type": "unregister",
  "sessionId": "test-1234567890"
}
```

**Terminal Output**:
```json
{
  "type": "output",
  "sessionId": "test-1234567890",
  "data": "base64-encoded-output"
}
```

**Session Disconnected**:
```json
{
  "type": "disconnected",
  "sessionId": "test-1234567890"
}
```

#### Gateway → Agent

**Connect to Session**:
```json
{
  "type": "connect",
  "sessionId": "test-1234567890",
  "rows": 24,
  "cols": 80
}
```

**Send Input**:
```json
{
  "type": "input",
  "sessionId": "test-1234567890",
  "data": "base64-encoded-input"
}
```

**Resize Terminal**:
```json
{
  "type": "resize",
  "sessionId": "test-1234567890",
  "rows": 40,
  "cols": 120
}
```

**Disconnect from Session**:
```json
{
  "type": "disconnect",
  "sessionId": "test-1234567890"
}
```

## Error Handling

### Connection Failures

The agent implements automatic reconnection with exponential backoff:

- Attempts reconnection up to 10 times
- Delay increases: 5s, 10s, 15s, 20s, 25s (max)
- After max attempts, agent exits

### Session Errors

- If tmux session not found → sends error to gateway
- If tmux attach fails → logs error and removes session
- If process exits → sends "disconnected" message

### Tmux Watcher Errors

- If tmux not running → returns empty session list
- If environment read fails → logs error, skips session
- Continues polling even if individual scans fail

## Debugging

### Enable Verbose Logging

The implementation includes console.log statements for debugging:

```
[Agent] Starting agent <agent-id>
[Agent] Connecting to gateway: <url>
[Agent] Connected to gateway
[TmuxWatcher] Starting watcher...
[TmuxWatcher] Discovered session: <session-id>
[Agent] Discovered session: <session-id>
[Agent] Connecting to session: <session-id> (80x24)
```

### Common Issues

**Agent can't connect to gateway**:
- Check gateway URL is correct
- Verify agent ID and secret are valid
- Check network connectivity

**Sessions not discovered**:
- Ensure tmux is running
- Verify `CCC_SESSION_*` environment variables are set
- Check tmux session has not exited

**Terminal I/O not working**:
- Verify tmux attach command succeeds manually
- Check base64 encoding/decoding
- Ensure terminal size is set correctly

## Development

### Project Structure

```
packages/ccc-agent/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── agent.ts          # Agent core logic
│   └── tmux-watcher.ts   # Tmux discovery
├── dist/                 # Built output
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── README.md            # Usage guide
├── IMPLEMENTATION.md    # This file
├── setup.sh             # Setup script
├── .gitignore
└── .npmignore
```

### Building

```bash
# Build for Node.js
bun run build

# Output: dist/index.js
```

### Testing

Create test scenarios:

1. **Single session**: One tmux session with CCC env vars
2. **Multiple sessions**: Several sessions running simultaneously
3. **Session lifecycle**: Start/stop sessions while agent is running
4. **Reconnection**: Kill gateway connection and verify reconnect
5. **Terminal I/O**: Connect and send commands through gateway

## Future Enhancements

1. **Registration API**: Implement `register` command to get credentials from gateway
2. **Health checks**: Periodic ping/pong with gateway
3. **Metrics**: Track session count, connection duration, data transferred
4. **Logging**: Structured logging with levels (debug, info, warn, error)
5. **Configuration file**: Support config file in addition to CLI flags
6. **Authentication refresh**: Automatic credential renewal
7. **Session metadata updates**: Support updating metadata while session is running
8. **Multiple gateways**: Connect to multiple gateway instances
9. **TLS certificate validation**: Custom CA support for self-signed certs
10. **Rate limiting**: Prevent overwhelming gateway with too many sessions
