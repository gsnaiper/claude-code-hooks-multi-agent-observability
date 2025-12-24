#!/usr/bin/env python3
"""
Event deduplication utility for Claude Code hooks.
Thin wrapper around redis_cache for backwards compatibility.
"""

from typing import Optional

from .redis_cache import get_hook_cache, get_content_hash as _get_content_hash


def is_duplicate_event(
    event_type: str,
    session_id: str,
    content_hash: Optional[str] = None,
    source_app: Optional[str] = None
) -> bool:
    """
    Check if this event is a duplicate (already processed recently).

    Args:
        event_type: Type of event (Notification, PreToolUse, etc.)
        session_id: Claude session ID
        content_hash: Optional hash of event content for more precise dedup
        source_app: Optional source app identifier (for logging, unused)

    Returns:
        True if this is a duplicate event that should be skipped
    """
    cache = get_hook_cache()
    return cache.is_duplicate_event(event_type, session_id, content_hash)


def get_content_hash(data: dict) -> str:
    """Generate a hash of event content for precise deduplication."""
    return _get_content_hash(data)
