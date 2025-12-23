#!/bin/bash

# Claude Code Observability - One-Command Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/gsnaiper/claude-code-hooks-multi-agent-observability/main/install.sh | bash

set -e

REPO_URL="https://github.com/gsnaiper/claude-code-hooks-multi-agent-observability"
REPO_BRANCH="main"
INSTALL_DIR="$HOME/.claude"
TEMP_DIR=$(mktemp -d)
VERSION="1.0.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Cleanup on exit
cleanup() {
    rm -rf "$TEMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Banner
show_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║   Claude Code Observability Installer v${VERSION}      ║"
    echo "║   Multi-Agent Monitoring with Auto Project ID     ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Step 1: Detect OS
detect_os() {
    log_step "Detecting operating system..."

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if grep -qi microsoft /proc/version 2>/dev/null; then
            OS="wsl"
            log_info "Detected: Windows Subsystem for Linux (WSL)"
        else
            OS="linux"
            log_info "Detected: Linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        log_info "Detected: macOS"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        OS="windows"
        log_info "Detected: Windows (Git Bash/MSYS)"
    else
        log_error "Unsupported OS: $OSTYPE"
        exit 1
    fi
}

# Step 2: Check dependencies
check_dependencies() {
    log_step "Checking dependencies..."

    local missing_deps=()

    # Check git
    if ! command -v git &> /dev/null; then
        missing_deps+=("git")
    fi

    # Check curl
    if ! command -v curl &> /dev/null; then
        missing_deps+=("curl")
    fi

    # Check uv (Python)
    if ! command -v uv &> /dev/null; then
        log_warn "uv not found. Installing uv..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
        if ! command -v uv &> /dev/null; then
            log_error "Failed to install uv"
            missing_deps+=("uv")
        else
            log_info "uv installed successfully"
        fi
    fi

    # Check bun
    if ! command -v bun &> /dev/null; then
        log_warn "bun not found. Installing bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
        if ! command -v bun &> /dev/null; then
            log_error "Failed to install bun"
            missing_deps+=("bun")
        else
            log_info "bun installed successfully"
        fi
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        log_info "Please install missing dependencies and re-run installer."
        exit 1
    fi

    log_info "All dependencies satisfied"
}

# Step 3: Clone repository
clone_repo() {
    log_step "Downloading observability system..."

    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$TEMP_DIR/repo" 2>/dev/null || {
        log_error "Failed to clone repository"
        exit 1
    }

    log_info "Repository downloaded successfully"
}

# Step 4: Install hooks
install_hooks() {
    log_step "Installing user-level hooks to $INSTALL_DIR/hooks/..."

    mkdir -p "$INSTALL_DIR/hooks/lib"
    mkdir -p "$INSTALL_DIR/hooks/utils"

    # Copy hook scripts
    cp "$TEMP_DIR/repo/.claude/hooks/send_event.py" "$INSTALL_DIR/hooks/"
    cp "$TEMP_DIR/repo/.claude/hooks/lib/get_project_id.py" "$INSTALL_DIR/hooks/lib/"

    # Copy utils if they exist
    if [ -d "$TEMP_DIR/repo/.claude/hooks/utils" ]; then
        cp -r "$TEMP_DIR/repo/.claude/hooks/utils/"* "$INSTALL_DIR/hooks/utils/" 2>/dev/null || true
    fi

    # Make scripts executable
    chmod +x "$INSTALL_DIR/hooks/send_event.py"
    chmod +x "$INSTALL_DIR/hooks/lib/get_project_id.py"

    log_info "Hook scripts installed"
}

# Step 5: Install user settings
install_settings() {
    log_step "Configuring user-level settings..."

    if [ -f "$INSTALL_DIR/settings.json" ]; then
        log_warn "$INSTALL_DIR/settings.json already exists"
        log_warn "Creating backup at $INSTALL_DIR/settings.json.backup"
        cp "$INSTALL_DIR/settings.json" "$INSTALL_DIR/settings.json.backup"
    fi

    # Copy template and replace ~ with actual home directory
    sed "s|~/.claude|$INSTALL_DIR|g" "$TEMP_DIR/repo/templates/user-settings.json" > "$INSTALL_DIR/settings.json"

    log_info "User settings configured"
}

