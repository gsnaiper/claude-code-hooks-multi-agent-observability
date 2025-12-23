#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "anthropic",
#     "python-dotenv",
# ]
# ///

import json
from typing import Optional, Dict, Any
from pathlib import Path
from .llm.anth import prompt_llm

# Cache for statusline
CACHE_DIR = Path.home() / ".claude" / "cache"
CACHE_FILE = CACHE_DIR / "status.txt"


def write_to_cache(summary: str):
    """Write summary to cache file for statusline."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(summary)
    except Exception:
        pass  # Non-critical, don't fail


def generate_event_summary(event_data: Dict[str, Any]) -> Optional[str]:
    """
    Generate a concise one-sentence summary of a hook event for engineers.

    Args:
        event_data: The hook event data containing event_type, payload, etc.

    Returns:
        str: A one-sentence summary, or None if generation fails
    """
    event_type = event_data.get("hook_event_type", "Unknown")
    payload = event_data.get("payload", {})

    # Convert payload to string representation
    payload_str = json.dumps(payload, indent=2)
    if len(payload_str) > 1000:
        payload_str = payload_str[:1000] + "..."

    prompt = f"""Generate a one-sentence summary of this Claude Code hook event payload for an engineer monitoring the system.

Event Type: {event_type}
Payload:
{payload_str}

Requirements:
- ONE sentence only (no period at the end)
- Focus on the key action or information in the payload
- Be specific and technical
- Keep under 15 words
- Use present tense
- No quotes or formatting
- Return ONLY the summary text

Examples:
- Reads configuration file from project root
- Executes npm install to update dependencies
- Searches web for React documentation
- Edits database schema to add user table
- Agent responds with implementation plan

Generate the summary based on the payload:"""

    summary = prompt_llm(prompt)

    # Clean up the response
    if summary:
        summary = summary.strip().strip('"').strip("'").strip(".")
        # Take only the first line if multiple
        summary = summary.split("\n")[0].strip()
        # Ensure it's not too long
        if len(summary) > 100:
            summary = summary[:97] + "..."
        # Write to cache for statusline
        write_to_cache(summary)

    return summary
