#!/bin/bash
#
# Setup HITL Health Check Cron Job
#
# This script helps you set up the HITL health check as a cron job
# that runs every 5 minutes with Telegram notifications.
#
# Usage:
#   bash scripts/setup-health-check-cron.sh
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}HITL Health Check - Cron Setup${NC}"
echo -e "${BLUE}============================================${NC}"
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

echo -e "${GREEN}✓ bun is installed:${NC} $(bun --version)"
echo ""

# Prompt for configuration
echo -e "${YELLOW}Configuration${NC}"
echo ""

read -p "Server URL [http://localhost:4000]: " SERVER_URL
SERVER_URL=${SERVER_URL:-http://localhost:4000}

read -p "Telegram Bot Token (optional, press Enter to skip): " BOT_TOKEN
read -p "Telegram Chat ID (optional, press Enter to skip): " CHAT_ID

echo ""

# Create wrapper script
WRAPPER_SCRIPT="/usr/local/bin/hitl-health-check.sh"
TEMP_WRAPPER="/tmp/hitl-health-check.sh"

cat > "$TEMP_WRAPPER" << EOF
#!/bin/bash
#
# HITL Health Check Wrapper
# Generated on: $(date)
#

export HITL_SERVER_URL="$SERVER_URL"
EOF

if [ -n "$BOT_TOKEN" ]; then
    cat >> "$TEMP_WRAPPER" << EOF
export TELEGRAM_BOT_TOKEN="$BOT_TOKEN"
EOF
fi

if [ -n "$CHAT_ID" ]; then
    cat >> "$TEMP_WRAPPER" << EOF
export TELEGRAM_CHAT_ID="$CHAT_ID"
EOF
fi

cat >> "$TEMP_WRAPPER" << EOF

cd "$PROJECT_DIR"
bun scripts/hitl-health-check.ts
EOF

chmod +x "$TEMP_WRAPPER"

echo -e "${GREEN}Wrapper script created${NC}"
echo ""

# Install wrapper script
echo -e "${YELLOW}Installing wrapper script...${NC}"
if [ -w "/usr/local/bin" ]; then
    cp "$TEMP_WRAPPER" "$WRAPPER_SCRIPT"
    echo -e "${GREEN}✓ Installed to $WRAPPER_SCRIPT${NC}"
else
    echo -e "${YELLOW}Need sudo to install to /usr/local/bin${NC}"
    sudo cp "$TEMP_WRAPPER" "$WRAPPER_SCRIPT"
    echo -e "${GREEN}✓ Installed to $WRAPPER_SCRIPT${NC}"
fi
echo ""

# Create log directory
LOG_DIR="/var/log/hitl"
echo -e "${YELLOW}Creating log directory...${NC}"
if [ -w "/var/log" ]; then
    mkdir -p "$LOG_DIR"
    echo -e "${GREEN}✓ Log directory: $LOG_DIR${NC}"
else
    echo -e "${YELLOW}Need sudo to create /var/log/hitl${NC}"
    sudo mkdir -p "$LOG_DIR"
    sudo chown $(whoami):$(whoami) "$LOG_DIR"
    echo -e "${GREEN}✓ Log directory: $LOG_DIR${NC}"
fi
echo ""

# Cron job entry
CRON_ENTRY="*/5 * * * * $WRAPPER_SCRIPT >> $LOG_DIR/health-check.log 2>&1"

echo -e "${YELLOW}Cron job configuration:${NC}"
echo "$CRON_ENTRY"
echo ""

# Ask if user wants to install cron job
read -p "Install this cron job? (y/n): " INSTALL_CRON

if [ "$INSTALL_CRON" = "y" ] || [ "$INSTALL_CRON" = "Y" ]; then
    # Check if cron job already exists
    if crontab -l 2>/dev/null | grep -q "hitl-health-check.sh"; then
        echo -e "${YELLOW}Warning: Cron job already exists${NC}"
        read -p "Replace existing cron job? (y/n): " REPLACE_CRON

        if [ "$REPLACE_CRON" = "y" ] || [ "$REPLACE_CRON" = "Y" ]; then
            # Remove old entry and add new one
            (crontab -l 2>/dev/null | grep -v "hitl-health-check.sh"; echo "$CRON_ENTRY") | crontab -
            echo -e "${GREEN}✓ Cron job updated${NC}"
        else
            echo -e "${YELLOW}Keeping existing cron job${NC}"
        fi
    else
        # Add new cron job
        (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
        echo -e "${GREEN}✓ Cron job installed${NC}"
    fi
else
    echo -e "${YELLOW}Skipped cron job installation${NC}"
    echo ""
    echo "To install manually, run:"
    echo "  crontab -e"
    echo ""
    echo "Then add this line:"
    echo "  $CRON_ENTRY"
fi

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${GREEN}Setup complete!${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

echo "The health check will run every 5 minutes."
echo ""
echo "Useful commands:"
echo "  - View logs: tail -f $LOG_DIR/health-check.log"
echo "  - Test now: $WRAPPER_SCRIPT"
echo "  - Edit cron: crontab -e"
echo "  - View cron: crontab -l"
echo ""

# Test the health check once
read -p "Run health check now? (y/n): " RUN_NOW

if [ "$RUN_NOW" = "y" ] || [ "$RUN_NOW" = "Y" ]; then
    echo ""
    echo -e "${YELLOW}Running health check...${NC}"
    echo ""
    $WRAPPER_SCRIPT || true
fi

echo ""
echo -e "${GREEN}Done!${NC}"
