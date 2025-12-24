#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = ["requests", "websockets"]
# ///

import json
import sys
import re
import os
import shlex
import fcntl
from pathlib import Path
from utils.constants import ensure_session_log_dir
from utils.hitl import ask_approval, ask_question_via_hitl
from config import (
    is_hitl_enabled,
    is_decision_tool,
    is_protected_file,
    get_timeout,
    get_hitl_type,
    should_require_hitl
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

def main():
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)
        
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
                    # User answered - allow tool with response info
                    print(f"User response received: {result.response[:50]}...", file=sys.stderr)
                    # Note: The actual response handling depends on how Claude expects the answer
                    sys.exit(0)
                elif result.cancelled:
                    print("BLOCKED: User cancelled the question", file=sys.stderr)
                    sys.exit(2)
                else:
                    print("BLOCKED: No response received (timeout)", file=sys.stderr)
                    sys.exit(2)

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
                    print(f"APPROVED: Plan execution approved.{comment}", file=sys.stderr)
                    sys.exit(0)
                else:
                    reason = result.comment or "User denied plan execution"
                    print(f"BLOCKED: {reason}", file=sys.stderr)
                    sys.exit(2)

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
                    print(f"APPROVED: Entering plan mode.{comment}", file=sys.stderr)
                    sys.exit(0)
                else:
                    reason = result.comment or "User denied entering plan mode"
                    print(f"BLOCKED: {reason}", file=sys.stderr)
                    sys.exit(2)

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
                    print(f"APPROVED: File edit approved.{comment}", file=sys.stderr)
                    # Continue to logging, don't exit
                else:
                    reason = result.comment or "User denied file edit"
                    print(f"BLOCKED: {reason}", file=sys.stderr)
                    sys.exit(2)

        # Check for .env file access (blocks access to sensitive environment files)
        # COMMENTED OUT: Allows worktree command to create .env files automatically
        # if is_env_file_access(tool_name, tool_input):
        #     print("BLOCKED: Access to .env files containing sensitive data is prohibited", file=sys.stderr)
        #     print("Use .env.sample for template files instead", file=sys.stderr)
        #     sys.exit(2)  # Exit code 2 blocks tool call and shows error to Claude

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
                        if result.comment:
                            print(f"APPROVED with comment: {result.comment}", file=sys.stderr)
                        else:
                            print("APPROVED: Proceeding with command", file=sys.stderr)
                        # Continue execution (don't exit, will proceed to logging)
                    else:
                        reason = result.comment or "No reason provided"
                        print(f"DENIED: {reason}", file=sys.stderr)
                        print(f"Command blocked: {command}", file=sys.stderr)
                        sys.exit(2)  # Exit code 2 blocks tool call
                else:
                    # HITL disabled - use legacy blocking behavior
                    print("BLOCKED: Dangerous rm command detected and prevented", file=sys.stderr)
                    print(f"Tip: rm -rf is only allowed in these directories: {', '.join(ALLOWED_RM_DIRECTORIES)}", file=sys.stderr)
                    sys.exit(2)  # Exit code 2 blocks tool call and shows error to Claude
        
        # Extract session_id
        session_id = input_data.get('session_id', 'unknown')

        # Ensure session log directory exists
        log_dir = ensure_session_log_dir(session_id)
        log_path = log_dir / 'pre_tool_use.json'

        # Use file locking to prevent TOCTOU race conditions
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
        
        sys.exit(0)
        
    except json.JSONDecodeError as e:
        print(f"[HITL] JSON decode error: {e}", file=sys.stderr)
        sys.exit(0)
    except Exception as e:
        print(f"[HITL] Unexpected error: {e}", file=sys.stderr)
        sys.exit(0)

if __name__ == '__main__':
    main()