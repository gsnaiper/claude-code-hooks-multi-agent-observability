#!/usr/bin/env python3
"""
UserPromptSubmit hook handler.
Logs user prompts, manages session data, generates agent names, and validates prompts.
"""
import json
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any

from .base import SimpleHookHandler, HandlerResult


class UserPromptSubmitHandler(SimpleHookHandler):
    """Handler for user_prompt_submit hook event."""

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute user prompt submit logic.

        Args:
            input_data: JSON data containing session_id and prompt
            args: Parsed arguments with validate, log_only, store_last_prompt, name_agent flags

        Returns:
            HandlerResult with exit_code=0 (allow) or exit_code=2 (block if validation fails)
        """
        try:
            # Extract session_id and prompt
            session_id = self.get_session_id(input_data)
            prompt = input_data.get("prompt", "")

            # Log the user prompt
            self._log_user_prompt(session_id, input_data)

            # Manage session data with JSON structure
            if args.store_last_prompt or args.name_agent:
                self._manage_session_data(session_id, prompt, name_agent=args.name_agent)

            # Validate prompt if requested and not in log-only mode
            if args.validate and not args.log_only:
                is_valid, reason = self._validate_prompt(prompt)
                if not is_valid:
                    # Print error to stderr for debugging
                    print(f"Prompt blocked: {reason}", file=sys.stderr)
                    # Return blocking result with exit code 2
                    return HandlerResult(
                        exit_code=2,
                        output=None,
                        should_send_event=False
                    )

            # Set send_event options with summarize=True
            self.set_send_event_options(summarize=True)

            # Success - allow prompt to be processed
            return self.allow()

        except json.JSONDecodeError:
            # Handle JSON decode errors gracefully - allow by default
            return self.allow()
        except Exception:
            # Handle any other errors gracefully - allow by default
            return self.allow()

    def _log_user_prompt(self, session_id: str, input_data: Dict[str, Any]):
        """Log user prompt to logs directory."""
        # Ensure logs directory exists
        log_dir = Path("logs")
        log_dir.mkdir(parents=True, exist_ok=True)
        log_file = log_dir / "user_prompt_submit.json"

        # Read existing log data or initialize empty list
        if log_file.exists():
            with open(log_file, "r") as f:
                try:
                    log_data = json.load(f)
                except (json.JSONDecodeError, ValueError):
                    log_data = []
        else:
            log_data = []

        # Append the entire input data
        log_data.append(input_data)

        # Write back to file with formatting
        with open(log_file, "w") as f:
            json.dump(log_data, f, indent=2)

    def _manage_session_data(self, session_id: str, prompt: str, name_agent: bool = False):
        """Manage session data in the new JSON structure."""
        # Ensure sessions directory exists
        sessions_dir = Path(".claude/data/sessions")
        sessions_dir.mkdir(parents=True, exist_ok=True)

        # Load or create session file
        session_file = sessions_dir / f"{session_id}.json"

        if session_file.exists():
            try:
                with open(session_file, "r") as f:
                    session_data = json.load(f)
            except (json.JSONDecodeError, ValueError):
                session_data = {"session_id": session_id, "prompts": []}
        else:
            session_data = {"session_id": session_id, "prompts": []}

        # Add the new prompt
        session_data["prompts"].append(prompt)

        # Generate agent name if requested and not already present
        if name_agent and "agent_name" not in session_data:
            agent_name = self._generate_agent_name()
            if agent_name:
                session_data["agent_name"] = agent_name

        # Save the updated session data
        try:
            with open(session_file, "w") as f:
                json.dump(session_data, f, indent=2)
        except Exception:
            # Silently fail if we can't write the file
            pass

    def _generate_agent_name(self) -> str | None:
        """
        Generate an agent name using LLM providers.
        Tries Anthropic first, then falls back to Ollama.

        Returns:
            Agent name (string) or None if generation failed
        """
        # Try Anthropic first (preferred)
        try:
            result = subprocess.run(
                ["uv", "run", ".claude/hooks/utils/llm/anth.py", "--agent-name"],
                capture_output=True,
                text=True,
                timeout=10,
            )

            if result.returncode == 0 and result.stdout.strip():
                agent_name = result.stdout.strip()
                # Validate the name
                if len(agent_name.split()) == 1 and agent_name.isalnum():
                    return agent_name
                else:
                    raise Exception("Invalid name from Anthropic")
        except Exception:
            # Fall back to Ollama if Anthropic fails
            try:
                result = subprocess.run(
                    ["uv", "run", ".claude/hooks/utils/llm/ollama.py", "--agent-name"],
                    capture_output=True,
                    text=True,
                    timeout=10,  # Shorter timeout for local Ollama
                )

                if result.returncode == 0 and result.stdout.strip():
                    agent_name = result.stdout.strip()
                    # Check if it's a valid name (not an error message)
                    if len(agent_name.split()) == 1 and agent_name.isalnum():
                        return agent_name
            except Exception:
                # If both fail, don't block the prompt
                pass

        return None

    def _validate_prompt(self, prompt: str) -> tuple[bool, str | None]:
        """
        Validate the user prompt for security or policy violations.

        Args:
            prompt: The user prompt text

        Returns:
            Tuple of (is_valid, reason). reason is None if valid.
        """
        # Example validation rules (customize as needed)
        blocked_patterns = [
            # Add any patterns you want to block
            # Example: ('rm -rf /', 'Dangerous command detected'),
        ]

        prompt_lower = prompt.lower()

        for pattern, reason in blocked_patterns:
            if pattern.lower() in prompt_lower:
                return False, reason

        return True, None
