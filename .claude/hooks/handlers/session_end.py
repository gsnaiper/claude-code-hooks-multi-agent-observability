#!/usr/bin/env python3
"""
SessionEnd hook handler.

Logs session end events, saves session statistics, and optionally announces
session end via TTS.
"""
import json
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult


class SessionEndHandler(SimpleHookHandler):
    """Handler for session_end hook events."""

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute session end handler.

        Args:
            input_data: JSON data with session_id, reason, transcript_path, etc.
            args: Parsed CLI arguments (announce, save_stats)

        Returns:
            HandlerResult with exit_code=0
        """
        # Log the session end event
        self._log_session_end(input_data)

        # Save session statistics if requested
        if hasattr(args, 'save_stats') and args.save_stats:
            self._save_session_statistics(input_data)

        # Announce session end if requested
        if hasattr(args, 'announce') and args.announce:
            self._announce_session_end(input_data)

        return self.allow()

    def _log_session_end(self, input_data: Dict[str, Any]):
        """Log session end event to logs directory."""
        try:
            # Ensure logs directory exists
            log_dir = Path("logs")
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / 'session_end.json'

            # Read existing log data or initialize empty list
            if log_file.exists():
                with open(log_file, 'r') as f:
                    try:
                        log_data = json.load(f)
                    except (json.JSONDecodeError, ValueError):
                        log_data = []
            else:
                log_data = []

            # Append the entire input data with timestamp
            entry = {
                **input_data,
                "logged_at": datetime.now().isoformat()
            }
            log_data.append(entry)

            # Write back to file with formatting
            with open(log_file, 'w') as f:
                json.dump(log_data, f, indent=2)

        except Exception:
            pass  # Don't fail the hook on logging errors

    def _save_session_statistics(self, input_data: Dict[str, Any]):
        """Save session statistics for analytics."""
        try:
            session_id = input_data.get('session_id', 'unknown')
            reason = input_data.get('reason', 'other')
            transcript_path = input_data.get('transcript_path', '')

            # Count messages in transcript if available
            message_count = 0
            if transcript_path and Path(transcript_path).exists():
                try:
                    with open(transcript_path, 'r') as f:
                        # JSONL format - count lines
                        message_count = sum(1 for _ in f)
                except Exception:
                    pass

            # Save statistics
            stats_dir = Path("logs")
            stats_dir.mkdir(parents=True, exist_ok=True)
            stats_file = stats_dir / 'session_statistics.json'

            if stats_file.exists():
                with open(stats_file, 'r') as f:
                    try:
                        stats = json.load(f)
                    except (json.JSONDecodeError, ValueError):
                        stats = []
            else:
                stats = []

            stats.append({
                "session_id": session_id,
                "ended_at": datetime.now().isoformat(),
                "reason": reason,
                "message_count": message_count
            })

            with open(stats_file, 'w') as f:
                json.dump(stats, f, indent=2)

        except Exception:
            pass  # Don't fail the hook on stats errors

    def _announce_session_end(self, input_data: Dict[str, Any]):
        """Announce session end via TTS."""
        try:
            reason = input_data.get('reason', 'other')

            # Try to use TTS to announce session end
            script_dir = Path(__file__).parent.parent
            tts_script = script_dir / "utils" / "tts" / "pyttsx3_tts.py"

            if tts_script.exists():
                messages = {
                    "clear": "Session cleared",
                    "logout": "Logging out",
                    "prompt_input_exit": "Session ended",
                    "other": "Session ended"
                }
                message = messages.get(reason, "Session ended")

                subprocess.run(
                    ["uv", "run", str(tts_script), message],
                    capture_output=True,
                    timeout=5
                )
        except Exception:
            pass  # Don't fail the hook on TTS errors
