"""
Pre Tool Use Hook Handler

This is the MOST COMPLEX handler. It handles:
1. HITL for decision tools (AskUserQuestion, ExitPlanMode, EnterPlanMode)
2. Protected file edit approval
3. Dangerous rm command detection and blocking
4. Hints system for tool modifications
5. Session logging with file locking
"""

from .base import BaseHookHandler, HandlerResult
from typing import Dict, Any
import json
import sys
import re
import shlex
import fcntl
from pathlib import Path

# Import from parent utils
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.constants import ensure_session_log_dir
from utils.hitl import ask_approval, ask_question_via_hitl
from utils.hints import process_tool_call, create_hook_output
from config import (
    is_hitl_enabled, is_decision_tool, get_hitl_type, get_timeout,
    is_protected_file, should_require_hitl, is_hints_enabled,
    is_auto_fix_enabled, should_provide_hints
)

# Allowed directories where rm -rf is permitted
ALLOWED_RM_DIRECTORIES = [
    'trees/',
]


def is_path_in_allowed_directory(command, allowed_dirs):
    """
    Check if the rm command targets paths exclusively within allowed directories.
    Returns True if all paths in the command are within allowed directories.
    Uses shlex for proper shell parsing of quoted paths.
    """
    try:
        # Use shlex for proper shell parsing (handles quotes, escapes)
        parts = shlex.split(command)
    except ValueError:
        # Malformed command - treat as not allowed
        return False

    if not parts or parts[0] != 'rm':
        return False

    # Extract paths (skip 'rm' and any flags starting with -)
    paths = [p for p in parts[1:] if not p.startswith('-')]

    if not paths:
        return False

    # Check if all paths are within allowed directories
    for path in paths:
        # Skip if empty
        if not path:
            continue

        # Normalize path for comparison
        normalized = path.lstrip('./')

        # Check if this path is within any allowed directory
        is_allowed = False
        for allowed_dir in allowed_dirs:
            if normalized.startswith(allowed_dir) or path.startswith('./' + allowed_dir):
                is_allowed = True
                break

        # If any path is not in allowed directories, return False
        if not is_allowed:
            return False

    # All paths are within allowed directories
    return True


def is_dangerous_rm_command(command, allowed_dirs=None):
    """
    Comprehensive detection of dangerous rm commands.
    Matches various forms of rm -rf and similar destructive patterns.
    Returns False if the command targets only allowed directories.

    Args:
        command: The bash command to check
        allowed_dirs: List of directory paths where rm -rf is permitted

    Returns:
        True if the command is dangerous and should be blocked, False otherwise
    """
    if allowed_dirs is None:
        allowed_dirs = []

    # Normalize command by removing extra spaces and converting to lowercase
    normalized = ' '.join(command.lower().split())

    # Pattern 1: Standard rm -rf variations
    patterns = [
        r'\brm\s+.*-[a-z]*r[a-z]*f',  # rm -rf, rm -fr, rm -Rf, etc.
        r'\brm\s+.*-[a-z]*f[a-z]*r',  # rm -fr variations
        r'\brm\s+--recursive\s+--force',  # rm --recursive --force
        r'\brm\s+--force\s+--recursive',  # rm --force --recursive
        r'\brm\s+-r\s+.*-f',  # rm -r ... -f
        r'\brm\s+-f\s+.*-r',  # rm -f ... -r
    ]

    # Check for dangerous patterns
    is_potentially_dangerous = False
    for pattern in patterns:
        if re.search(pattern, normalized):
            is_potentially_dangerous = True
            break

    # If not found in Pattern 1, check Pattern 2
    if not is_potentially_dangerous:
        # Pattern 2: Check for rm with recursive flag targeting dangerous paths
        dangerous_paths = [
            r'/',           # Root directory
            r'/\*',         # Root with wildcard
            r'~',           # Home directory
            r'~/',          # Home directory path
            r'\$HOME',      # Home environment variable
            r'\.\.',        # Parent directory references
            r'\*',          # Wildcards in general rm -rf context
            r'\.',          # Current directory
            r'\.\s*$',      # Current directory at end of command
        ]

        if re.search(r'\brm\s+.*-[a-z]*r', normalized):  # If rm has recursive flag
            for path in dangerous_paths:
                if re.search(path, normalized):
                    is_potentially_dangerous = True
                    break

    # If not potentially dangerous at all, it's safe
    if not is_potentially_dangerous:
        return False

    # It's potentially dangerous - check if targeting only allowed directories
    if allowed_dirs and is_path_in_allowed_directory(command, allowed_dirs):
        return False  # Allowed directory, so not dangerous

    # Dangerous and not in allowed directories
    return True


