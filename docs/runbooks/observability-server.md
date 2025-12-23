# Observability Server Operational Runbook

**System:** Multi-Agent Observability Platform
**Version:** 1.0
**Last Updated:** 2025-12-22
**Owner:** DevOps/SRE Team

---

## Quick Reference

| Action | Command |
|--------|---------|
| **Start System** | `./scripts/start-system.sh` |
| **Stop System** | `./scripts/reset-system.sh` |
| **Health Check** | `curl http://localhost:4000/events/filter-options` |
| **View Dashboard** | `http://localhost:5173` |
| **WebSocket URL** | `ws://localhost:4000/stream` |
| **Server Logs** | Check terminal output where server started |
| **Database Location** | `apps/server/events.db` |

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Startup Procedures](#startup-procedures)
3. [Shutdown Procedures](#shutdown-procedures)
4. [Configuration](#configuration)
5. [Database Operations](#database-operations)
6. [Monitoring & Health Checks](#monitoring--health-checks)
7. [Troubleshooting](#troubleshooting)
8. [Human-in-the-Loop Operations](#human-in-the-loop-operations)
9. [API Reference](#api-reference)
10. [Operational Metrics](#operational-metrics)
11. [Security & Best Practices](#security--best-practices)
12. [Integration Guide](#integration-guide)

---

## System Architecture

### Overview

The Multi-Agent Observability System provides real-time monitoring and visualization of Claude Code agent behavior through a hook-based event capture pipeline.

```
┌─────────────────┐
│  Claude Agent   │
│  (Claude Code)  │
└────────┬────────┘
         │ Hook Events
         ▼
┌─────────────────┐
│  Python Hooks   │
│  (.claude/hooks)│
└────────┬────────┘
         │ HTTP POST
         ▼
┌─────────────────┐      ┌──────────────┐
│   Bun Server    │◄────►│   SQLite DB  │
│   (Port 4000)   │      │  (events.db) │
└────────┬────────┘      └──────────────┘
         │ WebSocket
         ▼
┌─────────────────┐
│   Vue Client    │
│   (Port 5173)   │
└─────────────────┘
```

### Components

| Component | Technology | Location | Purpose |
|-----------|------------|----------|---------|
| **Server** | Bun + TypeScript | `apps/server/` | HTTP API + WebSocket server |
| **Client** | Vue 3 + TypeScript | `apps/client/` | Dashboard UI |
| **Database** | SQLite + WAL | `apps/server/events.db` | Event storage |
| **Hooks** | Python 3.8+ | `.claude/hooks/` | Event capture scripts |
| **Scripts** | Bash | `scripts/` | System management |

### Data Flow

1. **Event Capture**: Claude Code hooks intercept lifecycle events (PreToolUse, PostToolUse, etc.)
2. **Event Transmission**: Python scripts POST events to `http://localhost:4000/events`
3. **Event Storage**: Server validates and stores events in SQLite database
4. **Event Broadcasting**: Server broadcasts new events via WebSocket to all connected clients
5. **Event Visualization**: Vue client displays events in real-time dashboard

### Port Allocation

| Service | Default Port | Worktree Pattern |
|---------|-------------|------------------|
| Server HTTP/WS | 4000 | 4000 + (offset × 10) |
| Client Dev | 5173 | 5173 + (offset × 10) |

**Example Worktree Ports:**
- Main: 4000, 5173
- Worktree 1: 4010, 5183
- Worktree 2: 4020, 5193

### Technology Stack

**Server Runtime:**
- Bun v1.2.17+ (built-in HTTP, WebSocket, SQLite support)
- TypeScript 5.8+
- No external HTTP framework required

**Client Runtime:**
- Vue 3 with Composition API
- Vite bundler
- Tailwind CSS
- TypeScript

**Database:**
- SQLite 3 with WAL (Write-Ahead Logging) mode
- Automatic schema migrations
- Indexes on: source_app, session_id, hook_event_type, timestamp

---

## Startup Procedures

### Quick Start (Recommended)

```bash
# From project root
./scripts/start-system.sh
```

**What happens:**
1. Kills any processes on ports 4000 and 5173
2. Starts Bun server with hot reload
3. Waits for server health check (10 retries, 1s intervals)
4. Starts Vite client dev server
5. Waits for client availability
6. Displays process IDs and URLs

**Expected Output:**
```
🚀 Server running on http://localhost:4000
📊 WebSocket endpoint: ws://localhost:4000/stream
📮 POST events to: http://localhost:4000/events
Server PID: 12345

Client running on http://localhost:5173
Client PID: 12346

✅ System started successfully
Press Ctrl+C to stop
```

### Manual Startup (Debugging)

**Terminal 1 - Server:**
```bash
cd apps/server
bun run dev
# Or without hot reload: bun run start
```

**Terminal 2 - Client:**
```bash
cd apps/client
bun run dev
```

### Custom Port Configuration

```bash
# Set custom ports via environment variables
SERVER_PORT=3000 CLIENT_PORT=8080 ./scripts/start-system.sh
```

### Verification Steps

After startup, verify system health:

```bash
# 1. Check server health
curl http://localhost:4000/events/filter-options
# Expected: JSON with arrays (source_apps, session_ids, hook_event_types)

# 2. Check client availability
curl -I http://localhost:5173
# Expected: HTTP/1.1 200 OK

# 3. Test WebSocket (from browser console)
const ws = new WebSocket('ws://localhost:4000/stream');
ws.onopen = () => console.log('✅ Connected');
ws.onerror = (e) => console.error('❌ Error:', e);
```

### Startup Troubleshooting

**Port Already in Use:**
```bash
# Find process using port 4000
lsof -i :4000                    # macOS
fuser -n tcp 4000                # Linux

# Kill the process
kill -9 <PID>

# Or use reset script
./scripts/reset-system.sh
```

**Server Won't Start:**
```bash
# Check Bun is installed
bun --version
# Should show v1.2.17 or higher

# Check TypeScript compilation
cd apps/server
bun run typecheck
```

**Database Initialization Errors:**
```bash
# Remove corrupted database
rm -f apps/server/events.db*

# Restart server (will recreate database)
cd apps/server && bun run dev
```

---

## Shutdown Procedures

### Graceful Shutdown

**If started with start-system.sh:**
```bash
# Press Ctrl+C in the terminal
# Script handles cleanup automatically
```

**Manual Shutdown:**
```bash
./scripts/reset-system.sh
```

**What happens:**
1. Kills processes on ports 4000 and 5173
2. Kills any remaining Bun processes for apps
3. Cleans up SQLite WAL files
4. Preserves main database (`events.db`)

### Emergency Shutdown

```bash
# Kill all Bun processes
pkill -9 bun

# Kill specific ports
lsof -ti :4000 | xargs kill -9
lsof -ti :5173 | xargs kill -9

# Clean WAL files
rm -f apps/server/events.db-wal apps/server/events.db-shm
```

### Complete Reset (Clear All Data)

```bash
# Stop services
./scripts/reset-system.sh

# Remove database
rm -f apps/server/events.db*

# Restart
./scripts/start-system.sh
```

**⚠️ WARNING:** This deletes all historical event data.

---

## Configuration

### Environment Variables

#### Server Configuration

**File:** `apps/server/.env` (create from `.env.sample`)

```bash
# Server port (default: 4000)
SERVER_PORT=4000
```

**Note:** Server doesn't require API keys for operation.

#### Client Configuration

**File:** `apps/client/.env` (create from `.env.sample`)

```bash
# Maximum events to display (default: 300)
VITE_MAX_EVENTS_TO_DISPLAY=300

# Server URL override (optional, auto-detected)
# VITE_API_URL=http://localhost:4000
# VITE_WS_URL=ws://localhost:4000/stream
```

#### Hook Configuration

**File:** `.env` (project root)

```bash
# Required for AI summarization (--summarize flag)
ANTHROPIC_API_KEY=sk-ant-...

# Optional: Engineer name for TTS personalization
ENGINEER_NAME=Dan

# Optional: Alternative AI services
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
```

### Hook System Setup

**File:** `.claude/settings.json`

**Key Configuration Points:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "uv run .claude/hooks/pre_tool_use.py"
          },
          {
            "type": "command",
            "command": "uv run .claude/hooks/send_event.py --source-app cc-hook-multi-agent-obvs --event-type PreToolUse --server-url http://localhost:4000/events"
          }
        ]
      }
    ]
  }
}
```

**Agent Identification:**
- `source_app`: Uniquely identifies the application (e.g., "cc-hooks-observability")
- `session_id`: Auto-generated by Claude Code for each session
- Display format: `source_app:session_id` (session truncated to 8 chars)

### Database Configuration

**Location:** `apps/server/events.db`

**WAL Mode Settings** (in `apps/server/src/db.ts`):
```sql
PRAGMA journal_mode = WAL;        -- Write-Ahead Logging for concurrency
PRAGMA synchronous = NORMAL;      -- Balance speed and safety
```

**Auto-Migration:** Schema is created automatically on first startup. No manual migration required.

---

## Database Operations

### Schema Overview

**Events Table:**
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_app TEXT NOT NULL,
  session_id TEXT NOT NULL,
  hook_event_type TEXT NOT NULL,
  payload TEXT NOT NULL,              -- JSON
  chat TEXT,                           -- JSON array
  summary TEXT,                        -- AI-generated summary
  timestamp INTEGER NOT NULL,          -- Unix milliseconds
  humanInTheLoop TEXT,                 -- JSON HITL metadata
  humanInTheLoopStatus TEXT,           -- JSON status tracking
  model_name TEXT
);

-- Indexes
CREATE INDEX idx_source_app ON events(source_app);
CREATE INDEX idx_session_id ON events(session_id);
CREATE INDEX idx_hook_event_type ON events(hook_event_type);
CREATE INDEX idx_timestamp ON events(timestamp);
```

**Themes Table:** Stores UI theme definitions
**Theme Shares Table:** Manages theme sharing tokens
**Theme Ratings Table:** Tracks user ratings for themes

### Backup Procedures

#### Method 1: JSON Export (Recommended)

```bash
# Export all events as JSON
curl "http://localhost:4000/events/recent?limit=100000" > backup_$(date +%Y%m%d_%H%M%S).json

# Export with filters
curl "http://localhost:4000/events/recent?limit=10000&source_app=my-app" > my_app_backup.json
```

**Advantages:**
- Human-readable
- Can be version controlled
- Easy to import into other systems
- Selective backup by filters

#### Method 2: SQLite File Copy

```bash
# Stop server first
./scripts/reset-system.sh

# Copy database file
cp apps/server/events.db apps/server/events.db.backup.$(date +%Y%m%d_%H%M%S)

# Copy WAL files if mid-transaction
cp apps/server/events.db-wal apps/server/events.db-wal.backup
cp apps/server/events.db-shm apps/server/events.db-shm.backup

# Restart
./scripts/start-system.sh
```

**Advantages:**
- Complete database copy
- Includes all tables (events, themes, etc.)
- Fast

#### Method 3: SQLite Dump

```bash
# Requires sqlite3 CLI
sqlite3 apps/server/events.db .dump > backup.sql
```

### Restore Procedures

#### From JSON Export

```bash
# POST each event back to running server
cat backup.json | jq -c '.[]' | while read event; do
  curl -X POST http://localhost:4000/events \
    -H "Content-Type: application/json" \
    -d "$event"
done
```

#### From SQLite File

```bash
# Stop server
./scripts/reset-system.sh

# Restore file
cp events.db.backup.20251222_120000 apps/server/events.db

# Clean WAL files
rm -f apps/server/events.db-wal apps/server/events.db-shm

# Restart
./scripts/start-system.sh
```

#### From SQL Dump

```bash
# Stop server
./scripts/reset-system.sh

# Remove existing database
rm -f apps/server/events.db*

# Import dump
sqlite3 apps/server/events.db < backup.sql

# Restart
./scripts/start-system.sh
```

### Database Maintenance

#### WAL Checkpoint (Merge WAL into Main DB)

```bash
# While server is running
sqlite3 apps/server/events.db "PRAGMA wal_checkpoint(FULL);"
```

#### Database Size Monitoring

```bash
# Check database file sizes
du -h apps/server/events.db*

# Example output:
# 45M  apps/server/events.db
# 2.1M apps/server/events.db-wal
# 32K  apps/server/events.db-shm
```

**Action Thresholds:**
- < 100MB: Normal operation
- 100-500MB: Consider archiving old events
- \> 500MB: Performance may degrade, archive recommended

#### Archive Old Events

```bash
# Export events older than 30 days
CUTOFF=$(date -d '30 days ago' +%s)000  # Unix ms
curl "http://localhost:4000/events/recent?limit=100000" | \
  jq "[.[] | select(.timestamp < $CUTOFF)]" > archive_old_events.json

# Then manually delete from database if needed
# (No built-in DELETE endpoint - requires direct SQL)
```

---

## Monitoring & Health Checks

### Health Check Endpoints

| Endpoint | Expected Response | Check Frequency |
|----------|------------------|-----------------|
| `GET /events/filter-options` | JSON with 3 arrays | Every 30s |
| `GET /events/recent?limit=1` | Array with 1 event | Every 60s |
| `WS /stream` | Connection opens | On startup |

### Automated Health Checks

```bash
#!/bin/bash
# health-check.sh

# Check server HTTP
if curl -sf http://localhost:4000/events/filter-options > /dev/null; then
  echo "✅ Server HTTP OK"
else
  echo "❌ Server HTTP FAILED"
  exit 1
fi

# Check WebSocket (requires wscat: npm install -g wscat)
timeout 5 wscat -c ws://localhost:4000/stream 2>&1 | grep -q "connected" && \
  echo "✅ WebSocket OK" || echo "⚠️  WebSocket check skipped"

# Check client
if curl -sf http://localhost:5173 > /dev/null; then
  echo "✅ Client OK"
else
  echo "❌ Client FAILED"
  exit 1
fi

# Check database size
DB_SIZE=$(du -m apps/server/events.db | cut -f1)
if [ "$DB_SIZE" -gt 500 ]; then
  echo "⚠️  Database large: ${DB_SIZE}MB (consider archiving)"
elif [ "$DB_SIZE" -gt 100 ]; then
  echo "⚠️  Database growing: ${DB_SIZE}MB"
else
  echo "✅ Database size OK: ${DB_SIZE}MB"
fi
```

### Process Monitoring

```bash
# Check if server is running
ps aux | grep "bun.*server" | grep -v grep
# or
lsof -i :4000

# Check if client is running
lsof -i :5173

# Monitor CPU/Memory
ps aux | grep "bun.*server" | awk '{print "CPU:", $3"%", "MEM:", $6/1024"MB"}'
```

### WebSocket Connection Monitoring

```bash
# Count active WebSocket connections
netstat -an | grep :4000 | grep ESTABLISHED | wc -l

# Or with lsof
lsof -i :4000 | grep -c ESTABLISHED
```

### Log Monitoring

```bash
# Hook execution logs (per session)
tail -f logs/*/pre_tool_use.json

# Session logs
ls -lth logs/

# Watch for new sessions
watch -n 5 'ls -1 logs/ | wc -l'
```

### Real-time Event Monitoring

```bash
# Watch events in real-time
watch -n 1 'curl -s http://localhost:4000/events/recent?limit=5 | jq ".[].hook_event_type"'

# Monitor event rate
watch -n 5 'curl -s http://localhost:4000/events/recent?limit=100 | jq "length"'
```

---

## Troubleshooting

### Problem 1: Port Already in Use

**Symptoms:**
- Server fails to start with "EADDRINUSE" error
- startup script reports port conflict

**Root Causes:**
- Previous server process still running
- Another application using port 4000 or 5173

**Detection:**
```bash
# Find what's using the port
lsof -i :4000              # macOS
fuser -n tcp 4000          # Linux

# Check for zombie Bun processes
ps aux | grep bun
```

**Resolution:**
```bash
# Option 1: Use reset script
./scripts/reset-system.sh

# Option 2: Manual kill
kill -9 $(lsof -ti :4000)
kill -9 $(lsof -ti :5173)

# Option 3: Use different ports
SERVER_PORT=4001 CLIENT_PORT=5174 ./scripts/start-system.sh
```

**Prevention:**
- Always use reset script before restarting
- Add cleanup to CI/CD pipelines

---

### Problem 2: WebSocket Disconnects Frequently

**Symptoms:**
- "WebSocket disconnected" in browser console
- Events stop flowing to UI
- Auto-reconnect messages every 3 seconds

**Root Causes:**
- Server crashed or restarted
- Network connectivity issues
- Client memory leak causing disconnect
- Reverse proxy timeout (if deployed)

**Detection:**
```bash
# Check if server is still running
curl http://localhost:4000/events/filter-options

# Check WebSocket connections
netstat -an | grep :4000 | grep ESTABLISHED

# Monitor server logs for crashes
# (check terminal where server is running)
```

**Resolution:**
```bash
# Option 1: Restart server
./scripts/reset-system.sh && ./scripts/start-system.sh

# Option 2: Clear browser cache
# Browser DevTools → Application → Clear storage

# Option 3: Check for server errors
cd apps/server && bun run dev  # Watch for error messages
```

**Auto-Recovery:**
- Client automatically reconnects every 3 seconds
- No manual intervention needed if server is healthy

---

### Problem 3: Hook Events Not Appearing

**Symptoms:**
- Claude Code running, but no events in dashboard
- Dashboard shows zero events
- Hooks appear to execute but nothing in database

**Root Causes:**
1. Relative paths in `.claude/settings.json` (path resolution issues)
2. Server not running or unreachable
3. Python/uv not installed
4. Network connectivity to localhost:4000
5. Hook stdin parsing errors

**Detection:**
```bash
# Test hook manually
echo '{"session_id":"test","tool_name":"Bash","tool_input":{"command":"ls"}}' | \
  uv run .claude/hooks/send_event.py \
    --source-app test \
    --event-type PreToolUse \
    --server-url http://localhost:4000/events

# Check if event appeared
curl http://localhost:4000/events/recent?limit=1 | jq

# Verify uv is installed
uv --version

# Check Python availability
python3 --version
```

**Resolution:**

**Issue: Relative Paths**
```bash
# In Claude Code, run:
/convert_paths_absolute

# This converts:
# .claude/hooks/send_event.py
# To:
# /full/path/to/project/.claude/hooks/send_event.py
```

**Issue: Server Unreachable**
```bash
# Verify server is running
curl http://localhost:4000/events/filter-options

# If not running:
./scripts/start-system.sh
```

**Issue: Dependencies**
```bash
# Install uv (if missing)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Test hook dependencies
cd .claude/hooks
uv run send_event.py --help
```

**Prevention:**
- Always use absolute paths in production
- Add health check before Claude Code session starts
- Document installation prerequisites

---

### Problem 4: Database Locks / Corruption

**Symptoms:**
- "database is locked" errors in server logs
- Events fail to save
- Server becomes unresponsive
- Slow query performance

**Root Causes:**
- Multiple processes accessing database simultaneously
- Improper WAL cleanup
- Long-running transactions
- Disk I/O issues

**Detection:**
```bash
# Check WAL file sizes
ls -lh apps/server/events.db*

# Check for multiple database connections
lsof apps/server/events.db

# Verify WAL mode
sqlite3 apps/server/events.db "PRAGMA journal_mode;"
# Should output: wal
```

**Resolution:**
```bash
# Stop all services
./scripts/reset-system.sh

# Clean WAL files
rm -f apps/server/events.db-wal apps/server/events.db-shm

# Verify database integrity
sqlite3 apps/server/events.db "PRAGMA integrity_check;"
# Should output: ok

# Restart services
./scripts/start-system.sh
```

**Recovery from Corruption:**
```bash
# Dump uncorrupted data
sqlite3 apps/server/events.db ".recover" | sqlite3 events_recovered.db

# Replace corrupted database
mv apps/server/events.db apps/server/events.db.corrupted
mv events_recovered.db apps/server/events.db

# Restart
./scripts/start-system.sh
```

**Prevention:**
- WAL mode (already enabled) reduces lock contention
- Use reset script for clean shutdowns
- Regular backups via JSON export

---

### Problem 5: HITL Response Not Received by Agent

**Symptoms:**
- Agent shows timeout waiting for HITL response
- Event remains in "pending" status in dashboard
- Human response not forwarded to agent

**Root Causes:**
- Agent's WebSocket server not listening on expected port
- Port mismatch in `responseWebSocketUrl`
- Firewall blocking localhost connections
- 5-second server timeout exceeded
- Agent closed WebSocket before response sent

**Detection:**
```bash
# Check if agent listening (example port 50123)
lsof -i :50123
netstat -an | grep 50123

# Test WebSocket connection manually
wscat -c ws://localhost:50123
# Should connect successfully

# Check server logs
# Look for "[HITL]" prefixed messages in terminal
```

**Resolution:**
```bash
# Verify agent WebSocket is running
# Check Claude Code output for:
# "WebSocket server listening on ws://localhost:PORT"

# Test HITL response manually
curl -X POST http://localhost:4000/events/1/respond \
  -H "Content-Type: application/json" \
  -d '{
    "response": "Test response",
    "respondedAt": 1700000000000,
    "hookEvent": {}
  }'

# Check if response was sent (server logs)
```

**Prevention:**
- Ensure agent WebSocket starts before sending HITL request
- Use longer timeout values in HITL requests
- Test HITL flow in development before production

---

### Problem 6: High Memory Usage

**Symptoms:**
- Client becomes slow or unresponsive
- Browser tab crashes
- Server memory grows continuously

**Root Causes:**
- Event array growing indefinitely in client
- Memory leak in Vue components
- Large payloads or chat histories
- Too many WebSocket connections

**Detection:**
```bash
# Server memory usage
ps aux | grep "bun.*server" | awk '{print $6/1024 "MB"}'

# Check event count in client
# Browser DevTools → Console:
# localStorage length or component state size
```

**Resolution:**

**Client-Side:**
```bash
# Reduce event limit
# Edit apps/client/.env
VITE_MAX_EVENTS_TO_DISPLAY=100  # Default is 300

# Clear browser cache
# DevTools → Application → Clear storage
```

**Server-Side:**
```bash
# Restart server to clear memory
./scripts/reset-system.sh && ./scripts/start-system.sh

# Archive old events (reduce database size)
# See Database Operations → Archive Old Events
```

**Monitoring:**
```bash
# Watch memory growth
watch -n 5 'ps aux | grep "bun.*server" | awk "{print \$6/1024 \"MB\"}"'
```

---

## Human-in-the-Loop Operations

### HITL Request/Response Flow

```
┌──────────────┐
│ Claude Agent │ Creates WebSocket server on random port
└──────┬───────┘
       │
       │ POST /events with humanInTheLoop metadata
       ▼
┌──────────────────┐
│ Observability    │ Stores event, broadcasts to clients
│ Server           │
└──────┬───────────┘
       │
       │ WebSocket broadcast
       ▼
┌──────────────────┐
│ Dashboard Client │ Displays HITL UI (question/permission/choice)
└──────┬───────────┘
       │
       │ Human responds
       ▼
┌──────────────────┐
│ Dashboard Client │ POST /events/:id/respond
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ Observability    │ Opens WebSocket to agent's responseWebSocketUrl
│ Server           │ Sends response, waits 500ms, closes connection
└──────┬───────────┘
       │
       │ WebSocket message with response
       ▼
┌──────────────────┐
│ Claude Agent     │ Receives response, continues execution
└──────────────────┘
```

### HITL Event Structure

**Request (from Agent):**
```json
{
  "source_app": "my-app",
  "session_id": "abc123...",
  "hook_event_type": "Notification",
  "payload": {
    "message": "Need permission to proceed"
  },
  "humanInTheLoop": {
    "question": "Should I proceed with this action?",
    "responseWebSocketUrl": "ws://localhost:50123",
    "type": "permission",
    "timeout": 300,
    "requiresResponse": true
  }
}
```

**Response (from Human):**
```json
{
  "permission": true,
  "response": "Yes, proceed",
  "respondedAt": 1700000000000,
  "respondedBy": "operator@example.com",
  "hookEvent": { /* original event */ }
}
```

**HITL Types:**
- `permission`: Yes/No approval (e.g., "Deploy to production?")
- `question`: Free-text response (e.g., "What should be the timeout value?")
- `choice`: Multiple choice selection (e.g., "Which environment: dev, staging, prod?")

### Testing HITL Locally

```bash
# Terminal 1: Start observability system
./scripts/start-system.sh

# Terminal 2: Simulate agent creating HITL request
# 1. Start a WebSocket server (using wscat)
wscat -l 50123

# 2. POST HITL event to observability server
curl -X POST http://localhost:4000/events \
  -H "Content-Type: application/json" \
  -d '{
    "source_app": "test",
    "session_id": "hitl-test",
    "hook_event_type": "Notification",
    "payload": {"action": "deploy"},
    "humanInTheLoop": {
      "question": "Approve deployment?",
      "responseWebSocketUrl": "ws://localhost:50123",
      "type": "permission",
      "timeout": 60
    }
  }'

# 3. Open dashboard at http://localhost:5173
# 4. Respond to HITL request in UI
# 5. Observe response in wscat terminal (Terminal 2)
```

### HITL Timeout Configuration

**Server Timeout:** 5 seconds (hardcoded in `apps/server/src/index.ts:83`)

**Agent Timeout:** Specified in HITL request `timeout` field (seconds)

**Handling Timeouts:**
- Server attempts WebSocket connection for up to 5 seconds
- If agent unreachable, response POST still succeeds (returns 200)
- Error logged but doesn't fail the request
- Agent should implement its own timeout handling

### Common HITL Issues

**Issue: Response Never Reaches Agent**

**Cause:** Agent WebSocket closed before response sent

**Solution:**
- Ensure agent keeps WebSocket open for at least 60 seconds
- Implement reconnection logic in agent
- Use longer timeout values (300 seconds recommended)

**Issue: Multiple HITL Requests Conflicting**

**Cause:** Same agent port used for multiple HITL requests

**Solution:**
- Generate new random port for each HITL request
- Use port range 50000-60000 to avoid conflicts
- Implement port availability checking in agent

---

## API Reference

### Event Ingestion

**Endpoint:** `POST /events`

**Request Body:**
```json
{
  "source_app": "string",           // Required: Agent identifier
  "session_id": "string",           // Required: Session UUID
  "hook_event_type": "string",      // Required: PreToolUse, PostToolUse, etc.
  "payload": {},                    // Required: Event data (object)
  "timestamp": 1700000000000,       // Optional: Unix ms (auto-set if omitted)
  "chat": [],                       // Optional: Conversation history
  "summary": "string",              // Optional: AI-generated summary
  "model_name": "string",           // Optional: Claude model used
  "humanInTheLoop": {               // Optional: HITL metadata
    "question": "string",
    "responseWebSocketUrl": "ws://...",
    "type": "permission|question|choice",
    "choices": [],                  // For type: choice
    "timeout": 300
  }
}
```

**Response:** 200 OK
```json
{
  "id": 123,
  "source_app": "...",
  "session_id": "...",
  "timestamp": 1700000000000,
  ...
}
```

**Error Responses:**
- `400 Bad Request`: Missing required fields (source_app, session_id, hook_event_type, payload)
- `500 Internal Server Error`: Database or server error

---

### Event Retrieval

**Endpoint:** `GET /events/recent`

**Query Parameters:**
- `limit` (optional): Number of events to return (default: 300)
- `offset` (optional): Skip first N events (default: 0)

**Example:**
```bash
curl "http://localhost:4000/events/recent?limit=10&offset=0"
```

**Response:** 200 OK
```json
[
  {
    "id": 123,
    "source_app": "cc-hooks",
    "session_id": "abc123...",
    "hook_event_type": "PreToolUse",
    "payload": {...},
    "timestamp": 1700000000000
  },
  ...
]
```

**Notes:**
- Events returned in reverse chronological order (newest first)
- Maximum effective limit: All events in database
- No authentication required

---

### Filter Options

**Endpoint:** `GET /events/filter-options`

**Response:** 200 OK
```json
{
  "source_apps": ["app1", "app2", "app3"],
  "session_ids": ["session1", "session2"],
  "hook_event_types": ["PreToolUse", "PostToolUse", "Stop"]
}
```

**Purpose:** Returns distinct values for filtering in UI

**Use Case:**
```bash
# Get all available filters
curl http://localhost:4000/events/filter-options | jq
```

---

### HITL Response Submission

**Endpoint:** `POST /events/:id/respond`

**Request Body:**
```json
{
  "response": "string",             // For type: question
  "permission": true,               // For type: permission
  "choice": "option1",              // For type: choice
  "respondedAt": 1700000000000,     // Unix ms
  "respondedBy": "user@example.com", // Optional
  "hookEvent": {}                   // Original event (for reference)
}
```

**Response:** 200 OK (updated event with HITL status)

**Server Actions:**
1. Updates event `humanInTheLoopStatus` to "responded"
2. Opens WebSocket connection to agent's `responseWebSocketUrl`
3. Sends response JSON via WebSocket
4. Waits 500ms, then closes connection
5. Broadcasts updated event to all clients

**Error Responses:**
- `404 Not Found`: Event ID doesn't exist
- `400 Bad Request`: Invalid response format
- `500 Internal Server Error`: Failed to connect to agent WebSocket

---

### WebSocket Stream

**Endpoint:** `ws://localhost:4000/stream`

**Connection Flow:**
1. Client connects to WebSocket
2. Server sends 300 most recent events (type: "initial")
3. Server broadcasts new events as they arrive (type: "event")

**Message Format:**
```json
{
  "type": "initial",
  "data": [
    { "id": 1, "source_app": "...", ... },
    ...
  ]
}

{
  "type": "event",
  "data": { "id": 123, "source_app": "...", ... }
}
```

**Client Implementation:**
```javascript
const ws = new WebSocket('ws://localhost:4000/stream');

ws.onopen = () => console.log('Connected');

ws.onmessage = (message) => {
  const { type, data } = JSON.parse(message.data);
  if (type === 'initial') {
    // data is array of recent events
    console.log('Received initial events:', data.length);
  } else if (type === 'event') {
    // data is single new event
    console.log('New event:', data);
  }
};

ws.onerror = (error) => console.error('WebSocket error:', error);

ws.onclose = () => {
  console.log('Disconnected, reconnecting in 3s...');
  setTimeout(() => connect(), 3000);
};
```

**Auto-Reconnection:**
- Client should implement reconnection logic
- Recommended: Exponential backoff starting at 3 seconds
- Server doesn't send missed events (clients receive latest 300 on reconnect)

---

### Theme Management (Brief)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/themes` | Create new theme |
| GET | `/api/themes` | Search themes |
| GET | `/api/themes/:id` | Get specific theme |
| PUT | `/api/themes/:id` | Update theme |
| DELETE | `/api/themes/:id` | Delete theme |
| GET | `/api/themes/:id/export` | Export as JSON |
| POST | `/api/themes/import` | Import theme |

**Note:** See server source code for complete theme API documentation.

---

## Operational Metrics

### Key Performance Indicators

| Metric | Healthy | Warning | Critical | Check Command |
|--------|---------|---------|----------|---------------|
| **Server Response Time** | <50ms | 50-200ms | >200ms | `time curl -s http://localhost:4000/events/filter-options` |
| **WebSocket Latency** | <100ms | 100-500ms | >500ms | Browser DevTools → Network → WS |
| **Event Ingestion Rate** | 1-100/min | 100-500/min | >500/min | `watch -n 60 'curl -s http://localhost:4000/events/recent?limit=1000 | jq length'` |
| **Database Size** | <100MB | 100-500MB | >500MB | `du -m apps/server/events.db | cut -f1` |
| **Connected Clients** | 1-10 | 10-20 | >20 | `netstat -an | grep :4000 | grep ESTABLISHED | wc -l` |
| **HITL Response Time** | 2-30s | 30-60s | >60s | Manual observation |
| **Server CPU** | <20% | 20-50% | >50% | `ps aux | grep bun | awk '{print $3}'` |
| **Server Memory** | <200MB | 200-500MB | >500MB | `ps aux | grep bun | awk '{print $6/1024}'` |

### Monitoring Dashboard (Simple)

```bash
#!/bin/bash
# monitor.sh - Simple monitoring script

while true; do
  clear
  echo "=== Observability Server Monitoring ==="
  echo "Time: $(date)"
  echo ""

  # Server status
  if curl -sf http://localhost:4000/events/filter-options > /dev/null; then
    echo "✅ Server: Running"
  else
    echo "❌ Server: Down"
  fi

  # Event count
  EVENT_COUNT=$(curl -s http://localhost:4000/events/recent?limit=10000 | jq 'length')
  echo "📊 Total Events: $EVENT_COUNT"

  # Database size
  DB_SIZE=$(du -m apps/server/events.db 2>/dev/null | cut -f1)
  echo "💾 Database Size: ${DB_SIZE}MB"

  # Connections
  CONN_COUNT=$(netstat -an 2>/dev/null | grep :4000 | grep ESTABLISHED | wc -l)
  echo "🔌 Active Connections: $CONN_COUNT"

  # Server process
  SERVER_PID=$(lsof -ti :4000 2>/dev/null)
  if [ -n "$SERVER_PID" ]; then
    CPU_MEM=$(ps aux | grep $SERVER_PID | grep -v grep | awk '{print "CPU: "$3"% MEM: "$6/1024"MB"}')
    echo "⚙️  Server Resources: $CPU_MEM"
  fi

  echo ""
  echo "Press Ctrl+C to exit"
  sleep 5
done
```

### Alert Thresholds

**High Priority Alerts:**
- Server down for >1 minute
- Database size >500MB
- CPU >80% for >5 minutes
- Memory >1GB

**Medium Priority Alerts:**
- Event ingestion stopped for >10 minutes
- WebSocket disconnects >5 times/minute
- Database size >200MB
- Response time >500ms

**Low Priority Alerts:**
- Event rate >100/min (may indicate chatty agent)
- >10 connected clients (verify legitimate)

### Monitoring Tools Integration

**Prometheus Metrics (Future Enhancement):**
```
# Example metrics to expose:
observability_events_total
observability_events_per_minute
observability_database_size_bytes
observability_websocket_connections
observability_http_request_duration_seconds
```

**Log Aggregation:**
- Hook logs: `logs/*/pre_tool_use.json`
- Server logs: Terminal output (consider redirecting to file)
- Client logs: Browser console (consider error reporting service)

---

## Security & Best Practices

### Hook Security

**Dangerous Command Blocking** (in `.claude/hooks/pre_tool_use.py`):

**Blocked Patterns:**
```python
# Dangerous rm patterns
rm -rf /
rm -rf ~
rm -rf /home/*
rm -rf *
rm -rf .

# Exceptions (allowed)
rm -rf trees/  # For worktree cleanup
```

**Exit Codes:**
- `0`: Allow operation (command is safe)
- `2`: Block operation (command is dangerous)
- Other: Non-blocking error

**Environment File Protection:**
```python
# Currently commented out, uncomment to enable:
if tool_name == "Read" and ".env" in file_path:
    sys.exit(2)  # Block reading .env files
```

### Database Security

**File Permissions:**
```bash
# Set appropriate permissions
chmod 600 apps/server/events.db
chmod 600 apps/server/events.db-wal
chmod 600 apps/server/events.db-shm

# Ensure only owner can read/write
ls -l apps/server/events.db*
# Should show: -rw------- 1 user user
```

**Backup Encryption:**
```bash
# Encrypt backups if they contain sensitive data
gpg --encrypt --recipient [email protected] backup.json
```

### CORS Configuration

**Current Settings** (in `apps/server/src/index.ts`):
```typescript
headers.set("Access-Control-Allow-Origin", "*");
headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
headers.set("Access-Control-Allow-Headers", "Content-Type");
```

**⚠️ Security Note:**
- Current configuration allows all origins (`*`)
- Safe for localhost development
- For production deployment, restrict to specific origins:
  ```typescript
  headers.set("Access-Control-Allow-Origin", "https://dashboard.example.com");
  ```

### Environment Variable Management

**Sensitive Variables:**
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `ELEVENLABS_API_KEY`

**Best Practices:**
1. Never commit `.env` files to version control
2. Use `.env.sample` as template
3. Rotate API keys regularly
4. Use different keys for dev/staging/production
5. Consider using secret management services (HashiCorp Vault, AWS Secrets Manager)

**Verification:**
```bash
# Ensure .env is in .gitignore
cat .gitignore | grep "\.env"

# Check if .env is tracked by git
git ls-files | grep "\.env"
# Should return nothing
```

### Log File Privacy

**Log Locations:**
- Hook logs: `logs/{session_id}/`
- Contains: Tool inputs, outputs, chat transcripts

**Privacy Considerations:**
- Logs may contain sensitive data (API keys, credentials, PII)
- Add `logs/` to `.gitignore`
- Implement log rotation/cleanup
- Redact sensitive data before sharing logs

**Cleanup:**
```bash
# Remove old logs (older than 30 days)
find logs/ -type f -mtime +30 -delete

# Remove all logs
rm -rf logs/*
```

### Network Security

**Localhost Binding:**
- Server binds to `0.0.0.0` (all interfaces) by default
- For production, bind to specific interface:
  ```typescript
  // In apps/server/src/index.ts
  hostname: "127.0.0.1",  // localhost only
  ```

**Firewall Rules:**
```bash
# Allow only local connections (example for iptables)
iptables -A INPUT -p tcp --dport 4000 -s 127.0.0.1 -j ACCEPT
iptables -A INPUT -p tcp --dport 4000 -j DROP
```

### Best Practices Checklist

**Deployment:**
- [ ] Use HTTPS for production (reverse proxy: nginx, Caddy)
- [ ] Restrict CORS origins
- [ ] Bind to localhost or internal network only
- [ ] Enable firewall rules
- [ ] Use environment-specific `.env` files
- [ ] Implement API authentication (if exposing publicly)

**Operations:**
- [ ] Regular database backups (daily)
- [ ] Monitor disk space
- [ ] Set up log rotation
- [ ] Monitor for suspicious hook patterns
- [ ] Review and update blocked command list
- [ ] Test disaster recovery procedures

**Development:**
- [ ] Never commit API keys
- [ ] Use `.env.sample` for documentation
- [ ] Test with production-like data volumes
- [ ] Document custom hooks
- [ ] Version control `.claude/settings.json`

---

## Integration Guide

### Adding Observability to New Projects

#### Quick Integration (5 Minutes)

```bash
# 1. Copy .claude directory to your project
cp -R /path/to/observability-system/.claude /path/to/your/project/

# 2. Update source app identifier
# Edit /path/to/your/project/.claude/settings.json
# Find all instances of "cc-hook-multi-agent-obvs"
# Replace with your project name, e.g., "my-awesome-project"

# 3. Ensure observability server is running
cd /path/to/observability-system
./scripts/start-system.sh

# 4. Start Claude Code in your project
cd /path/to/your/project
claude

# 5. Verify events appearing
# Open dashboard: http://localhost:5173
# Look for source_app: "my-awesome-project"
```

#### Detailed Integration Steps

**Step 1: Install Prerequisites**
```bash
# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Verify installation
uv --version
python3 --version  # Should be 3.8+
```

**Step 2: Copy Hook Files**
```bash
# Copy entire .claude directory
cp -R .claude /path/to/your/project/

# Or copy selectively
mkdir -p /path/to/your/project/.claude/hooks
cp -R .claude/hooks/* /path/to/your/project/.claude/hooks/
cp .claude/settings.json /path/to/your/project/.claude/
```

**Step 3: Configure Settings**

**Edit:** `/path/to/your/project/.claude/settings.json`

**Update source-app in all hooks:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "uv run .claude/hooks/send_event.py --source-app YOUR_PROJECT_NAME --event-type PreToolUse --server-url http://localhost:4000/events"
          }
        ]
      }
    ],
    "PostToolUse": [...],
    "Stop": [...],
    ...
  }
}
```

**Replace:**
- `cc-hook-multi-agent-obvs` → `your-project-name`

**Naming Convention:**
- Use lowercase
- Hyphen-separated (e.g., `my-web-app`)
- Unique across all projects

**Step 4: Convert to Absolute Paths**

```bash
cd /path/to/your/project
claude  # Start Claude Code

