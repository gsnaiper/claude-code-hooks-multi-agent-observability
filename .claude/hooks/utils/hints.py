"""
Hints and Tool Modifications System

Provides intelligent hints and command modifications based on project context.
"""

import json
import re
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass

from .project_context import ProjectContext, detect_project_context, apply_substitutions


@dataclass
class HookResult:
    """Result of hook processing"""
    should_modify: bool = False
    modified_input: Optional[Dict[str, Any]] = None
    hint: Optional[str] = None
    allow: bool = True  # True = allow (with optional modifications), False = deny


def generate_bash_hint(command: str, ctx: ProjectContext) -> Optional[str]:
    """Generate hint for Bash command based on project context."""
    hints = []

    # Runtime substitution hints
    if ctx.runtime == 'bun':
        if 'npm run' in command:
            hints.append("This project uses Bun. Consider: `bun run` instead of `npm run`")
        if 'npm install' in command:
            hints.append("This project uses Bun. Consider: `bun install` instead of `npm install`")
        if 'node ' in command and 'node_modules' not in command:
            hints.append("This project uses Bun. Consider: `bun` instead of `node`")
        if 'npx ' in command:
            hints.append("This project uses Bun. Consider: `bunx` instead of `npx`")
        if command.strip() in ('jest', 'vitest', 'npm test'):
            hints.append("This project uses Bun. Consider: `bun test` for testing")

    elif ctx.package_manager == 'pnpm':
        if 'npm run' in command:
            hints.append("This project uses pnpm. Consider: `pnpm run` instead of `npm run`")
        if 'npm install' in command:
            hints.append("This project uses pnpm. Consider: `pnpm install` instead of `npm install`")

    elif ctx.package_manager == 'yarn':
        if 'npm run' in command:
            hints.append("This project uses Yarn. Consider: `yarn` instead of `npm run`")

    # Python hints
    if ctx.runtime == 'python':
        if ctx.package_manager == 'uv':
            if 'pip install' in command:
                hints.append("This project uses uv. Consider: `uv add` instead of `pip install`")
            if 'python ' in command and 'uv run' not in command:
                hints.append("This project uses uv. Consider: `uv run python` instead of `python`")
        elif ctx.package_manager == 'poetry':
            if 'pip install' in command:
                hints.append("This project uses Poetry. Consider: `poetry add` instead of `pip install`")

    # Framework-specific hints
    if 'vue' in ctx.frameworks:
        if 'npm run dev' in command or 'yarn dev' in command:
            if ctx.runtime == 'bun':
                hints.append("Vue project with Bun: Use `bun run dev` for development server")

    # Script availability hints
    if ctx.available_scripts:
        # Check if user is trying to run a script that exists
        for script_name in ctx.available_scripts:
            if script_name in command and f'{ctx.package_manager} run {script_name}' not in command:
                if f'{script_name}' == command.strip():
                    hints.append(f"Script '{script_name}' available. Run with: `{ctx.package_manager} run {script_name}`")

    if hints:
        return " | ".join(hints)
    return None


def process_bash_command(
    command: str,
    ctx: ProjectContext,
    auto_fix: bool = True
) -> HookResult:
    """
    Process Bash command and optionally auto-fix based on project context.

    Args:
        command: The bash command
        ctx: Project context
        auto_fix: If True, automatically substitute commands

    Returns:
        HookResult with modifications and/or hints
    """
    result = HookResult(allow=True)

    # Generate hint
    hint = generate_bash_hint(command, ctx)
    if hint:
        result.hint = hint

    # Apply automatic substitutions if enabled
    if auto_fix:
        new_command = apply_substitutions(command, ctx)
        if new_command:
            result.should_modify = True
            result.modified_input = {'command': new_command}
            # Update hint to reflect auto-fix
            result.hint = f"Auto-corrected: {command} → {new_command}"

    return result


def process_tool_call(
    tool_name: str,
    tool_input: Dict[str, Any],
    cwd: Optional[str] = None,
    auto_fix: bool = False  # Disabled by default - only provide hints
) -> HookResult:
    """
    Process any tool call and provide hints/modifications.

    Args:
        tool_name: Name of the tool being called
        tool_input: Tool input parameters
        cwd: Working directory (for project detection)
        auto_fix: If True, automatically apply fixes

    Returns:
        HookResult with any modifications or hints
    """
    # Detect project context
    ctx = detect_project_context(cwd)

    if tool_name == 'Bash':
        command = tool_input.get('command', '')
        return process_bash_command(command, ctx, auto_fix=auto_fix)

    elif tool_name in ('Read', 'Edit', 'Write', 'MultiEdit'):
        # File operation hints
        file_path = tool_input.get('file_path', '')
        result = HookResult(allow=True)

        # Hint about CLAUDE.md if editing it
        if 'CLAUDE.md' in file_path:
            if ctx.claude_hints:
                result.hint = f"Existing CLAUDE.md hints: {len(ctx.claude_hints)} rules defined"

        return result

    elif tool_name == 'Glob':
        # Search hints
        result = HookResult(allow=True)
        pattern = tool_input.get('pattern', '')

        # Suggest better patterns based on project type
        if ctx.project_type == 'frontend' and '**/*.ts' in pattern:
            if 'vue' in ctx.frameworks:
                result.hint = "Vue project: Also consider **/*.vue for component files"
            elif 'react' in ctx.frameworks:
                result.hint = "React project: Also consider **/*.tsx for component files"

        return result

    # Default - no modifications
    return HookResult(allow=True)


def create_hook_output(
    result: HookResult,
    original_input: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Create JSON hook output for Claude Code.

    Args:
        result: Processing result
        original_input: Original tool input

    Returns:
        JSON-serializable dict for stdout, or None if no action needed
    """
    if not result.should_modify and not result.hint:
        return None

    output = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow" if result.allow else "deny",
        }
    }

    # Add hint as reason
    if result.hint:
        output["hookSpecificOutput"]["permissionDecisionReason"] = f"💡 {result.hint}"

    # Add modified input if we're auto-fixing
    if result.should_modify and result.modified_input:
        output["hookSpecificOutput"]["updatedInput"] = {
            **original_input,
            **result.modified_input
        }

    return output