def is_env_file_access(tool_name, tool_input):
    """
    Check if any tool is trying to access .env files containing sensitive data.
    """
    if tool_name in ['Read', 'Edit', 'MultiEdit', 'Write', 'Bash']:
        # Check file paths for file-based tools
        if tool_name in ['Read', 'Edit', 'MultiEdit', 'Write']:
            file_path = tool_input.get('file_path', '')
            if '.env' in file_path and not file_path.endswith('.env.sample'):
                return True

        # Check bash commands for .env file access
        elif tool_name == 'Bash':
            command = tool_input.get('command', '')
            # Pattern to detect .env file access (but allow .env.sample)
            env_patterns = [
                r'\b\.env\b(?!\.sample)',  # .env but not .env.sample
                r'cat\s+.*\.env\b(?!\.sample)',  # cat .env
                r'echo\s+.*>\s*\.env\b(?!\.sample)',  # echo > .env
                r'touch\s+.*\.env\b(?!\.sample)',  # touch .env
                r'cp\s+.*\.env\b(?!\.sample)',  # cp .env
                r'mv\s+.*\.env\b(?!\.sample)',  # mv .env
            ]

            for pattern in env_patterns:
                if re.search(pattern, command):
                    return True

    return False


class PreToolUseHandler(BaseHookHandler):
    """
    Pre Tool Use Hook Handler

    Handles:
    - HITL for decision tools (AskUserQuestion, ExitPlanMode, EnterPlanMode)
    - Protected file edit approval
    - Dangerous rm command detection and blocking
    - Hints system
    - Session logging
    """

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Main execution method - extracts all logic from pre_tool_use.py
        """
        import os

        tool_name = input_data.get('tool_name', '')
        tool_input = input_data.get('tool_input', {})

        # Session data for HITL requests
        session_data = {
            'source_app': input_data.get('source_app', 'claude-code'),
            'session_id': input_data.get('session_id', 'unknown')
        }

        # ===========================================
        # DECISION TOOLS (AskUserQuestion, ExitPlanMode, etc.)
        # ===========================================
        if is_hitl_enabled() and is_decision_tool(tool_name):
            timeout = get_timeout(tool_name)

            # AskUserQuestion - redirect question to UI with voice input
            if tool_name == 'AskUserQuestion':
                questions = tool_input.get('questions', [])
                question_text = questions[0].get('question', '') if questions else 'Unknown question'

                result = ask_question_via_hitl(
                    f"🤖 Claude asks:\n\n{question_text}",
                    session_data,
                    context={
                        'tool_name': tool_name,
                        'questions': questions,
                        'original_input': tool_input
                    },
                    hook_event_type='PreToolUse',
                    payload={'tool_name': tool_name, 'tool_input': tool_input},
                    timeout=timeout
                )

                if result.answered and result.response:
                    # User answered via external UI - block native tool and return answer
                    reason = f"User already answered via external interface. User's response: \"{result.response}\""
                    self.log_stderr("[HITL] User response received via external UI")
                    self.set_send_event_options(summarize=True)
                    return self.block(reason)
                elif result.cancelled:
                    reason = "User cancelled the question via external interface"
                    self.log_stderr("[HITL] User cancelled the question")
                    self.set_send_event_options(summarize=True)
                    return self.block(reason)
                else:
                    reason = "No response received (timeout). Please try asking the question again."
                    self.log_stderr("[HITL] Timeout - no response received")
                    self.set_send_event_options(summarize=True)
                    return self.block(reason)

            # ExitPlanMode - approve plan execution
            elif tool_name == 'ExitPlanMode':
                result = ask_approval(
                    "📋 Exit Plan Mode - Ready to execute the plan?",
                    session_data,
                    context={
                        'tool_name': tool_name,
                        'action': 'exit_plan_mode'
                    },
                    hook_event_type='PreToolUse',
                    payload={'tool_name': tool_name, 'tool_input': tool_input},
                    timeout=timeout
                )

                if result.approved:
                    comment = f" Comment: {result.comment}" if result.comment else ""
                    self.log_stderr(f"[HITL] Plan execution approved.{comment}")
                    self.set_send_event_options(summarize=True)
                    return self.allow()  # Allow - proceed with ExitPlanMode
                else:
                    reason = result.comment or "User denied plan execution"
                    self.log_stderr(f"[HITL] Plan execution denied: {reason}")
                    self.set_send_event_options(summarize=True)
                    return self.block(f"Plan execution denied via HITL: {reason}")

            # EnterPlanMode - approve entering plan mode
            elif tool_name == 'EnterPlanMode':
                result = ask_approval(
                    "📝 Enter Plan Mode - Start planning?",
                    session_data,
                    context={
                        'tool_name': tool_name,
                        'action': 'enter_plan_mode'
                    },
                    hook_event_type='PreToolUse',
                    payload={'tool_name': tool_name, 'tool_input': tool_input},
                    timeout=timeout
                )

                if result.approved:
                    comment = f" Comment: {result.comment}" if result.comment else ""
                    self.log_stderr(f"[HITL] Entering plan mode approved.{comment}")
                    self.set_send_event_options(summarize=True)
                    return self.allow()  # Allow - proceed with EnterPlanMode
                else:
                    reason = result.comment or "User denied entering plan mode"
                    self.log_stderr(f"[HITL] Entering plan mode denied: {reason}")
                    self.set_send_event_options(summarize=True)
                    return self.block(f"Entering plan mode denied via HITL: {reason}")

        # ===========================================
        # PROTECTED FILE EDITS
        # ===========================================
        if is_hitl_enabled() and tool_name in ['Edit', 'Write', 'MultiEdit']:
            file_path = tool_input.get('file_path', '')

            if is_protected_file(file_path):
                timeout = get_timeout(tool_name)

                # Build context for diff display
                context = {
                    'tool_name': tool_name,
                    'file_path': file_path
                }

                # Add diff info for Edit
                if tool_name == 'Edit':
                    context['old_string'] = tool_input.get('old_string', '')
                    context['new_string'] = tool_input.get('new_string', '')
                elif tool_name == 'Write':
                    context['content'] = tool_input.get('content', '')[:500]  # Truncate for display

                result = ask_approval(
                    f"📝 {tool_name} protected file: `{file_path}`",
                    session_data,
                    context=context,
                    hook_event_type='PreToolUse',
                    payload={'tool_name': tool_name, 'tool_input': tool_input},
                    timeout=timeout
                )

                if result.approved:
                    comment = f" Comment: {result.comment}" if result.comment else ""
                    self.log_stderr(f"[HITL] File edit approved.{comment}")
                    # Continue to logging, don't exit - file edit proceeds
                else:
                    reason = result.comment or "User denied file edit"
                    self.log_stderr(f"[HITL] File edit denied: {reason}")
                    self.set_send_event_options(summarize=True)
                    return self.block(f"Protected file edit denied via HITL: {reason}. File: {file_path}")

        # Check for .env file access (blocks access to sensitive environment files)
        # COMMENTED OUT: Allows worktree command to create .env files automatically
        # if is_env_file_access(tool_name, tool_input):
        #     self.log_stderr("BLOCKED: Access to .env files containing sensitive data is prohibited")
        #     self.log_stderr("Use .env.sample for template files instead")
        #     return self.block("Access to .env files containing sensitive data is prohibited. Use .env.sample for template files instead")

        # Check for dangerous rm -rf commands
        if tool_name == 'Bash':
            command = tool_input.get('command', '')

            # Dangerous rm -rf commands require human approval
            if is_dangerous_rm_command(command, ALLOWED_RM_DIRECTORIES):
                if is_hitl_enabled():
                    result = ask_approval(
                        f"🚨 Dangerous command detected:\n\n`{command}`\n\nAllow execution?",
                        session_data,
                        context={
                            'tool_name': tool_name,
                            'command': command,
                            'allowed_dirs': ALLOWED_RM_DIRECTORIES
                        },
                        hook_event_type='PreToolUse',
                        payload={'tool_name': tool_name, 'tool_input': tool_input},
                        timeout=120  # 2 minutes for quick approval
                    )

                    if result.approved:
                        comment = f" Comment: {result.comment}" if result.comment else ""
                        self.log_stderr(f"[HITL] Dangerous command approved.{comment}")
                        # Continue execution (don't exit, will proceed to logging)
                    else:
                        reason = result.comment or "User denied dangerous command"
                        self.log_stderr(f"[HITL] Dangerous command denied: {reason}")
                        self.set_send_event_options(summarize=True)
                        return self.block(f"Dangerous command denied via HITL: {reason}. Command: {command}")
                else:
                    # HITL disabled - block dangerous command
                    self.log_stderr("[HITL] Dangerous rm command blocked (HITL disabled)")
                    self.set_send_event_options(summarize=True)
                    return self.block(f"Dangerous rm command blocked. Only allowed in: {', '.join(ALLOWED_RM_DIRECTORIES)}. Command: {command}")

        # ===========================================
        # HINTS AND AUTO-FIX SYSTEM
        # ===========================================
        if is_hints_enabled() and should_provide_hints(tool_name):
            # Get working directory from input or use current
            cwd = input_data.get('cwd', os.getcwd())

            # Process tool call for hints/modifications
            hint_result = process_tool_call(
                tool_name,
                tool_input,
                cwd=cwd,
                auto_fix=is_auto_fix_enabled()
            )

            # If we have hints or modifications, output them
            if hint_result.hint or hint_result.should_modify:
                hook_output = create_hook_output(hint_result, tool_input)
                if hook_output:
                    if hint_result.hint:
                        self.log_stderr(f"[Hints] {hint_result.hint}")
                    self.set_send_event_options(summarize=True)
                    # Return the hook output as custom output
                    return HandlerResult(
                        exit_code=0,
                        hook_output=hook_output
                    )

        # ===========================================
        # LOGGING
        # ===========================================
        # Extract session_id
        session_id = input_data.get('session_id', 'unknown')

        # Ensure session log directory exists
        log_dir = ensure_session_log_dir(session_id)
        log_path = log_dir / 'pre_tool_use.json'

        # Use file locking to prevent TOCTOU race conditions
        try:
            with open(log_path, 'a+') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)  # Exclusive lock
                try:
                    f.seek(0)
                    content = f.read()
                    if content:
                        try:
                            log_data = json.loads(content)
                        except (json.JSONDecodeError, ValueError):
                            log_data = []
                    else:
                        log_data = []

                    # Append new data
                    log_data.append(input_data)

                    # Write back to file with formatting
                    f.seek(0)
                    f.truncate()
                    json.dump(log_data, f, indent=2)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)  # Release lock
        except Exception as e:
            self.log_stderr(f"[HITL] Logging error: {e}")

        # Set send_event_options with summarize=True as required
        self.set_send_event_options(summarize=True)

        # Allow tool execution
        return self.allow()
