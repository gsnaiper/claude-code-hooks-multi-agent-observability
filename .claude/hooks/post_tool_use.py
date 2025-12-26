#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = ["requests", "python-dotenv"]
# ///

import os
from pathlib import Path

# Load .env BEFORE any other imports that might use env vars
from dotenv import load_dotenv
_env_path = Path.home() / '.claude' / '.env'
if _env_path.exists():
    load_dotenv(_env_path)

import json
import sys
from utils.constants import ensure_session_log_dir
from utils.hitl import ask_question_via_hitl
from config import is_hitl_enabled, is_decision_tool, get_timeout

def main():
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)

        # Extract session_id and tool info
        session_id = input_data.get('session_id', 'unknown')
        tool_name = input_data.get('tool_name', '')
        tool_input = input_data.get('tool_input', {})
        tool_response = input_data.get('tool_response', {})

        # Ensure session log directory exists
        log_dir = ensure_session_log_dir(session_id)
        log_path = log_dir / 'post_tool_use.json'

        # Read existing log data or initialize empty list
        if log_path.exists():
            with open(log_path, 'r') as f:
                try:
                    log_data = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    log_data = []
        else:
            log_data = []

        # Append new data
        log_data.append(input_data)

        # Write back to file with formatting
        with open(log_path, 'w') as f:
            json.dump(log_data, f, indent=2)

        # ===========================================
        # HITL for Decision Tools (AskUserQuestion, etc.)
        # ===========================================
        if is_hitl_enabled() and is_decision_tool(tool_name):
            timeout = get_timeout(tool_name)

            # Session data for HITL requests
            session_data = {
                'source_app': input_data.get('source_app', 'claude-code'),
                'session_id': session_id
            }

            # AskUserQuestion - check if user answered via HITL
            if tool_name == 'AskUserQuestion':
                questions = tool_input.get('questions', [])
                question_text = questions[0].get('question', '') if questions else 'Unknown question'

                result = ask_question_via_hitl(
                    f"🤖 Claude asks:\n\n{question_text}",
                    session_data,
                    context={
                        'tool_name': tool_name,
                        'questions': questions,
                        'original_input': tool_input,
                        'tool_response': tool_response
                    },
                    hook_event_type='PostToolUse',
                    payload={'tool_name': tool_name, 'tool_input': tool_input, 'tool_response': tool_response},
                    timeout=timeout
                )

                if result.answered and result.response:
                    print(f"[HITL] PostToolUse: User response received via external UI", file=sys.stderr)
                elif result.cancelled:
                    print("[HITL] PostToolUse: User cancelled the question", file=sys.stderr)
                else:
                    print("[HITL] PostToolUse: No response (timeout or pending)", file=sys.stderr)

        sys.exit(0)
        
    except json.JSONDecodeError:
        # Handle JSON decode errors gracefully
        sys.exit(0)
    except Exception:
        # Exit cleanly on any other error
        sys.exit(0)

if __name__ == '__main__':
    main()