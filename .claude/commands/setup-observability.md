---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebFetch
description: Install and configure Claude Code observability system with automatic project ID detection
model: sonnet
---

# Setup Observability

Install the Claude Code observability system with:
- User-level hooks that work in ALL projects
- Automatic unique project ID detection (git-based or directory hash)
- Background server with real-time dashboard

## Installation Steps

1. **Detect Environment**
   - Check OS (Linux/macOS/Windows WSL)
   - Verify dependencies (git, uv, bun)

2. **Install User-Level Hooks**
   - Copy hook scripts to ~/.claude/hooks/
   - Configure ~/.claude/settings.json

3. **Install Observability Server**
   - Clone server and client to ~/.claude/observability/
   - Install dependencies and build client

4. **Configure Auto-Start**
   - Linux: systemd user service
   - macOS: LaunchAgent
   - Windows: NSSM or scheduled task

5. **Verify Installation**
   - Test server connectivity
   - Test project ID detection

## Quick Install

Run the one-command installer:

```bash
curl -fsSL https://raw.githubusercontent.com/gsnaiper/claude-code-hooks-multi-agent-observability/main/install.sh | bash
```

## Manual Steps

If the installer doesn't work, follow these manual steps:

### Step 1: Clone Repository
```bash
git clone https://github.com/gsnaiper/claude-code-hooks-multi-agent-observability.git /tmp/observability
```

### Step 2: Install Hooks
```bash
mkdir -p ~/.claude/hooks/lib
cp /tmp/observability/.claude/hooks/send_event.py ~/.claude/hooks/
cp /tmp/observability/.claude/hooks/lib/get_project_id.py ~/.claude/hooks/lib/
chmod +x ~/.claude/hooks/send_event.py
```

### Step 3: Install Settings
```bash
cp /tmp/observability/templates/user-settings.json ~/.claude/settings.json
# Edit paths if needed: sed -i 's|~/.claude|'$HOME'/.claude|g' ~/.claude/settings.json
```

### Step 4: Install Server
```bash
mkdir -p ~/.claude/observability
cp -r /tmp/observability/apps/server ~/.claude/observability/
cp -r /tmp/observability/apps/client ~/.claude/observability/
cd ~/.claude/observability/server && bun install
cd ~/.claude/observability/client && bun install && bun run build
```

### Step 5: Start Server
```bash
cd ~/.claude/observability/server && bun run dev
```

## Verify Installation

Test project ID detection:
```bash
python3 ~/.claude/hooks/lib/get_project_id.py
```

Test hook manually:
```bash
echo '{"session_id":"test"}' | uv run ~/.claude/hooks/send_event.py --auto-project-id --event-type PreToolUse
```

Check server:
```bash
curl http://localhost:4000/events/recent?limit=1
```

## Dashboard

Access the observability dashboard at: http://localhost:4000 (or http://localhost:5173 in dev mode)

## Troubleshooting

- **Server not starting**: Check if port 4000 is in use
- **Hooks not firing**: Restart Claude Code session
- **WSL connectivity**: The hooks use PowerShell fallback automatically
- **Project ID wrong**: Create `.claude/project-id` file with custom ID