# In Claude Code:
/convert_paths_absolute
```

**Why:** Absolute paths ensure hooks work regardless of where Claude Code runs from.

**Before:**
```json
"command": "uv run .claude/hooks/send_event.py ..."
```

**After:**
```json
"command": "uv run /full/path/to/project/.claude/hooks/send_event.py ..."
```

**Step 5: Start Observability Server**

```bash
# In observability system directory
cd /path/to/observability-system
./scripts/start-system.sh
```

**Verify:**
```bash
curl http://localhost:4000/events/filter-options
# Should return JSON with arrays
```

**Step 6: Test Integration**

```bash
# In your project directory
cd /path/to/your/project
claude

# Type any command to trigger hooks
> What files are in this directory?

# Check if events appear
curl http://localhost:4000/events/recent?limit=5 | jq
# Should show events with source_app: "your-project-name"
```

**Step 7: View in Dashboard**

```
Open: http://localhost:5173

1. Look for your project in source_app filter
2. Select it to view only your project's events
3. Verify events are appearing in real-time
```

### Advanced Configuration

#### Custom Event Server URL

If running observability server on different port:

**Edit:** `.claude/settings.json`
```json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{
        "command": "... --server-url http://localhost:CUSTOM_PORT/events"
      }]
    }]
  }
}
```

#### Enable AI Summarization

```bash
# Add API key to .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# Update hooks to use --summarize flag
# Edit .claude/settings.json:
"command": "uv run .claude/hooks/send_event.py --source-app ... --summarize"
```

**Result:** Each event gets a one-sentence AI-generated summary.

#### Selective Hook Enablement

Enable only specific hooks:

```json
{
  "hooks": {
    "PreToolUse": [/* enabled */],
    "PostToolUse": [/* enabled */],
    // Comment out others to disable:
    // "Stop": [...],
    // "Notification": [...],
  }
}
```

### Multi-Project Setup

**Scenario:** Multiple projects, one observability server

```
observability-server/  (port 4000)
├── apps/server
└── apps/client

