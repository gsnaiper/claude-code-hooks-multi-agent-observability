#!/usr/bin/env python3
"""
PreCompact hook handler.
Logs pre-compact events and optionally backs up transcripts.
"""
import json
import os
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult


class PreCompactHandler(SimpleHookHandler):
    """Handler for pre_compact hook events."""

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute pre-compact logic:
        - Log the pre-compact event
        - Create transcript backup if requested
        - Provide verbose feedback
        """
        # Extract fields from input data
        session_id = input_data.get('session_id', 'unknown')
        transcript_path = input_data.get('transcript_path', '')
        trigger = input_data.get('trigger', 'unknown')  # "manual" or "auto"
        custom_instructions = input_data.get('custom_instructions', '')

        # Log the pre-compact event
        self._log_pre_compact(input_data)

        # Create backup if requested
        backup_path = None
        if args.backup and transcript_path:
            backup_path = self._backup_transcript(transcript_path, trigger)

        # Provide feedback based on trigger type
        if args.verbose:
            if trigger == "manual":
                message = f"Preparing for manual compaction (session: {session_id[:8]}...)"
                if custom_instructions:
                    message += f"\nCustom instructions: {custom_instructions[:100]}..."
            else:  # auto
                message = f"Auto-compaction triggered due to full context window (session: {session_id[:8]}...)"

            if backup_path:
                message += f"\nTranscript backed up to: {backup_path}"

            print(message)

        # Set send_event_options with add_chat=True
        self.set_send_event_options(add_chat=True)

        # Return success - allow compaction to proceed
        return self.allow()

    def _log_pre_compact(self, input_data: Dict[str, Any]):
        """Log pre-compact event to logs directory."""
        # Ensure logs directory exists
        log_dir = Path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / 'pre_compact.json'

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

    def _backup_transcript(self, transcript_path: str, trigger: str) -> str:
        """Create a backup of the transcript before compaction."""
        try:
            if not os.path.exists(transcript_path):
                return None

            # Create backup directory
            backup_dir = Path("logs") / "transcript_backups"
            backup_dir.mkdir(parents=True, exist_ok=True)

            # Generate backup filename with timestamp and trigger type
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            session_name = Path(transcript_path).stem
            backup_name = f"{session_name}_pre_compact_{trigger}_{timestamp}.jsonl"
            backup_path = backup_dir / backup_name

            # Copy transcript to backup
            shutil.copy2(transcript_path, backup_path)

            return str(backup_path)
        except Exception:
            return None
