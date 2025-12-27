# HITL Health Check - Quick Start Guide

## Quick Test

Run the health check immediately to test your server:

```bash
# Console output
bun scripts/hitl-health-check.ts

# JSON output
bun scripts/hitl-health-check.ts --json

# Without Telegram notifications
bun scripts/hitl-health-check.ts --no-telegram
```

## Setup Options

### Option 1: Cron (Recommended for most systems)

```bash
# Interactive setup
bash scripts/setup-health-check-cron.sh
```

This will:
- Create a wrapper script at `/usr/local/bin/hitl-health-check.sh`
- Configure Telegram notifications (optional)
- Install a cron job to run every 5 minutes
- Create log directory at `/var/log/hitl`

### Option 2: SystemD Timer (Recommended for production)

```bash
# Interactive setup
bash scripts/setup-health-check-systemd.sh
```

This will:
- Create systemd service and timer files
- Configure environment variables
- Enable and start the timer
- Set up journald logging

## Configuration

### Environment Variables

Create a `.env` file:

```bash
cp scripts/.env.example scripts/.env
# Edit with your values
```

Or set environment variables:

```bash
export HITL_SERVER_URL="https://hooks.di4.dev"
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="your-chat-id"
```

### Get Telegram Credentials

1. **Bot Token**: Talk to [@BotFather](https://t.me/BotFather)
   - Send `/newbot`
   - Follow instructions
   - Copy the token

2. **Chat ID**:
   - Send a message to your bot
   - Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   - Find `"chat":{"id":123456789}`

## Health Checks Performed

1. ✅ **Server Health** - Checks `/health` endpoint
2. ✅ **Database Connection** - Verifies events can be fetched
3. ✅ **HITL Metrics** - Counts pending requests
4. ✅ **Smoke Test** - Creates and retrieves test event
5. ✅ **Stale Requests** - Detects requests > 5 minutes old
6. ✅ **WebSocket** - Tests WebSocket connectivity

## Monitoring

### Cron Logs

```bash
# View logs
tail -f /var/log/hitl/health-check.log

# View recent errors
grep "FAIL" /var/log/hitl/health-check.log
```

### SystemD Logs

```bash
# View live logs
sudo journalctl -u hitl-health-check.service -f

# View recent runs
sudo journalctl -u hitl-health-check.service -n 50

# View timer status
sudo systemctl status hitl-health-check.timer
```

## Troubleshooting

### Server unreachable

```bash
# Test server manually
curl http://localhost:4000/health

# Check if server is running
ps aux | grep bun

# Check firewall
sudo ufw status
```

### WebSocket fails

```bash
# Test WebSocket manually
wscat -c ws://localhost:4000/stream

# Check reverse proxy config (nginx/traefik)
```

### Telegram not working

```bash
# Test bot token
curl https://api.telegram.org/bot<TOKEN>/getMe

# Test sending message
curl -X POST https://api.telegram.org/bot<TOKEN>/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":"<CHAT_ID>","text":"Test"}'
```

## Common Commands

```bash
# Cron
crontab -l                          # List cron jobs
crontab -e                          # Edit cron jobs
/usr/local/bin/hitl-health-check.sh # Run manually

# SystemD
sudo systemctl start hitl-health-check.service    # Run now
sudo systemctl status hitl-health-check.timer     # Check timer
sudo systemctl stop hitl-health-check.timer       # Stop timer
sudo systemctl disable hitl-health-check.timer    # Disable timer
systemctl list-timers                             # List all timers
```

## Customization

Edit `scripts/hitl-health-check.ts` to:

- Change stale request threshold (default: 5 minutes)
- Add custom health checks
- Modify notification format
- Adjust timeout values

## More Information

See [README-HEALTH-CHECK.md](./README-HEALTH-CHECK.md) for:
- Detailed configuration options
- Integration examples (Prometheus, Grafana, CI/CD)
- Advanced troubleshooting
- Custom check examples
