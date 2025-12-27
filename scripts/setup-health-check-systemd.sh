#!/bin/bash
#
# Setup HITL Health Check SystemD Timer
#
# This script helps you set up the HITL health check as a systemd timer
# that runs every 5 minutes with Telegram notifications.
#
# Usage:
#   bash scripts/setup-health-check-systemd.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}HITL Health Check - SystemD Setup${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check if systemd is available
if ! command -v systemctl &> /dev/null; then
    echo -e "${RED}Error: systemd is not available${NC}"
    echo "This system does not use systemd."
    echo "Use the cron setup script instead: bash scripts/setup-health-check-cron.sh"
    exit 1
fi

echo -e "${GREEN}✓ systemd is available${NC}"
echo ""

# Get project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo -e "${GREEN}Project directory:${NC} $PROJECT_DIR"
echo ""

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: bun is not installed${NC}"
    echo "Please install bun first: https://bun.sh"
    exit 1
fi

BUN_PATH=$(which bun)
echo -e "${GREEN}✓ bun is installed:${NC} $(bun --version)"
echo -e "${GREEN}  bun path:${NC} $BUN_PATH"
echo ""

# Prompt for configuration
echo -e "${YELLOW}Configuration${NC}"
echo ""

read -p "Server URL [http://localhost:4000]: " SERVER_URL
SERVER_URL=${SERVER_URL:-http://localhost:4000}

read -p "Telegram Bot Token (optional, press Enter to skip): " BOT_TOKEN
read -p "Telegram Chat ID (optional, press Enter to skip): " CHAT_ID

read -p "User to run service [$USER]: " SERVICE_USER
SERVICE_USER=${SERVICE_USER:-$USER}

read -p "Group to run service [$USER]: " SERVICE_GROUP
SERVICE_GROUP=${SERVICE_GROUP:-$USER}

echo ""

# Create environment file
ENV_FILE="/etc/hitl-health-check.env"
TEMP_ENV="/tmp/hitl-health-check.env"

cat > "$TEMP_ENV" << EOF
# HITL Health Check Environment
# Generated on: $(date)

HITL_SERVER_URL=$SERVER_URL
EOF

if [ -n "$BOT_TOKEN" ]; then
    cat >> "$TEMP_ENV" << EOF
TELEGRAM_BOT_TOKEN=$BOT_TOKEN
EOF
fi

if [ -n "$CHAT_ID" ]; then
    cat >> "$TEMP_ENV" << EOF
TELEGRAM_CHAT_ID=$CHAT_ID
EOF
fi

echo -e "${YELLOW}Installing environment file...${NC}"
sudo cp "$TEMP_ENV" "$ENV_FILE"
sudo chmod 600 "$ENV_FILE"
echo -e "${GREEN}✓ Environment file: $ENV_FILE${NC}"
echo ""

# Create service file
SERVICE_FILE="/tmp/hitl-health-check.service"

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=HITL Health Check Service
After=network.target
Documentation=https://github.com/your-org/claude-code-hooks-multi-agent-observability

[Service]
Type=oneshot
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$PROJECT_DIR

# Load environment variables
EnvironmentFile=$ENV_FILE

# Execute health check
ExecStart=$BUN_PATH scripts/hitl-health-check.ts

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=hitl-health-check

# Security hardening
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo -e "${YELLOW}Installing service file...${NC}"
sudo cp "$SERVICE_FILE" /etc/systemd/system/hitl-health-check.service
echo -e "${GREEN}✓ Service file: /etc/systemd/system/hitl-health-check.service${NC}"
echo ""

# Create timer file
TIMER_FILE="/tmp/hitl-health-check.timer"

cat > "$TIMER_FILE" << EOF
[Unit]
Description=HITL Health Check Timer
Documentation=https://github.com/your-org/claude-code-hooks-multi-agent-observability

[Timer]
# Run 5 minutes after boot
OnBootSec=5min

# Run every 5 minutes
OnUnitActiveSec=5min

# Make sure timer survives reboots
Persistent=true

# Randomize start time by up to 30 seconds
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
EOF

echo -e "${YELLOW}Installing timer file...${NC}"
sudo cp "$TIMER_FILE" /etc/systemd/system/hitl-health-check.timer
echo -e "${GREEN}✓ Timer file: /etc/systemd/system/hitl-health-check.timer${NC}"
echo ""

# Reload systemd
echo -e "${YELLOW}Reloading systemd...${NC}"
sudo systemctl daemon-reload
echo -e "${GREEN}✓ systemd reloaded${NC}"
echo ""

# Enable and start timer
read -p "Enable and start the timer now? (y/n): " START_TIMER

if [ "$START_TIMER" = "y" ] || [ "$START_TIMER" = "Y" ]; then
    echo -e "${YELLOW}Enabling timer...${NC}"
    sudo systemctl enable hitl-health-check.timer
    echo -e "${GREEN}✓ Timer enabled${NC}"

    echo -e "${YELLOW}Starting timer...${NC}"
    sudo systemctl start hitl-health-check.timer
    echo -e "${GREEN}✓ Timer started${NC}"
    echo ""

    # Show status
    echo -e "${YELLOW}Timer status:${NC}"
    sudo systemctl status hitl-health-check.timer --no-pager
    echo ""
else
    echo -e "${YELLOW}Skipped timer activation${NC}"
    echo ""
    echo "To enable and start manually:"
    echo "  sudo systemctl enable hitl-health-check.timer"
    echo "  sudo systemctl start hitl-health-check.timer"
    echo ""
fi

echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

echo "The health check will run every 5 minutes."
echo ""
echo "Useful commands:"
echo "  - View logs: sudo journalctl -u hitl-health-check.service -f"
echo "  - View timer: sudo systemctl status hitl-health-check.timer"
echo "  - Test now: sudo systemctl start hitl-health-check.service"
echo "  - Stop timer: sudo systemctl stop hitl-health-check.timer"
echo "  - Disable timer: sudo systemctl disable hitl-health-check.timer"
echo "  - List all timers: systemctl list-timers"
echo ""

# Test the health check once
read -p "Run health check now? (y/n): " RUN_NOW

if [ "$RUN_NOW" = "y" ] || [ "$RUN_NOW" = "Y" ]; then
    echo ""
    echo -e "${YELLOW}Running health check...${NC}"
    echo ""
    sudo systemctl start hitl-health-check.service
    sleep 2
    echo ""
    echo -e "${YELLOW}Service logs:${NC}"
    sudo journalctl -u hitl-health-check.service -n 50 --no-pager
fi

echo ""
echo -e "${GREEN}Done!${NC}"
