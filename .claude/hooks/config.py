"""
HITL Configuration for Pre-hooks

Defines which tools require human approval and how they should be handled.
"""

import fnmatch
from pathlib import Path
from typing import List, Optional

# HITL Configuration
HITL_CONFIG = {
    # Master switch
    'enabled': True,

    # Tools that always require HITL (decision-making tools)
    'decision_tools': [
        'AskUserQuestion',   # User questions from Claude
        'ExitPlanMode',      # Plan execution approval
        'EnterPlanMode',     # Plan mode entry
    ],

    # File patterns that require approval for Edit/Write operations
    'protected_file_patterns': [
        '*.env*',            # Environment files
        '**/package.json',   # Package configs
        '**/settings.json',  # Settings files
        '**/*.config.*',     # Config files
        '**/CLAUDE.md',      # Claude instructions
        '.claude/**',        # Claude config directory
        '**/docker-compose*.yml',  # Docker configs
        '**/Dockerfile*',    # Dockerfiles
        '**/.gitlab-ci.yml', # CI configs
        '**/.github/**',     # GitHub workflows
    ],

    # Timeouts (in seconds)
    'timeouts': {
        'AskUserQuestion': 300,  # 5 minutes for questions
        'ExitPlanMode': 120,     # 2 minutes for plan approval
        'EnterPlanMode': 60,     # 1 minute for plan mode entry
        'Edit': 120,             # 2 minutes for edits
        'Write': 120,            # 2 minutes for writes
        'default': 120,          # Default timeout
    },

    # HITL types for each tool
    'hitl_types': {
        'AskUserQuestion': 'question_input',  # Redirect question to UI
        'ExitPlanMode': 'approval',           # Approve plan execution
        'EnterPlanMode': 'approval',          # Approve plan mode entry
        'Edit': 'approval',                   # Approve file edit
        'Write': 'approval',                  # Approve file creation
    },
}


def is_hitl_enabled() -> bool:
    """Check if HITL is enabled globally."""
    return HITL_CONFIG.get('enabled', True)


def is_decision_tool(tool_name: str) -> bool:
    """Check if tool is a decision-making tool that always requires HITL."""
    return tool_name in HITL_CONFIG.get('decision_tools', [])


def is_protected_file(file_path: str) -> bool:
    """
    Check if file matches any protected pattern.

    Normalizes paths to prevent bypass attempts like '../../.env'.
    Uses pathlib for cross-platform compatibility.
    """
    if not file_path:
        return False

    # Normalize the path to resolve '..' and '.' components
    try:
        normalized_path = Path(file_path).resolve()
        # Convert to forward slashes for consistent pattern matching
        normalized_str = normalized_path.as_posix()
    except (ValueError, OSError):
        # If path resolution fails, use the original path for matching
        normalized_str = str(Path(file_path).as_posix())

    patterns = HITL_CONFIG.get('protected_file_patterns', [])
    for pattern in patterns:
        # Match against full normalized path
        if fnmatch.fnmatch(normalized_str, pattern):
            return True
        # Also check just the filename
        basename = normalized_path.name if isinstance(normalized_path, Path) else Path(file_path).name
        if fnmatch.fnmatch(basename, pattern):
            return True

    return False


def get_timeout(tool_name: str) -> int:
    """Get timeout for specific tool."""
    timeouts = HITL_CONFIG.get('timeouts', {})
    return timeouts.get(tool_name, timeouts.get('default', 120))


def get_hitl_type(tool_name: str) -> str:
    """Get HITL type for specific tool."""
    hitl_types = HITL_CONFIG.get('hitl_types', {})
    return hitl_types.get(tool_name, 'approval')


def should_require_hitl(tool_name: str, tool_input: dict) -> bool:
    """
    Determine if a tool call should require HITL approval.

    Args:
        tool_name: Name of the tool being called
        tool_input: Input parameters for the tool

    Returns:
        True if HITL is required, False otherwise
    """
    if not is_hitl_enabled():
        return False

    # Decision tools always require HITL
    if is_decision_tool(tool_name):
        return True

    # Check Edit/Write for protected files
    if tool_name in ['Edit', 'Write', 'MultiEdit']:
        file_path = tool_input.get('file_path', '')
        if is_protected_file(file_path):
            return True

    return False
