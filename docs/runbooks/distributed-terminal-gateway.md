# Distributed Terminal Gateway - Operations Runbook

**System**: Distributed Terminal Gateway
**Owner**: DevOps Team
**Last Updated**: 2025-12-25
**Version**: 1.0.0

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Configuration](#configuration)
5. [Operations](#operations)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)
8. [Security](#security)
9. [Disaster Recovery](#disaster-recovery)
10. [Appendix](#appendix)

---

## System Overview

### Purpose

The Distributed Terminal Gateway provides remote terminal access to Claude Code sessions running on distributed hosts. It enables web clients to connect to terminal sessions via WebSocket, supporting both:

- **Outbound connections**: Gateway connects to remote sessions (SSH, Docker, Local tmux)
- **Inbound connections**: Remote agents connect to gateway (Reverse tunnel via ccc-agent)

### Key Components

| Component | Description | Location |
|-----------|-------------|----------|
| Terminal Gateway | Main WebSocket router and coordinator | `apps/server/src/terminal/gateway.ts` |
| Agent Handler | Protocol handler for remote agents | `apps/server/src/terminal/agent-handler.ts` |
| Agent Registry | In-memory registry of connected agents | `apps/server/src/terminal/agent-registry.ts` |
| Connection Manager | Factory for local/SSH/Docker connections | `apps/server/src/terminal/connection-manager.ts` |
| Location Registry | Database CRUD for session locations | `apps/server/src/terminal/location-registry.ts` |
| CCC Agent | Remote agent daemon (ccc-agent) | `packages/ccc-agent/` |
| Terminal Viewer | Frontend xterm.js component | `apps/client/src/components/TerminalViewer.vue` |

### Service Dependencies

- **Database**: SQLite or PostgreSQL (`session_locations` table)
- **WebSocket Server**: Bun.serve with WebSocket support
- **Tmux**: Terminal multiplexer on remote hosts
- **Node.js/Bun**: Runtime for ccc-agent daemon

---

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Client (Vue 3)                        │
│                  https://ai.di4.dev                          │
│                     xterm.js terminal                        │
└─────────────────────────────────────────────────────────────┘
                              │ WebSocket (terminal I/O)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               Gateway Server (cli.di4.dev:4000)              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │               Terminal Gateway Router                   │ │
│  │                                                         │ │
│  │  ┌─────────────────┐    ┌──────────────────────────┐   │ │
│  │  │ Outbound Pool   │    │ Inbound Registry         │   │ │
│  │  │ - SSH clients   │    │ - Connected agents       │   │ │
│  │  │ - Docker API    │    │ - Session → WebSocket    │   │ │
│  │  │ - Local tmux    │    │ - Heartbeat tracking     │   │ │
│  │  └─────────────────┘    └──────────────────────────┘   │ │
│  │                                                         │ │
│  │  Session Location Registry (DB) + WebSocket Mux         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │                  │                   ▲
         │ SSH              │ Docker            │ WebSocket
         │ (outbound)       │ (outbound)        │ (inbound)
         ▼                  ▼                   │
┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐
│ Remote Host │    │  Container  │    │   Remote Agent      │
│ tmux (SSH)  │    │ tmux (exec) │    │ (ccc-agent daemon)  │
│             │    │             │    │ connects TO gateway │
└─────────────┘    └─────────────┘    └─────────────────────┘
```

### Connection Types

| Type | Direction | Transport | Use Case |
|------|-----------|-----------|----------|
| `local` | - | Direct | Gateway server = tmux server |
| `ssh` | Outbound | SSH tunnel | Remote host with SSH access |
| `docker` | Outbound | Docker API | Container with Docker socket |
| `reverse` | Inbound | WebSocket | Remote agent connects to gateway |

### WebSocket Endpoints

- `ws://localhost:4000/terminal` - Web client connections
- `ws://localhost:4000/agent` - Remote agent connections (ccc-agent)

---

## Prerequisites

### Required Access

- **Server**: SSH/sudo access to gateway server
- **Database**: Read/write permissions to `session_locations` table
- **Logs**: Access to application logs

### Required Tools

- **bun** (v1.0+) or **node** (v18+)
- **tmux** (v2.0+)
- **git** (for deployments)
- **curl** (for health checks)
- **jq** (for JSON parsing)

### Required Credentials

- **Database credentials** (if using PostgreSQL)
- **Agent secrets** (`AGENT_SECRET_*` or `AGENT_SECRETS`)
- **SSH keys** (for outbound SSH connections)

---

## Configuration

### Server Environment Variables

```bash
# Server (apps/server/.env)

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname  # or use SQLite

# Terminal Gateway
TERMINAL_MAX_CONNECTIONS=50
TERMINAL_IDLE_TIMEOUT=300000  # 5 minutes
AGENT_HEARTBEAT_INTERVAL=30000  # 30 seconds
AGENT_HEARTBEAT_TIMEOUT=90000   # 90 seconds

# Agent Authentication
AGENT_SECRETS=secret1,secret2,secret3  # Comma-separated global secrets
# OR per-agent secrets:
AGENT_SECRET_MY_AGENT_ID=my-secret-token
AGENT_SECRET_PROD_AGENT_01=another-secret

# SSH Outbound (optional)
SSH_PRIVATE_KEY_PATH=/home/user/.ssh/id_rsa
SSH_AUTH_SOCK=/run/user/1000/ssh-agent.socket

# Docker Outbound (optional)
DOCKER_SOCKET_PATH=/var/run/docker.sock
```

### Remote Agent Configuration

```bash
# Remote host (ccc-agent)

# Required
CCC_GATEWAY_URL=wss://cli.di4.dev/agent
CCC_AGENT_ID=my-agent-id
CCC_AGENT_SECRET=secret-token

# Optional
CCC_RECONNECT_DELAY=5000
CCC_TMUX_POLL_INTERVAL=5000
```

### Database Schema

The `session_locations` table tracks terminal session locations:

```sql
CREATE TABLE session_locations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  connection_type TEXT NOT NULL,  -- 'local' | 'ssh' | 'docker' | 'reverse'

  -- Outbound connection params (ssh/docker)
  host TEXT,
  port INTEGER,
  username TEXT,
  container_id TEXT,

  -- Tmux params (all types)
  tmux_session_name TEXT,
  tmux_window_name TEXT,

  -- Reverse connection params
  reverse_agent_id TEXT,

  -- Status
  status TEXT DEFAULT 'pending',  -- 'pending' | 'active' | 'inactive'
  last_heartbeat_at INTEGER,
  last_verified_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_session_locations_agent ON session_locations(reverse_agent_id);
```

---

## Operations

### Starting Services

#### Start Gateway Server

```bash
# Navigate to server directory
cd apps/server

# Install dependencies (first time)
bun install

# Start server
bun run src/index.ts

# Expected output:
# [DB] SQLite adapter selected
# [LanceDB] Initialized successfully
# 🚀 Server running on http://localhost:4000
# 📊 WebSocket endpoint: ws://localhost:4000/stream
# 🖥️  Terminal gateway (web): ws://localhost:4000/terminal
# 🤖 Terminal gateway (agent): ws://localhost:4000/agent
```

#### Start Remote Agent (ccc-agent)

```bash
# On remote host
cd packages/ccc-agent

# Install dependencies (first time)
bun install
bun run build

# Set credentials
export CCC_GATEWAY_URL=wss://cli.di4.dev/agent
export CCC_AGENT_ID=prod-agent-01
export CCC_AGENT_SECRET=your-secret-here

# Start agent
bun run start

# Expected output:
# [Agent] Starting agent prod-agent-01
# [Agent] Connecting to gateway: wss://cli.di4.dev/agent
# [Agent] Connected to gateway
# [Agent] Registration confirmed: Agent successfully registered with gateway
```

### Stopping Services

#### Stop Gateway Server

```bash
# Find process
ps aux | grep "bun.*index.ts"

# Graceful stop (SIGTERM)
kill <PID>

# Force stop (SIGKILL) - use only if graceful fails
kill -9 <PID>
```

#### Stop Remote Agent

```bash
# Find process
ps aux | grep "ccc-agent"

# Graceful stop
kill <PID>

# Or use Ctrl+C if running in foreground
```

### Restarting Services

```bash
# Restart gateway server
cd apps/server
pkill -f "bun.*index.ts"
sleep 2
bun run src/index.ts &

# Restart remote agent
pkill -f "ccc-agent"
sleep 2
cd packages/ccc-agent && bun run start &
```

### Verifying Service Health

#### Check Gateway Status

```bash
# Check WebSocket endpoints
curl -i http://localhost:4000/terminal
# Expected: 101 Switching Protocols

curl -i http://localhost:4000/agent
# Expected: 101 Switching Protocols

# Check active connections via API (if available)
curl http://localhost:4000/api/terminal/stats
```

#### Check Agent Status

```bash
# Check agent logs
tail -f /var/log/ccc-agent.log

# Verify agent is connected
# Look for: "[Agent] Connected to gateway"
# Look for: "[Agent] Registration confirmed"
```

### Deploying Updates

```bash
# On gateway server
cd /opt/claude-code-hooks-multi-agent-observability
git fetch origin
git checkout main
git pull origin main

# Rebuild if needed
cd apps/server
bun install

# Restart service
sudo systemctl restart terminal-gateway
# OR manually restart

# On remote agent hosts
cd /opt/ccc-agent
git pull origin main
cd packages/ccc-agent
bun install
bun run build

# Restart agent
sudo systemctl restart ccc-agent
```

---

## Monitoring

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| Active WebSocket Connections | Total clients + agents connected | - |
| Agent Connection Count | Number of registered agents | Alert if 0 |
| Session Location Entries | Total sessions in database | - |
| Agent Heartbeat Age | Time since last heartbeat | > 90 seconds |
| Session Status | Active/Inactive sessions | - |
| Connection Errors | Failed connection attempts | > 10/min |

### Health Checks

#### Gateway Health Check

```bash
#!/bin/bash
# health-check-gateway.sh

GATEWAY_URL="http://localhost:4000"

# Check if server is responding
if ! curl -f -s "${GATEWAY_URL}/api/events" > /dev/null; then
  echo "ERROR: Gateway not responding"
  exit 1
fi

# Check WebSocket endpoints
if ! curl -i -s "${GATEWAY_URL}/terminal" | grep -q "101"; then
  echo "WARNING: /terminal endpoint not accepting WebSocket"
fi

if ! curl -i -s "${GATEWAY_URL}/agent" | grep -q "101"; then
  echo "WARNING: /agent endpoint not accepting WebSocket"
fi

echo "Gateway health: OK"
exit 0
```

#### Agent Health Check

```bash
#!/bin/bash
# health-check-agent.sh

AGENT_LOG="/var/log/ccc-agent.log"

# Check if agent process is running
if ! pgrep -f "ccc-agent" > /dev/null; then
  echo "ERROR: Agent process not running"
  exit 1
fi

# Check for recent registration confirmation
if ! tail -100 "$AGENT_LOG" | grep -q "Registration confirmed"; then
  echo "WARNING: No recent registration confirmation"
fi

# Check for connection errors
ERROR_COUNT=$(tail -100 "$AGENT_LOG" | grep -c "ERROR\|error")
if [ "$ERROR_COUNT" -gt 5 ]; then
  echo "WARNING: High error count: $ERROR_COUNT in last 100 lines"
fi

echo "Agent health: OK"
exit 0
```

### Log Locations

```bash
# Gateway server logs
/var/log/terminal-gateway.log  # Application log
/var/log/terminal-gateway-error.log  # Error log

# Remote agent logs
/var/log/ccc-agent.log  # Agent log
```

### Log Patterns to Monitor

**Gateway:**
```
[TerminalGateway] New web client connection
[TerminalGateway] Connected to session <id> via <type>
[AgentHandler] Agent registered: <agent_id>
[AgentHandler] Session started on agent <agent_id>: <session_id>
ERROR: [TerminalGateway] Error connecting to session
ERROR: [AgentHandler] Agent <agent_id> failed authentication
```

**Agent:**
```
[Agent] Connected to gateway
[Agent] Registration confirmed
[Agent] Discovered session: <session_id>
[Agent] Connecting to session: <session_id>
ERROR: [Agent] WebSocket error
ERROR: [Agent] Session not connected
```

---

## Troubleshooting

### Common Issues

#### Issue 1: Agent Cannot Connect to Gateway

**Symptoms:**
- Agent logs show: `[Agent] WebSocket error`
- No registration confirmation

**Diagnosis:**
```bash
# Check network connectivity
curl -v wss://cli.di4.dev/agent

# Check agent credentials
echo $CCC_AGENT_ID
echo $CCC_AGENT_SECRET

# Check gateway logs for authentication failures
grep "failed authentication" /var/log/terminal-gateway.log
```

**Resolution:**
1. Verify `CCC_GATEWAY_URL` is correct and reachable
2. Verify agent ID and secret match gateway configuration
3. Check firewall rules allow outbound WebSocket connections
4. Verify gateway `AGENT_SECRETS` or `AGENT_SECRET_<AGENT_ID>` is configured

#### Issue 2: Session Not Found

**Symptoms:**
- Web client shows: "Session location not found"
- Gateway logs: `Session location not found. The session may not have been registered yet.`

**Diagnosis:**
```bash
# Check if session exists in database
sqlite3 apps/server/observability.db "SELECT * FROM session_locations WHERE session_id = '<session_id>'"

# Check if agent is online
# Look in gateway logs for agent registration
```

**Resolution:**
1. Verify tmux session has `CCC_SESSION_ID` environment variable set
2. Verify agent is connected and registered
3. Wait a few seconds for agent to discover session (poll interval: 5s)
4. Manually create session location entry if needed

#### Issue 3: Protocol Mismatch Errors

**Symptoms:**
- Agent logs: `Unknown message type: agent:command:connect`
- Gateway logs: `Unknown message type from agent`

**Diagnosis:**
```bash
# Check agent version
cd packages/ccc-agent && git log -1

# Check gateway version
cd apps/server/src/terminal && git log -1
```

**Resolution:**
1. Ensure agent and gateway are on compatible versions
2. Latest fix: commit `89c690d` (2025-12-25)
3. Update agent: `cd packages/ccc-agent && git pull && bun run build`
4. Restart agent

#### Issue 4: Authentication Failures

**Symptoms:**
- Gateway logs: `Agent <agent_id> failed authentication`
- Agent disconnects immediately after connecting

**Diagnosis:**
```bash
# Check gateway environment variables
env | grep AGENT_SECRET

# Check if per-agent secret exists
env | grep "AGENT_SECRET_${AGENT_ID}"

# Test authentication manually
# Expected: isValid = true in gateway logs
```

**Resolution:**
1. **Option 1 - Per-agent secret:**
   ```bash
   export AGENT_SECRET_MY_AGENT_ID=correct-secret
   ```

2. **Option 2 - Global secrets:**
   ```bash
   export AGENT_SECRETS=secret1,secret2,agent-secret
   ```

3. **Option 3 - Development mode (no secrets):**
   ```bash
   unset AGENT_SECRETS
   unset AGENT_SECRET_*
   # Warning will be logged
   ```

#### Issue 5: High Memory Usage

**Symptoms:**
- Gateway process consuming > 2GB memory
- Slow response times

**Diagnosis:**
```bash
# Check process memory
ps aux | grep "bun.*index.ts" | awk '{print $6}'

# Check active sessions
sqlite3 apps/server/observability.db "SELECT COUNT(*) FROM session_locations WHERE status = 'active'"

# Check agent registry size (via code or logs)
```

**Resolution:**
1. Review `TERMINAL_MAX_CONNECTIONS` setting
2. Clean up inactive sessions in database
3. Restart gateway to clear in-memory state
4. Check for WebSocket connection leaks

### Debugging Commands

```bash
# List all active sessions
sqlite3 apps/server/observability.db \
  "SELECT session_id, connection_type, reverse_agent_id, status FROM session_locations WHERE status = 'active'"

# Count sessions by type
sqlite3 apps/server/observability.db \
  "SELECT connection_type, COUNT(*) FROM session_locations GROUP BY connection_type"

# Find orphaned sessions (no heartbeat in 5 minutes)
sqlite3 apps/server/observability.db \
  "SELECT session_id, datetime(last_heartbeat_at, 'unixepoch') FROM session_locations WHERE last_heartbeat_at < strftime('%s', 'now', '-5 minutes')"

# Test WebSocket connection
wscat -c ws://localhost:4000/terminal
# Send: {"type":"terminal:connect","session_id":"test-session","project_id":"test-project","cols":80,"rows":24}

# Monitor agent heartbeats
tail -f /var/log/terminal-gateway.log | grep heartbeat
```

---

## Security

### Authentication

**Agent Authentication:**
- Uses `agent_secret` validated against environment variables
- Supports per-agent secrets: `AGENT_SECRET_<AGENT_ID>`
- Supports global secret list: `AGENT_SECRETS`
- Development fallback: allows all if no secrets configured (logs warning)

**Validation Flow:**
```typescript
// apps/server/src/terminal/agent-handler.ts
validateAgentCredentials(agentId, agentSecret)
  1. Check AGENT_SECRET_<NORMALIZED_AGENT_ID>
  2. Check AGENT_SECRETS (comma-separated list)
  3. Fallback: allow in dev mode (warning logged)
```

### Network Security

**Firewall Rules:**
```bash
# Gateway server (inbound)
ufw allow 4000/tcp  # WebSocket endpoints

# Remote agent (outbound)
# Allow outbound WebSocket to gateway URL
ufw allow out to <gateway-ip> port 443  # HTTPS/WSS
```

**SSL/TLS:**
- Production: Use `wss://` (WebSocket Secure)
- Development: Can use `ws://` (unencrypted)
- Certificate management: Let's Encrypt or corporate CA

### Access Control

**Role-Based Access:**
- Gateway admin: Full access to all endpoints
- Agent operator: Can register/manage agents
- End user: Can view terminals they have permissions for

**Secret Rotation:**
```bash
# Generate new agent secret
NEW_SECRET=$(openssl rand -base64 32)

# Update gateway
export AGENT_SECRET_MY_AGENT_ID="$NEW_SECRET"
systemctl restart terminal-gateway

# Update agent
export CCC_AGENT_SECRET="$NEW_SECRET"
systemctl restart ccc-agent
```

---

## Disaster Recovery

### Backup Procedures

#### Database Backup

```bash
#!/bin/bash
# backup-session-locations.sh

BACKUP_DIR="/opt/backups/terminal-gateway"
DATE=$(date +%Y%m%d_%H%M%S)

# SQLite backup
sqlite3 apps/server/observability.db ".backup ${BACKUP_DIR}/session_locations_${DATE}.db"

# PostgreSQL backup
pg_dump -h localhost -U user -d dbname -t session_locations > "${BACKUP_DIR}/session_locations_${DATE}.sql"

# Compress
gzip "${BACKUP_DIR}/session_locations_${DATE}.sql"

# Keep last 30 days
find "$BACKUP_DIR" -name "session_locations_*.db.gz" -mtime +30 -delete
```

#### Configuration Backup

```bash
# Backup environment files
tar -czf /opt/backups/terminal-gateway-config-$(date +%Y%m%d).tar.gz \
  apps/server/.env \
  packages/ccc-agent/.env \
  /etc/systemd/system/terminal-gateway.service \
  /etc/systemd/system/ccc-agent.service
```

### Recovery Procedures

#### Restore Database

```bash
# SQLite restore
sqlite3 apps/server/observability.db < /opt/backups/session_locations_20251225.sql

# PostgreSQL restore
psql -h localhost -U user -d dbname < /opt/backups/session_locations_20251225.sql
```

#### Disaster Recovery Steps

1. **Gateway Failure:**
   ```bash
   # On backup server
   git clone <repo>
   cd apps/server
   bun install

   # Restore database
   cp /opt/backups/session_locations_latest.db observability.db

   # Restore environment
   cp /opt/backups/.env.backup .env

   # Start service
   bun run src/index.ts
   ```

2. **Agent Failure:**
   ```bash
   # On remote host
   cd packages/ccc-agent
   git pull
   bun install
   bun run build

   # Restore credentials
   export CCC_AGENT_ID=<agent-id>
   export CCC_AGENT_SECRET=<secret>

   # Start agent
   bun run start
   ```

3. **Complete System Failure:**
   - Restore gateway from backup
   - Restore database from latest backup
   - Restart all remote agents (they will auto-reconnect)
   - Verify all sessions re-register within 5-10 seconds

---

## Appendix

### File Locations

```
apps/server/src/terminal/
├── types.ts              # TypeScript interfaces for protocol
├── gateway.ts            # Main WebSocket router (628 lines)
├── agent-handler.ts      # Agent protocol handler (612 lines)
├── agent-registry.ts     # In-memory agent registry (323 lines)
├── connection-manager.ts # Connection factory (330 lines)
└── location-registry.ts  # Database CRUD (352 lines)

packages/ccc-agent/src/
├── index.ts              # CLI entry point
├── agent.ts              # Main agent class (282 lines)
└── tmux-watcher.ts       # Tmux session discovery

apps/client/src/
├── components/TerminalViewer.vue  # xterm.js terminal
└── composables/useTerminal.ts     # WebSocket composable
```

### Protocol Reference

**Web Client → Gateway:**
```json
{"type":"terminal:connect","session_id":"<id>","project_id":"<id>","cols":80,"rows":24}
{"type":"terminal:input","session_id":"<id>","data":"<base64>"}
{"type":"terminal:resize","session_id":"<id>","cols":120,"rows":40}
{"type":"terminal:disconnect","session_id":"<id>"}
```

**Gateway → Web Client:**
```json
{"type":"terminal:output","session_id":"<id>","data":"<base64>","timestamp":1703520000000}
{"type":"terminal:status","session_id":"<id>","status":"connected","connection_type":"reverse","agent_id":"<id>","timestamp":1703520000000}
{"type":"terminal:error","session_id":"<id>","error":"<message>","details":{}}
```

**Agent → Gateway:**
```json
{"type":"agent:register","agent_id":"<id>","agent_secret":"<secret>","sessions":[{"session_id":"<id>","tmux_session_name":"<name>"}]}
{"type":"agent:heartbeat","agent_id":"<id>"}
{"type":"agent:session:start","session_id":"<id>","project_id":"<id>","tmux_session_name":"<name>"}
{"type":"agent:session:end","session_id":"<id>","reason":"<reason>"}
{"type":"agent:session:output","session_id":"<id>","data":"<base64>"}
{"type":"agent:session:error","session_id":"<id>","error":"<message>"}
```

**Gateway → Agent:**
```json
{"type":"agent:command:connect","session_id":"<id>","cols":80,"rows":24,"timestamp":1703520000000}
{"type":"agent:command:input","session_id":"<id>","data":"<base64>","timestamp":1703520000000}
{"type":"agent:command:resize","session_id":"<id>","cols":120,"rows":40,"timestamp":1703520000000}
{"type":"agent:command:disconnect","session_id":"<id>","timestamp":1703520000000}
{"type":"agent:command:ping","timestamp":1703520000000}
{"type":"agent:registered","agent_id":"<id>","message":"Agent successfully registered","timestamp":1703520000000}
{"type":"agent:pong","timestamp":1703520000000}
{"type":"gateway:error","error":"<message>","details":{},"timestamp":1703520000000}
```

### Systemd Service Files

**Gateway Service:**
```ini
# /etc/systemd/system/terminal-gateway.service
[Unit]
Description=Terminal Gateway Server
After=network.target postgresql.service

[Service]
Type=simple
User=claude
WorkingDirectory=/opt/claude-code-hooks-multi-agent-observability/apps/server
Environment="NODE_ENV=production"
EnvironmentFile=/opt/terminal-gateway/.env
ExecStart=/usr/local/bin/bun run src/index.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Agent Service:**
```ini
# /etc/systemd/system/ccc-agent.service
[Unit]
Description=CCC Agent for Terminal Gateway
After=network.target

[Service]
Type=simple
User=claude
WorkingDirectory=/opt/ccc-agent/packages/ccc-agent
EnvironmentFile=/opt/ccc-agent/.env
ExecStart=/usr/local/bin/bun run start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### Related Documentation

- [Plan: Distributed Terminal Gateway](/home/snaiper/.claude/plans/ethereal-shimmying-quilt.md)
- [CCC Agent README](/mnt/c/CCD_TEMP/GITHUB/claude-code-hooks-multi-agent-observability/packages/ccc-agent/README.md)
- [CCC Agent Implementation](/mnt/c/CCD_TEMP/GITHUB/claude-code-hooks-multi-agent-observability/packages/ccc-agent/IMPLEMENTATION.md)

### Recent Changes

**2025-12-25 - Protocol & Security Fixes (commit 89c690d):**
- Fixed protocol mismatch between ccc-agent and gateway
- Added agent authentication validation with environment variable secrets
- Implemented database session location updates
- Added proper async/await handling for database operations

**2025-12-25 - Initial Implementation (commits 231f27a, bffbc41):**
- Created terminal gateway infrastructure
- Added CCC agent package
- Implemented WebSocket routing for /terminal and /agent endpoints
- Added session_locations table to database

---

**End of Runbook**
