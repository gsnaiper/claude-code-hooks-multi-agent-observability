#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "python-dotenv",
# ]
# ///

import json
import os
import sys
import subprocess
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional

# Configuration
MAX_PROMPT_LENGTH = 50  # Adjustable: Maximum characters to display for prompt
SHOW_GIT_INFO = False  # Set to True to show git branch and status
CACHE_FILE = Path.home() / ".claude" / "cache" / "status.txt"


def get_cached_activity() -> str:
    """Read activity status from cache file."""
    try:
        if CACHE_FILE.exists():
            return CACHE_FILE.read_text().strip()[:50]
    except Exception:
        pass
    return ""


def log_status_line(input_data, status_line_output, error_message=None):
    """Log status line event to logs directory."""
    # Ensure logs directory exists
    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "status_line.json"

    # Read existing log data or initialize empty list
    if log_file.exists():
        with open(log_file, "r") as f:
            try:
                log_data = json.load(f)
            except (json.JSONDecodeError, ValueError):
                log_data = []
    else:
        log_data = []

    # Create log entry with input data and generated output
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "input_data": input_data,
        "status_line_output": status_line_output,
    }

    if error_message:
        log_entry["error"] = error_message

    # Append the log entry
    log_data.append(log_entry)

    # Write back to file with formatting
    with open(log_file, "w") as f:
        json.dump(log_data, f, indent=2)


def get_git_branch():
    """Get current git branch if in a git repository."""
    try:
        result = subprocess.run(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return None


def get_git_status():
    """Get git status indicators."""
    try:
        # Check if there are uncommitted changes
        result = subprocess.run(
            ['git', 'status', '--porcelain'],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0:
            changes = result.stdout.strip()
            if changes:
                lines = changes.split('\n')
                return f"±{len(lines)}"
    except Exception:
        pass
    return ""


def get_session_data(session_id):
    """Get session data - returns None since we use input_data directly."""
    # Session files are not needed - we get all info from stdin input_data
    return None, None


def truncate_prompt(prompt, max_length=MAX_PROMPT_LENGTH):
    """Truncate prompt to specified length."""
    # Remove newlines and excessive whitespace
    prompt = " ".join(prompt.split())

    if len(prompt) > max_length:
        return prompt[:max_length - 3] + "..."
    return prompt


def get_prompt_icon(prompt):
    """Get icon based on prompt type."""
    if prompt.startswith("/"):
        return "⚡"
    elif "?" in prompt:
        return "❓"
    elif any(
        word in prompt.lower()
        for word in ["create", "write", "add", "implement", "build"]
    ):
        return "💡"
    elif any(word in prompt.lower() for word in ["fix", "debug", "error", "issue"]):
        return "🐛"
    elif any(word in prompt.lower() for word in ["refactor", "improve", "optimize"]):
        return "♻️"
    else:
        return "💬"


def generate_status_line(input_data):
    """Generate the status line from input_data directly."""
    # Extract session ID from input data
    session_id = input_data.get("session_id", "unknown")
    short_session = session_id[:8] if len(session_id) > 8 else session_id

    # Get model name from input_data
    model_info = input_data.get("model", {})
    if isinstance(model_info, dict):
        model_name = model_info.get("display_name") or model_info.get("name", "Claude")
    else:
        model_name = str(model_info) if model_info else "Claude"

    # Get CWD for project context
    cwd = input_data.get("cwd", "")
    project_name = Path(cwd).name if cwd else "unknown"

    # Build status line components
    parts = []

    # Model name - Cyan
    parts.append(f"\033[36m[{model_name}]\033[0m")

    # Session ID - Yellow (short)
    parts.append(f"\033[33m{short_session}\033[0m")

    # Project name - Green
    if project_name and project_name != "unknown":
        parts.append(f"\033[32m📁 {project_name}\033[0m")

    # Git branch (optional)
    if SHOW_GIT_INFO:
        git_branch = get_git_branch()
        if git_branch:
            git_status = get_git_status()
            git_info = f"🌿 {git_branch}"
            if git_status:
                git_info += f" {git_status}"
            parts.append(f"\033[32m{git_info}\033[0m")

    # Join with separator
    status_line = " | ".join(parts)

    # Activity from cache on separate line
    activity = get_cached_activity()
    if activity:
        icon = get_prompt_icon(activity)
        status_line += f"\n\033[35m{icon} {activity}\033[0m"  # Magenta on new line

    return status_line


def main():
    try:
        # Read JSON input from stdin
        input_data = json.loads(sys.stdin.read())

        # Generate status line
        status_line = generate_status_line(input_data)

        # Log the status line event (without error since it's successful)
        log_status_line(input_data, status_line)

        # Output the status line (first line of stdout becomes the status line)
        print(status_line)

        # Success
        sys.exit(0)

    except json.JSONDecodeError:
        # Handle JSON decode errors gracefully - output basic status
        print("\033[31m[Agent] [Claude] 💭 JSON Error\033[0m")
        sys.exit(0)
    except Exception as e:
        # Handle any other errors gracefully - output basic status
        print(f"\033[31m[Agent] [Claude] 💭 Error: {str(e)}\033[0m")
        sys.exit(0)


if __name__ == "__main__":
    main()