project-1/             (source_app: "web-frontend")
└── .claude/hooks → server at localhost:4000

project-2/             (source_app: "api-backend")
└── .claude/hooks → server at localhost:4000

project-3/             (source_app: "data-pipeline")
└── .claude/hooks → server at localhost:4000
```

**Dashboard View:**
- Filter by `source_app` to view specific project
- All events stored in single database
- Each project has unique `source_app` identifier

### Worktree Support

**Scenario:** Multiple git worktrees, each with own observability instance

```bash
# Main worktree
main/               → server: 4000, client: 5173

# Worktree 1
trees/feature-a/    → server: 4010, client: 5183

# Worktree 2
trees/feature-b/    → server: 4020, client: 5193
```

**Port Pattern:**
- Server: `4000 + (worktree_offset × 10)`
- Client: `5173 + (worktree_offset × 10)`

**Configuration:**
Each worktree has its own:
- Database (`apps/server/events.db`)
- Hook configuration (`.claude/settings.json`)
- Dashboard instance

### Troubleshooting Integration

**Problem: Events not appearing**

**Check:**
```bash
# 1. Verify server is running
curl http://localhost:4000/events/filter-options

# 2. Test hook manually
echo '{"session_id":"test","tool_name":"Test","tool_input":{}}' | \
  uv run .claude/hooks/send_event.py \
    --source-app test \
    --event-type PreToolUse \
    --server-url http://localhost:4000/events

