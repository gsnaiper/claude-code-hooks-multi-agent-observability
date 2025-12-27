#!/usr/bin/env python3
"""
Notification hook handler.
Logs notification events and optionally announces them via TTS.
"""
import json
import os
import subprocess
import random
from pathlib import Path
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult
from utils.constants import ensure_session_log_dir
from utils.dedup import is_duplicate_event

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional


def get_tts_script_path():
    """
    Determine which TTS script to use based on available API keys.
    Priority order: ElevenLabs > OpenAI > pyttsx3
    """
    # Get current script directory and construct utils/tts path
    script_dir = Path(__file__).parent.parent
    tts_dir = script_dir / "utils" / "tts"

    # Check for ElevenLabs API key (highest priority)
    if os.getenv('ELEVENLABS_API_KEY'):
        elevenlabs_script = tts_dir / "elevenlabs_tts.py"
        if elevenlabs_script.exists():
            return str(elevenlabs_script)

    # Check for OpenAI API key (second priority)
    if os.getenv('OPENAI_API_KEY'):
        openai_script = tts_dir / "openai_tts.py"
        if openai_script.exists():
            return str(openai_script)

    # Fall back to pyttsx3 (no API key required)
    pyttsx3_script = tts_dir / "pyttsx3_tts.py"
    if pyttsx3_script.exists():
        return str(pyttsx3_script)

    return None


def announce_notification():
    """Announce that the agent needs user input."""
    try:
        tts_script = get_tts_script_path()
        if not tts_script:
            return  # No TTS scripts available

        # Get engineer name if available
        engineer_name = os.getenv('ENGINEER_NAME', '').strip()

        # Create notification message with 30% chance to include name
        if engineer_name and random.random() < 0.3:
            notification_message = f"{engineer_name}, your agent needs your input"
        else:
            notification_message = "Your agent needs your input"

        # Call the TTS script with the notification message
        subprocess.run([
            "uv", "run", tts_script, notification_message
        ],
        capture_output=True,  # Suppress output
        timeout=10  # 10-second timeout
        )

    except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError):
        # Fail silently if TTS encounters issues
        pass
    except Exception:
        # Fail silently for any other errors
        pass


class NotificationHandler(SimpleHookHandler):
    """Handler for Notification events."""

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute notification handler logic.

        Args:
            input_data: JSON data containing notification details
            args: Parsed CLI arguments (includes --notify flag)

        Returns:
            HandlerResult with exit_code=0 (never blocks)
        """
        try:
            # Extract session_id
            session_id = self.get_session_id(input_data)

            # Check for duplicate event
            if is_duplicate_event(session_id, "Notification", input_data):
                return self.allow()

            # Ensure session log directory exists
            log_dir = ensure_session_log_dir(session_id)
            log_file = log_dir / 'notification.json'

            # Read existing log data or initialize empty list
            if log_file.exists():
                with open(log_file, 'r') as f:
                    try:
                        log_data = json.load(f)
                    except (json.JSONDecodeError, ValueError):
                        log_data = []
            else:
                log_data = []

            # Append new data
            log_data.append(input_data)

            # Write back to file with formatting
            with open(log_file, 'w') as f:
                json.dump(log_data, f, indent=2)

            # Announce notification via TTS only if --notify flag is set
            # Skip TTS for the generic "Claude is waiting for your input" message
            if args.notify and input_data.get('message') != 'Claude is waiting for your input':
                announce_notification()

            return self.allow()

        except json.JSONDecodeError:
            # Handle JSON decode errors gracefully
            return self.allow()
        except Exception:
            # Handle any other errors gracefully
            return self.allow()
