#!/usr/bin/env python3
"""
Event deduplication utility for Claude Code hooks.
Prevents duplicate event processing when hooks are defined at both user and project levels.
"""

import os
import json
import time
import hashlib
import fcntl
from pathlib import Path
from typing import Optional

# Dedup cache file location
DEDUP_CACHE_FILE = Path("/tmp/claude-hooks-dedup-cache.json")
DEDUP_TTL_SECONDS = 5  # Events within this window are considered duplicates
DEDUP_CLEANUP_THRESHOLD = 100  # Cleanup when cache exceeds this many entries


def _get_event_key(event_type: str, session_id: str, content_hash: Optional[str] = None) -> str:
    """Generate a unique key for an event."""
    # Round timestamp to nearest second for dedup window
    timestamp_bucket = int(time.time())

    key_parts = [event_type, session_id, str(timestamp_bucket)]
    if content_hash:
        key_parts.append(content_hash)

    return hashlib.md5(":".join(key_parts).encode()).hexdigest()[:16]


def _load_cache() -> dict:
    """Load dedup cache from file with locking."""
    if not DEDUP_CACHE_FILE.exists():
        return {}

    try:
        with open(DEDUP_CACHE_FILE, 'r') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_SH)
            try:
                return json.load(f)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_cache(cache: dict) -> None:
    """Save dedup cache to file with locking."""
    try:
        with open(DEDUP_CACHE_FILE, 'w') as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            try:
                json.dump(cache, f)
            finally:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except OSError as e:
        print(f"[Dedup] Warning: Failed to save cache: {e}")


def _cleanup_cache(cache: dict) -> dict:
    """Remove expired entries from cache."""
    current_time = time.time()
    return {
        key: timestamp
        for key, timestamp in cache.items()
        if current_time - timestamp < DEDUP_TTL_SECONDS * 2
    }


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
        source_app: Optional source app identifier (for logging)

    Returns:
        True if this is a duplicate event that should be skipped
    """
    event_key = _get_event_key(event_type, session_id, content_hash)

    cache = _load_cache()
    current_time = time.time()

    # Check if event was recently processed
    if event_key in cache:
        last_processed = cache[event_key]
        if current_time - last_processed < DEDUP_TTL_SECONDS:
            print(f"[Dedup] Skipping duplicate {event_type} event (key={event_key[:8]})")
            return True

    # Mark as processed
    cache[event_key] = current_time

    # Cleanup if cache is too large
    if len(cache) > DEDUP_CLEANUP_THRESHOLD:
        cache = _cleanup_cache(cache)

    _save_cache(cache)
    return False


def get_content_hash(data: dict) -> str:
    """Generate a hash of event content for precise deduplication."""
    # Use relevant fields for hashing
    relevant_fields = ['tool_name', 'message', 'title', 'level']
    content_parts = []

    for field in relevant_fields:
        if field in data:
            content_parts.append(str(data[field]))

    if not content_parts:
        content_parts = [json.dumps(data, sort_keys=True)]

    return hashlib.md5(":".join(content_parts).encode()).hexdigest()[:8]
