#!/usr/bin/env python3
"""
PostToolUse handler for unified hooks router.
Handles session logging and HITL response handling for tool executions.
"""
import json
import sys
from pathlib import Path
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult

# Import utilities from parent hooks directory
import os
parent_dir = Path(__file__).parent.parent
sys.path.insert(0, str(parent_dir))

from utils.constants import ensure_session_log_dir
from utils.hitl import ask_question_via_hitl
from config import is_hitl_enabled, is_decision_tool, get_timeout


class PostToolUseHandler(SimpleHookHandler):
    """
    Handler for post_tool_use hook events.

    Responsibilities:
    1. Log all tool executions to session-specific JSON files
    2. Handle HITL (Human-in-the-Loop) responses for decision tools
    3. Always returns success (exit_code=0) - never blocks
    """

    def __init__(self, event_type: str = "PostToolUse", timeout: int = 10):
        super().__init__(event_type, timeout)

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute post-tool-use logic.

        Args:
            input_data: JSON data containing session_id, tool_name, tool_input, tool_response
            args: CLI arguments (not used in this handler)

        Returns:
            HandlerResult with exit_code=0 (always allows)
        """
        try:
            # Extract session_id and tool info
            session_id = self.get_session_id(input_data)
            tool_name = self.get_tool_name(input_data)
            tool_input = self.get_tool_input(input_data)
            tool_response = input_data.get('tool_response', {})

            # Log the tool execution
            self._log_tool_execution(session_id, input_data)

            # Handle HITL for decision tools
            self._handle_hitl_decision_tools(
                session_id=session_id,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_response=tool_response,
                input_data=input_data
            )

            return self.allow()

        except json.JSONDecodeError:
            # Handle JSON decode errors gracefully
            return self.allow()
        except Exception as e:
            # Exit cleanly on any other error - never block
            print(f"[PostToolUse] Warning: {e}", file=sys.stderr)
            return self.allow()

    def _log_tool_execution(self, session_id: str, input_data: Dict[str, Any]):
        """
        Log tool execution to session-specific JSON file.

        Args:
            session_id: Current session identifier
            input_data: Complete input data to log
        """
        try:
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

        except Exception as e:
            print(f"[PostToolUse] Warning: Failed to log tool execution: {e}", file=sys.stderr)

    def _handle_hitl_decision_tools(
        self,
        session_id: str,
        tool_name: str,
        tool_input: Dict[str, Any],
        tool_response: Dict[str, Any],
        input_data: Dict[str, Any]
    ):
        """
        Handle HITL (Human-in-the-Loop) for decision tools.

        Args:
            session_id: Current session identifier
            tool_name: Name of the tool that was executed
            tool_input: Input parameters provided to the tool
            tool_response: Response from the tool
            input_data: Complete input data
        """
        # Only proceed if HITL is enabled and this is a decision tool
        if not is_hitl_enabled() or not is_decision_tool(tool_name):
            return

        try:
            timeout = get_timeout(tool_name)

            # Session data for HITL requests
            session_data = {
                'source_app': input_data.get('source_app', 'claude-code'),
                'session_id': session_id
            }

            # Handle AskUserQuestion tool
            if tool_name == 'AskUserQuestion':
                self._handle_ask_user_question(
                    tool_input=tool_input,
                    tool_response=tool_response,
                    session_data=session_data,
                    timeout=timeout
                )

        except Exception as e:
            print(f"[PostToolUse] Warning: HITL handling failed: {e}", file=sys.stderr)

    def _handle_ask_user_question(
        self,
        tool_input: Dict[str, Any],
        tool_response: Dict[str, Any],
        session_data: Dict[str, Any],
        timeout: int
    ):
        """
        Handle HITL for AskUserQuestion tool - check if user answered via external UI.

        Args:
            tool_input: Input to AskUserQuestion tool
            tool_response: Response from AskUserQuestion tool
            session_data: Session metadata
            timeout: Timeout in seconds for HITL request
        """
        questions = tool_input.get('questions', [])
        question_text = questions[0].get('question', '') if questions else 'Unknown question'

        result = ask_question_via_hitl(
            f"🤖 Claude asks:\n\n{question_text}",
            session_data,
            context={
                'tool_name': 'AskUserQuestion',
                'questions': questions,
                'original_input': tool_input,
                'tool_response': tool_response
            },
            hook_event_type='PostToolUse',
            payload={
                'tool_name': 'AskUserQuestion',
                'tool_input': tool_input,
                'tool_response': tool_response
            },
            timeout=timeout
        )

        # Log the result
        if result.answered and result.response:
            print("[HITL] PostToolUse: User response received via external UI", file=sys.stderr)
        elif result.cancelled:
            print("[HITL] PostToolUse: User cancelled the question", file=sys.stderr)
        else:
            print("[HITL] PostToolUse: No response (timeout or pending)", file=sys.stderr)
