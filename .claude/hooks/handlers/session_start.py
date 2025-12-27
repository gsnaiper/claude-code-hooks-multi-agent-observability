#!/usr/bin/env python3
"""
SessionStart hook handler.
Manages session initialization, context loading, and git status reporting.
"""
import json
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult


class SessionStartHandler(SimpleHookHandler):
    """Handler for session_start hook events."""

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute session start logic.

        Args:
            input_data: JSON data containing session_id, source, etc.
            args: Parsed CLI arguments (load_context, announce)

        Returns:
            HandlerResult with exit_code=0 and optional context
        """
        # Extract fields
        session_id = input_data.get('session_id', 'unknown')
        source = input_data.get('source', 'unknown')  # "startup", "resume", or "clear"

        # Log the session start event
        self.log_event(input_data)

        # Load development context if requested
        if args.load_context:
            context = self._load_development_context(source)
            if context:
                # Return with additional context
                output = {
                    "hookSpecificOutput": {
                        "hookEventName": "SessionStart",
                        "additionalContext": context
                    }
                }
                return HandlerResult(exit_code=0, output=output)

        # Announce session start if requested
        if args.announce:
            self._announce_session_start(source)

        # Success
        return self.allow()

    def log_event(self, input_data: Dict[str, Any]):
        """Log session start event to logs directory."""
        # Ensure logs directory exists
        log_dir = Path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / 'session_start.json'

        # Read existing log data or initialize empty list
        if log_file.exists():
            with open(log_file, 'r') as f:
                try:
                    log_data = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    log_data = []
        else:
            log_data = []

        # Append the entire input data
        log_data.append(input_data)

        # Write back to file with formatting
        with open(log_file, 'w') as f:
            json.dump(log_data, f, indent=2)

    def _get_git_status(self):
        """Get current git status information."""
        try:
            # Get current branch
            branch_result = subprocess.run(
                ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                capture_output=True,
                text=True,
                timeout=5
            )
            current_branch = branch_result.stdout.strip() if branch_result.returncode == 0 else "unknown"

            # Get uncommitted changes count
            status_result = subprocess.run(
                ['git', 'status', '--porcelain'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if status_result.returncode == 0:
                changes = status_result.stdout.strip().split('\n') if status_result.stdout.strip() else []
                uncommitted_count = len(changes)
            else:
                uncommitted_count = 0

            return current_branch, uncommitted_count
        except Exception:
            return None, None

    def _get_recent_issues(self):
        """Get recent GitHub issues if gh CLI is available."""
        try:
            # Check if gh is available
            gh_check = subprocess.run(['which', 'gh'], capture_output=True)
            if gh_check.returncode != 0:
                return None

            # Get recent open issues
            result = subprocess.run(
                ['gh', 'issue', 'list', '--limit', '5', '--state', 'open'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def _load_development_context(self, source: str) -> str:
        """Load relevant development context based on session source."""
        context_parts = []

        # Add timestamp
        context_parts.append(f"Session started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        context_parts.append(f"Session source: {source}")

        # Add git information
        branch, changes = self._get_git_status()
        if branch:
            context_parts.append(f"Git branch: {branch}")
            if changes > 0:
                context_parts.append(f"Uncommitted changes: {changes} files")

        # Load project-specific context files if they exist
        context_files = [
            ".claude/CONTEXT.md",
            ".claude/TODO.md",
            "TODO.md",
            ".github/ISSUE_TEMPLATE.md"
        ]

        for file_path in context_files:
            if Path(file_path).exists():
                try:
                    with open(file_path, 'r') as f:
                        content = f.read().strip()
                        if content:
                            context_parts.append(f"\n--- Content from {file_path} ---")
                            context_parts.append(content[:1000])  # Limit to first 1000 chars
                except Exception:
                    pass

        # Add recent issues if available
        issues = self._get_recent_issues()
        if issues:
            context_parts.append("\n--- Recent GitHub Issues ---")
            context_parts.append(issues)

        return "\n".join(context_parts)

    def _announce_session_start(self, source: str):
        """Announce session start via TTS if available."""
        try:
            # Try to use TTS to announce session start
            script_dir = Path(__file__).parent.parent
            tts_script = script_dir / "utils" / "tts" / "pyttsx3_tts.py"

            if tts_script.exists():
                messages = {
                    "startup": "Claude Code session started",
                    "resume": "Resuming previous session",
                    "clear": "Starting fresh session"
                }
                message = messages.get(source, "Session started")

                subprocess.run(
                    ["uv", "run", str(tts_script), message],
                    capture_output=True,
                    timeout=5
                )
        except Exception:
            pass
