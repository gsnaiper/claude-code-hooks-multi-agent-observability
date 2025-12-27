from .base import SimpleHookHandler, HandlerResult
from typing import Dict, Any
import json
import os
import subprocess
from pathlib import Path
from datetime import datetime

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional


class SubagentStopHandler(SimpleHookHandler):
    """Handler for subagent stop events with transcript logging and TTS announcements."""

    def get_tts_script_path(self):
        """
        Determine which TTS script to use based on available API keys.
        Priority order: ElevenLabs > OpenAI > pyttsx3
        """
        # Get hooks directory and construct utils/tts path
        hooks_dir = Path(__file__).parent.parent
        tts_dir = hooks_dir / "utils" / "tts"

        # Check for ElevenLabs API key (highest priority)
        if os.getenv("ELEVENLABS_API_KEY"):
            elevenlabs_script = tts_dir / "elevenlabs_tts.py"
            if elevenlabs_script.exists():
                return str(elevenlabs_script)

        # Check for OpenAI API key (second priority)
        if os.getenv("OPENAI_API_KEY"):
            openai_script = tts_dir / "openai_tts.py"
            if openai_script.exists():
                return str(openai_script)

        # Fall back to pyttsx3 (no API key required)
        pyttsx3_script = tts_dir / "pyttsx3_tts.py"
        if pyttsx3_script.exists():
            return str(pyttsx3_script)

        return None

    def announce_subagent_completion(self):
        """Announce subagent completion using the best available TTS service."""
        try:
            tts_script = self.get_tts_script_path()
            if not tts_script:
                return  # No TTS scripts available

            # Use fixed message for subagent completion
            completion_message = "Subagent Complete"

            # Call the TTS script with the completion message
            subprocess.run(
                ["uv", "run", tts_script, completion_message],
                capture_output=True,  # Suppress output
                timeout=10,  # 10-second timeout
            )

        except (subprocess.TimeoutExpired, subprocess.SubprocessError, FileNotFoundError):
            # Fail silently if TTS encounters issues
            pass
        except Exception:
            # Fail silently for any other errors
            pass

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute subagent stop hook logic:
        1. Log the stop event
        2. Handle transcript copying if --chat is provided
        3. Announce completion via TTS if --notify is provided
        """
        try:
            # Extract required fields
            session_id = input_data.get("session_id", "")
            stop_hook_active = input_data.get("stop_hook_active", False)

            # Ensure session log directory exists
            from utils.constants import ensure_session_log_dir
            log_dir = ensure_session_log_dir(session_id)
            log_path = log_dir / "subagent_stop.json"

            # Read existing log data or initialize empty list
            if log_path.exists():
                with open(log_path, "r") as f:
                    try:
                        log_data = json.load(f)
                    except (json.JSONDecodeError, ValueError):
                        log_data = []
            else:
                log_data = []

            # Append new data
            log_data.append(input_data)

            # Write back to file with formatting
            with open(log_path, "w") as f:
                json.dump(log_data, f, indent=2)

            # Handle --chat switch (same as stop.py)
            if hasattr(args, 'chat') and args.chat and "transcript_path" in input_data:
                transcript_path = input_data["transcript_path"]
                if os.path.exists(transcript_path):
                    # Read .jsonl file and convert to JSON array
                    chat_data = []
                    try:
                        with open(transcript_path, "r") as f:
                            for line in f:
                                line = line.strip()
                                if line:
                                    try:
                                        chat_data.append(json.loads(line))
                                    except json.JSONDecodeError:
                                        pass  # Skip invalid lines

                        # Write to logs/chat.json
                        chat_file = os.path.join(log_dir, "chat.json")
                        with open(chat_file, "w") as f:
                            json.dump(chat_data, f, indent=2)
                    except Exception:
                        pass  # Fail silently

            # Handle TTS notification
            if hasattr(args, 'notify') and args.notify:
                # Announce subagent completion via TTS
                self.announce_subagent_completion()

            return self.allow()

        except json.JSONDecodeError:
            # Handle JSON decode errors gracefully
            return self.allow()
        except Exception:
            # Handle any other errors gracefully
            return self.allow()
