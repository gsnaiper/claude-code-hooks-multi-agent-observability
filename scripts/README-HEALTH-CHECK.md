# HITL Health Check Script

Automated health monitoring script for the HITL (Human-in-the-Loop) observability server.

## Overview

The `hitl-health-check.ts` script performs comprehensive health checks on the observability server and can be run as a cron job for continuous monitoring.

## Features

### Health Checks Performed

1. **Server Health** - Verifies server is running via `/health` endpoint
2. **Database Connection** - Tests database accessibility by fetching events
3. **HITL Metrics** - Monitors pending HITL request count
4. **Smoke Test** - Creates and retrieves a test event to verify end-to-end flow
5. **Stale Requests** - Detects HITL requests pending for > 5 minutes
6. **WebSocket Endpoint** - Validates WebSocket connectivity

### Output Formats

- **Console** (default) - Color-coded, human-readable output with emojis
- **JSON** - Machine-readable format for parsing/integration

### Notifications

- Sends Telegram alerts when checks fail
- Gracefully handles missing Telegram configuration
- Customizable notification format

## Usage

### Basic Usage

```bash
# Run with console output
bun scripts/hitl-health-check.ts

# Run with JSON output
bun scripts/hitl-health-check.ts --json

# Run without Telegram notifications
bun scripts/hitl-health-check.ts --no-telegram
```

### Configuration

Set environment variables:

```bash
# Server URL (default: http://localhost:4000)
export HITL_SERVER_URL="https://hooks.di4.dev"

# Telegram configuration (optional)
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

### Exit Codes

- `0` - All checks passed
- `1` - One or more checks failed

## Cron Job Setup

### Run every 5 minutes

```bash
# Edit crontab
crontab -e

# Add this line
*/5 * * * * cd /path/to/project && bun scripts/hitl-health-check.ts >> /var/log/hitl-health.log 2>&1
```

### Run every 5 minutes with Telegram alerts

```bash
# Create a wrapper script
cat > /usr/local/bin/hitl-health-check.sh << 'EOF'
#!/bin/bash
export HITL_SERVER_URL="https://hooks.di4.dev"
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"

cd /path/to/project
bun scripts/hitl-health-check.ts
EOF

chmod +x /usr/local/bin/hitl-health-check.sh

# Add to crontab
*/5 * * * * /usr/local/bin/hitl-health-check.sh >> /var/log/hitl-health.log 2>&1
```

### SystemD Timer (Alternative to Cron)

Create `/etc/systemd/system/hitl-health-check.service`:

```ini
[Unit]
Description=HITL Health Check
After=network.target

[Service]
Type=oneshot
User=your-user
WorkingDirectory=/path/to/project
Environment="HITL_SERVER_URL=https://hooks.di4.dev"
Environment="TELEGRAM_BOT_TOKEN=your-bot-token"
Environment="TELEGRAM_CHAT_ID=your-chat-id"
ExecStart=/usr/bin/bun scripts/hitl-health-check.ts
StandardOutput=journal
StandardError=journal
```

Create `/etc/systemd/system/hitl-health-check.timer`:

```ini
[Unit]
Description=HITL Health Check Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hitl-health-check.timer
sudo systemctl start hitl-health-check.timer

# Check status
sudo systemctl status hitl-health-check.timer
sudo journalctl -u hitl-health-check.service -f
```

## Example Output

### Console Output (Success)

```
============================================================
HITL Health Check
============================================================
Server: http://localhost:4000
Time: 2025-12-27T10:30:00.000Z

Running checks...

✅ Server Health: Server running (uptime: 12345s)
   (123ms)
✅ Database Connection: Database accessible
   (45ms)
✅ HITL Metrics: 3 pending HITL requests
   (67ms)
✅ Smoke Test: Event creation and retrieval working
   (234ms)
✅ Stale Requests: No stale pending requests found
   (89ms)
✅ WebSocket Endpoint: WebSocket endpoint accessible
   (156ms)

============================================================
Summary
============================================================
Total: 6
Passed: 6
Failed: 0
Skipped: 0

🟢 Overall Status: PASS
```

### Console Output (Failure)

```
============================================================
HITL Health Check
============================================================
Server: http://localhost:4000
Time: 2025-12-27T10:35:00.000Z

Running checks...

❌ Server Health: Server unreachable
   (5001ms)
❌ Database Connection: Database query failed (500)
   (234ms)
❌ HITL Metrics: Failed to fetch events (500)
   (123ms)
❌ Smoke Test: Failed to create test event (500)
   (456ms)
❌ Stale Requests: Failed to check for stale requests
   (234ms)