# Step 6: Install server
install_server() {
    log_step "Installing observability server to $INSTALL_DIR/observability/..."

    mkdir -p "$INSTALL_DIR/observability"
    mkdir -p "$INSTALL_DIR/logs"

    # Copy server and client
    cp -r "$TEMP_DIR/repo/apps/server" "$INSTALL_DIR/observability/"
    cp -r "$TEMP_DIR/repo/apps/client" "$INSTALL_DIR/observability/"

    # Install server dependencies
    log_info "Installing server dependencies..."
    cd "$INSTALL_DIR/observability/server"
    # Remove old lockfile to avoid WSL file system issues
    rm -f bun.lockb 2>/dev/null || true
    bun install --no-save 2>/dev/null || bun install

    # Install and build client
    log_info "Building client dashboard..."
    cd "$INSTALL_DIR/observability/client"
    rm -f bun.lockb 2>/dev/null || true
    bun install --no-save 2>/dev/null || bun install
    bun run build 2>/dev/null || log_warn "Client build skipped (dev mode)"

    log_info "Server installed"
}

# Step 7: Install service (OS-specific)
install_service() {
    log_step "Configuring auto-start service..."

    case $OS in
        linux)
            install_systemd_service
            ;;
        wsl)
            log_warn "WSL detected - skipping auto-start service"
            log_info "Start server manually with: cd ~/.claude/observability/server && bun run dev"
            ;;
        macos)
            install_launchd_service
            ;;
        windows)
            log_warn "Windows detected - run PowerShell script for service installation"
            log_info "Run: PowerShell -ExecutionPolicy Bypass -File $INSTALL_DIR/services/windows/install-service.ps1"
            ;;
    esac
}

install_systemd_service() {
    mkdir -p "$HOME/.config/systemd/user"

    # Create service file with actual paths
    cat > "$HOME/.config/systemd/user/claude-observability.service" <<EOF
[Unit]
Description=Claude Code Observability Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR/observability/server
ExecStart=$(which bun) run src/index.ts
Restart=on-failure
RestartSec=10
Environment="NODE_ENV=production"
Environment="PORT=4000"

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable claude-observability.service
    systemctl --user start claude-observability.service 2>/dev/null || log_warn "Failed to start service (may need relogin)"

    log_info "Systemd service installed"
}

install_launchd_service() {
    mkdir -p "$HOME/Library/LaunchAgents"
    mkdir -p "$INSTALL_DIR/logs"

    BUN_PATH=$(which bun)

    cat > "$HOME/Library/LaunchAgents/com.claude.observability.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude.observability</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BUN_PATH</string>
        <string>run</string>
        <string>src/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR/observability/server</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$INSTALL_DIR/logs/observability.log</string>
    <key>StandardErrorPath</key>
    <string>$INSTALL_DIR/logs/observability.error.log</string>
</dict>
</plist>
EOF

    launchctl load "$HOME/Library/LaunchAgents/com.claude.observability.plist" 2>/dev/null || log_warn "Failed to load LaunchAgent"

    log_info "LaunchAgent installed"
}

# Step 8: Verify installation
verify_installation() {
    log_step "Verifying installation..."

    # Wait for server to start
    sleep 3

    # Test server connection
    if curl -sf http://localhost:4000/health &> /dev/null; then
        log_info "Server is running at http://localhost:4000"
    else
        log_warn "Server health check failed - may need manual start"
    fi

    # Test project ID generation
    if [ -f "$INSTALL_DIR/hooks/lib/get_project_id.py" ]; then
        PROJECT_ID=$(python3 "$INSTALL_DIR/hooks/lib/get_project_id.py" "$(pwd)" 2>/dev/null | grep "Project ID:" | cut -d: -f2- | tr -d ' ')
        if [ -n "$PROJECT_ID" ]; then
            log_info "Project ID detection working: $PROJECT_ID"
        fi
    fi
}

# Step 9: Show success message
show_success_message() {
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          Installation Complete!                    ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}Components installed:${NC}"
    echo "  • User-level hooks:     $INSTALL_DIR/hooks/"
    echo "  • Observability server: $INSTALL_DIR/observability/"
    echo "  • User settings:        $INSTALL_DIR/settings.json"
    echo ""
    echo -e "${CYAN}Server:${NC}"
    echo "  • API:       http://localhost:4000"
    echo "  • Dashboard: http://localhost:4000 (or port 5173 for dev)"
    echo ""
    echo -e "${CYAN}Features:${NC}"
    echo "  • Hooks work in ANY project automatically"
    echo "  • Unique project IDs via git remote or directory hash"
    echo "  • Manual override: create .claude/project-id file"
    echo ""

    if [ "$OS" = "wsl" ]; then
        echo -e "${YELLOW}WSL Note:${NC}"
        echo "  Start server manually: cd ~/.claude/observability/server && bun run dev"
        echo ""
    fi

    echo -e "${GREEN}Ready to go! Open a new Claude Code session to start tracking.${NC}"
    echo ""
}

# Main installation flow
main() {
    show_banner
    detect_os
    check_dependencies
    clone_repo
    install_hooks
    install_settings
    install_server
    install_service
    verify_installation
    show_success_message
}

main