# 3. Check recent events
curl http://localhost:4000/events/recent?limit=5 | jq
```

**Problem: Hooks fail with path errors**

**Solution:** Run `/convert_paths_absolute` in Claude Code

**Problem: Multiple source_app with same name**

**Solution:** Ensure each project has unique `source_app` value

**Filter in dashboard:**
- Select specific `session_id` to view single Claude Code session
- Combine `source_app` + `session_id` filters

---

## Appendix

### Emergency Contacts

**System Owner:** DevOps Team
**On-Call:** Check team rotation schedule
**Escalation:** engineering@example.com

### Related Documentation

**Internal:**
- [System Architecture](../architecture.md)
- [Hook System Deep Dive](../../app_docs/send_event_with_model_how_to.md)
- [HITL Protocol](../../app_docs/how_human_in_the_loop_v1_works.md)
- [Database Schema](../../apps/server/src/db.ts)

**External:**
- [Bun Documentation](https://bun.sh/docs)
- [Vue 3 Documentation](https://vuejs.org/)
- [SQLite WAL Mode](https://www.sqlite.org/wal.html)
- [Claude Code Documentation](https://docs.anthropic.com/claude/docs)

### Changelog

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-12-22 | 1.0 | Initial runbook creation | Claude Code |

### Quick Command Reference

```bash
# System Management
./scripts/start-system.sh              # Start all services
./scripts/reset-system.sh              # Stop and cleanup
SERVER_PORT=4001 ./scripts/start-system.sh  # Custom port

# Health Checks
curl http://localhost:4000/events/filter-options
curl http://localhost:4000/events/recent?limit=1
wscat -c ws://localhost:4000/stream

# Database Operations
du -h apps/server/events.db*           # Check size
sqlite3 apps/server/events.db "PRAGMA integrity_check;"
curl http://localhost:4000/events/recent?limit=10000 > backup.json

# Monitoring
lsof -i :4000                          # Server process
netstat -an | grep :4000 | wc -l      # Connection count
ps aux | grep bun                      # Server resources

# Troubleshooting
./scripts/reset-system.sh && ./scripts/start-system.sh  # Full restart
rm -f apps/server/events.db-wal apps/server/events.db-shm  # WAL cleanup
kill -9 $(lsof -ti :4000)             # Force kill server

# Integration
cp -R .claude /path/to/project/       # Copy hooks
# Edit: Replace source-app in settings.json
/convert_paths_absolute               # In Claude Code
```

---

**End of Runbook**

For questions or issues not covered here, contact the DevOps team or file an issue in the repository.