❌ WebSocket Endpoint: WebSocket connection failed
   (5002ms)

============================================================
Summary
============================================================
Total: 6
Passed: 0
Failed: 6
Skipped: 0

🔴 Overall Status: FAIL

Sending Telegram notification...
✅ Telegram notification sent
```

### JSON Output

```json
{
  "timestamp": 1735297800000,
  "overallStatus": "pass",
  "checks": [
    {
      "name": "Server Health",
      "status": "pass",
      "message": "Server running (uptime: 12345s)",
      "details": {
        "status": "ok",
        "timestamp": 1735297800000,
        "uptime": 12345
      },
      "duration": 123
    },
    {
      "name": "Database Connection",
      "status": "pass",
      "message": "Database accessible",
      "details": {
        "eventCount": 1
      },
      "duration": 45
    }
  ],
  "summary": {
    "total": 6,
    "passed": 6,
    "failed": 0,
    "skipped": 0
  }
}
```

### Telegram Notification (Failure)

```
🔴 HITL Health Check FAILED

❌ Server Health
   Server unreachable

❌ Database Connection
   Database query failed (500)

❌ HITL Metrics
   Failed to fetch events (500)

❌ Smoke Test
   Failed to create test event (500)

❌ Stale Requests
   Failed to check for stale requests

❌ WebSocket Endpoint
   WebSocket connection failed

Summary: 0/6 checks passed
⚠️ Action Required: Investigate failed checks

Timestamp: 2025-12-27T10:35:00.000Z
```

## Integration Examples

### Monitoring with Prometheus

Export metrics to Prometheus using a wrapper script:

```bash
#!/bin/bash
# /usr/local/bin/hitl-health-to-prometheus.sh

RESULT=$(bun scripts/hitl-health-check.ts --json --no-telegram)
STATUS=$?

# Parse JSON and export metrics
echo "# HELP hitl_health_status Overall health status (1=pass, 0=fail)"
echo "# TYPE hitl_health_status gauge"
echo "hitl_health_status $([[ $STATUS -eq 0 ]] && echo 1 || echo 0)"

echo "# HELP hitl_health_checks_total Total number of checks"
echo "# TYPE hitl_health_checks_total gauge"
echo "hitl_health_checks_total $(echo $RESULT | jq '.summary.total')"

echo "# HELP hitl_health_checks_passed Number of passed checks"
echo "# TYPE hitl_health_checks_passed gauge"
echo "hitl_health_checks_passed $(echo $RESULT | jq '.summary.passed')"

echo "# HELP hitl_health_checks_failed Number of failed checks"
echo "# TYPE hitl_health_checks_failed gauge"
echo "hitl_health_checks_failed $(echo $RESULT | jq '.summary.failed')"
```

### Alerting with Grafana

Use the Prometheus metrics above with Grafana alerting rules.

### CI/CD Integration

```yaml
# .github/workflows/health-check.yml
name: HITL Health Check

on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - name: Run Health Check
        env:
          HITL_SERVER_URL: ${{ secrets.HITL_SERVER_URL }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: bun scripts/hitl-health-check.ts
```

## Troubleshooting

### Check fails with "Server unreachable"

- Verify server is running: `curl http://localhost:4000/health`
- Check firewall rules
- Verify `HITL_SERVER_URL` is correct

### WebSocket check fails

- Ensure WebSocket endpoint is enabled
- Check if reverse proxy (nginx, traefik) supports WebSocket upgrade
- Verify no firewall blocking WebSocket connections

### Telegram notifications not sent

- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
- Test manually: `curl https://api.telegram.org/bot<TOKEN>/getMe`
- Check bot has permission to send messages to chat

### Stale requests detected

- Check HITL timeout configuration
- Verify WebSocket response URLs are correct
- Investigate why responses aren't being received

## Advanced Configuration

### Custom Thresholds

Edit the script to customize thresholds:

```typescript
// Change stale request threshold (default: 5 minutes)
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Change timeout for HTTP requests (default: 5 seconds)
signal: AbortSignal.timeout(10000) // 10 seconds
```

### Add Custom Checks

Add your own health checks to the main function:

```typescript
async function checkCustomService(): Promise<CheckResult> {
  const start = Date.now();
  try {
    // Your custom check logic
    return {
      name: 'Custom Service',
      status: 'pass',
      message: 'Service is healthy',
      duration: Date.now() - start
    };
  } catch (error) {
    return {
      name: 'Custom Service',
      status: 'fail',
      message: 'Service check failed',
      details: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start
    };
  }
}

// Add to main()
checks.push(await checkCustomService());
```

## License

MIT
