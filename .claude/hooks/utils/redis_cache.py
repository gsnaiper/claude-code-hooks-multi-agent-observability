#!/usr/bin/env python3
"""
Redis cache abstraction for Claude Code hooks.
Provides unified caching layer with Redis backend and file-based fallback.

Features:
- Event deduplication (SETEX 5s)
- Audio caching (SETEX 24h)
- Event queuing (Redis Streams)
- Automatic fallback to file-based when Redis unavailable
"""

import os
import re
import json
import time
import hashlib
import fcntl
import threading
from pathlib import Path
from typing import Optional, Dict, Any

# Load environment from ~/.env or project .env if available
try:
    from dotenv import load_dotenv
    # Try user home first, then project root
    home_env = Path.home() / '.env'
    if home_env.exists():
        load_dotenv(home_env)
    # Also try project root (3 levels up from utils/)
    project_env = Path(__file__).parent.parent.parent.parent / '.env'
    if project_env.exists():
        load_dotenv(project_env, override=False)
except ImportError:
    pass

# Try importing redis, graceful fallback if not available
try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

# Configuration with validation
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', None)
REDIS_ENABLED = os.getenv('REDIS_ENABLED', 'true').lower() == 'true'

try:
    REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
    REDIS_DB = int(os.getenv('REDIS_DB', '0'))
except ValueError:
    print("[HookCache] Invalid REDIS_PORT or REDIS_DB, using defaults")
    REDIS_PORT = 6379
    REDIS_DB = 0

# Stream name validation pattern
VALID_STREAM_NAME = re.compile(r'^[a-zA-Z0-9_-]+$')

# Fallback file locations
FALLBACK_CACHE_DIR = Path('/tmp/claude-hooks-cache')
FALLBACK_DEDUP_FILE = FALLBACK_CACHE_DIR / 'dedup.json'
FALLBACK_AUDIO_DIR = FALLBACK_CACHE_DIR / 'audio'

# TTL settings
DEDUP_TTL_SECONDS = 5
AUDIO_TTL_HOURS = 24


class HookCache:
    """
    Unified cache for Claude Code hooks.
    Uses Redis when available, falls back to file-based caching.
    """

    def __init__(self):
        self.redis: Optional['redis.Redis'] = None
        self._init_redis()
        self._init_fallback_dirs()

    def _init_redis(self) -> None:
        """Initialize Redis connection if available."""
        if not REDIS_AVAILABLE or not REDIS_ENABLED:
            return

        try:
            self.redis = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                db=REDIS_DB,
                password=REDIS_PASSWORD,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=False  # For binary audio data
            )
            self.redis.ping()
        except Exception as e:
            print(f"[HookCache] Redis unavailable, using file fallback: {e}")
            self.redis = None

    def _init_fallback_dirs(self) -> None:
        """Create fallback directories if needed."""
        try:
            FALLBACK_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            FALLBACK_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass

    @property
    def is_redis_available(self) -> bool:
        """Check if Redis connection is active."""
        return self.redis is not None

    # ========== Deduplication ==========

    def is_duplicate_event(
        self,
        event_type: str,
        session_id: str,
        content_hash: Optional[str] = None,
        ttl_seconds: int = DEDUP_TTL_SECONDS
    ) -> bool:
        """
        Check if event is duplicate using atomic Redis SETNX or file fallback.

        Args:
            event_type: Type of event (Notification, PreToolUse, etc.)
            session_id: Claude session ID
            content_hash: Optional hash of event content
            ttl_seconds: Time window for deduplication

        Returns:
            True if duplicate (should skip), False if new (should process)
        """
        key = self._make_dedup_key(event_type, session_id, content_hash)

        if self.redis:
            return self._redis_check_duplicate(key, ttl_seconds)
        return self._file_check_duplicate(key, ttl_seconds)

    def _make_dedup_key(
        self,
        event_type: str,
        session_id: str,
        content_hash: Optional[str] = None
    ) -> str:
        """Generate unique dedup key using SHA256."""
        parts = [event_type, session_id]
        if content_hash:
            parts.append(content_hash)
        key_data = ":".join(parts)
        return f"dedup:{hashlib.sha256(key_data.encode()).hexdigest()[:16]}"

    def _redis_check_duplicate(self, key: str, ttl_seconds: int) -> bool:
        """Check duplicate using Redis SETNX (atomic)."""
        try:
            # SETNX returns True if key was set (new event)
            # Returns False if key exists (duplicate)
            is_new = self.redis.set(key, "1", nx=True, ex=ttl_seconds)
            if not is_new:
                print(f"[HookCache] Duplicate event: {key}")
                return True
            return False
        except Exception as e:
            print(f"[HookCache] Redis error, falling back to file: {e}")
            return self._file_check_duplicate(key, ttl_seconds)

    def _file_check_duplicate(self, key: str, ttl_seconds: int) -> bool:
        """Check duplicate using file-based cache."""
        cache = self._load_file_cache(FALLBACK_DEDUP_FILE)
        current_time = time.time()

        # Check if recently processed
        if key in cache:
            if current_time - cache[key] < ttl_seconds:
                print(f"[HookCache] Duplicate event (file): {key}")
                return True

        # Mark as processed
        cache[key] = current_time

        # Cleanup old entries
        cache = {k: v for k, v in cache.items() if current_time - v < ttl_seconds * 2}

        self._save_file_cache(FALLBACK_DEDUP_FILE, cache)
        return False

    # ========== Audio Caching ==========

    def get_cached_audio(self, text: str, voice_id: str = "") -> Optional[bytes]:
        """
        Get cached TTS audio by text hash.

        Args:
            text: Text that was spoken
            voice_id: Voice ID used for TTS

        Returns:
            Audio bytes if cached, None otherwise
        """
        key = self._make_audio_key(text, voice_id)

        if self.redis:
            try:
                data = self.redis.get(key)
                if data:
                    print(f"[HookCache] Audio cache hit: {key[:20]}")
                    return data
            except Exception as e:
                print(f"[HookCache] Redis audio get error: {e}")

        # File fallback
        return self._file_get_audio(key)

    def cache_audio(
        self,
        text: str,
        audio_bytes: bytes,
        voice_id: str = "",
        ttl_hours: int = AUDIO_TTL_HOURS
    ) -> bool:
        """
        Cache TTS audio.

        Args:
            text: Text that was spoken
            audio_bytes: Audio data to cache
            voice_id: Voice ID used for TTS
            ttl_hours: How long to cache

        Returns:
            True if cached successfully
        """
        key = self._make_audio_key(text, voice_id)
        ttl_seconds = ttl_hours * 3600

        if self.redis:
            try:
                self.redis.setex(key, ttl_seconds, audio_bytes)
                print(f"[HookCache] Audio cached: {key[:20]}")
                return True
            except Exception as e:
                print(f"[HookCache] Redis audio cache error: {e}")

        # File fallback
        return self._file_cache_audio(key, audio_bytes)

    def _make_audio_key(self, text: str, voice_id: str) -> str:
        """Generate audio cache key."""
        key_data = f"{voice_id}:{text}"
        return f"audio:{hashlib.sha256(key_data.encode()).hexdigest()[:32]}"

    def _file_get_audio(self, key: str) -> Optional[bytes]:
        """Get audio from file cache."""
        audio_file = FALLBACK_AUDIO_DIR / f"{key.replace(':', '_')}.mp3"
        if audio_file.exists():
            try:
                return audio_file.read_bytes()
            except OSError:
                pass
        return None

    def _file_cache_audio(self, key: str, audio_bytes: bytes) -> bool:
        """Save audio to file cache."""
        audio_file = FALLBACK_AUDIO_DIR / f"{key.replace(':', '_')}.mp3"
        try:
            audio_file.write_bytes(audio_bytes)
            return True
        except OSError as e:
            print(f"[HookCache] File audio cache error: {e}")
            return False

    # ========== Event Queuing ==========

    def queue_event(
        self,
        event_data: Dict[str, Any],
        stream: str = "hook_events"
    ) -> bool:
        """
        Queue event for async processing using Redis Streams.

        Args:
            event_data: Event data to queue
            stream: Redis stream name (alphanumeric, underscore, hyphen only)

        Returns:
            True if queued successfully
        """
        if not self.redis:
            return False

        # Validate stream name to prevent injection
        if not VALID_STREAM_NAME.match(stream):
            print(f"[HookCache] Invalid stream name: {stream}")
            return False

        try:
            # Convert to string values for Redis
            flat_data = {
                k: json.dumps(v) if isinstance(v, (dict, list)) else str(v)
                for k, v in event_data.items()
            }
            self.redis.xadd(stream, flat_data, maxlen=1000)
            return True
        except Exception as e:
            print(f"[HookCache] Queue error: {e}")
            return False

    def get_queued_events(
        self,
        stream: str = "hook_events",
        count: int = 10
    ) -> list:
        """
        Get queued events from Redis Stream.

        Args:
            stream: Redis stream name (alphanumeric, underscore, hyphen only)
            count: Max events to retrieve

        Returns:
            List of (id, data) tuples
        """
        if not self.redis:
            return []

        # Validate stream name to prevent injection
        if not VALID_STREAM_NAME.match(stream):
            print(f"[HookCache] Invalid stream name: {stream}")
            return []

        try:
            events = self.redis.xread({stream: '0'}, count=count)
            if events:
                return [(e[0].decode(), {
                    k.decode(): v.decode() for k, v in e[1].items()
                }) for e in events[0][1]]
            return []
        except Exception as e:
            print(f"[HookCache] Queue read error: {e}")
            return []

    # ========== Session Context ==========

    def set_session_context(
        self,
        session_id: str,
        context: Dict[str, Any],
        ttl_hours: int = 24
    ) -> bool:
        """Store session context for multi-agent coordination."""
        if not self.redis:
            return False

        key = f"session:{session_id}"
        try:
            self.redis.setex(key, ttl_hours * 3600, json.dumps(context))
            return True
        except Exception as e:
            print(f"[HookCache] Session context error: {e}")
            return False

    def get_session_context(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve session context."""
        if not self.redis:
            return None

        key = f"session:{session_id}"
        try:
            data = self.redis.get(key)
            if data:
                return json.loads(data.decode())
            return None
        except Exception:
            return None

    # ========== Utility Methods ==========

    def _load_file_cache(self, path: Path) -> dict:
        """Load JSON cache from file with atomic locking (no TOCTOU)."""
        try:
            # Use a+ mode to avoid race condition between exists() and open()
            with open(path, 'a+') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                try:
                    f.seek(0)
                    content = f.read()
                    return json.loads(content) if content.strip() else {}
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except (json.JSONDecodeError, OSError) as e:
            print(f"[HookCache] Load error: {e}")
            return {}

    def _save_file_cache(self, path: Path, data: dict) -> None:
        """Save JSON cache to file with locking."""
        try:
            with open(path, 'w') as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                try:
                    json.dump(data, f)
                finally:
                    fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        except OSError as e:
            print(f"[HookCache] Save error: {e}")


# Global singleton instance with thread safety
_cache_instance: Optional[HookCache] = None
_cache_lock = threading.Lock()


def get_hook_cache() -> HookCache:
    """Get or create the global HookCache instance (thread-safe)."""
    global _cache_instance
    if _cache_instance is None:
        with _cache_lock:
            # Double-checked locking pattern
            if _cache_instance is None:
                _cache_instance = HookCache()
    return _cache_instance


def get_content_hash(data: dict) -> str:
    """
    Generate a hash of event content for precise deduplication.

    Args:
        data: Event data dictionary

    Returns:
        Short hash string (SHA256-based)
    """
    relevant_fields = ['tool_name', 'message', 'title', 'level']
    content_parts = []

    for field in relevant_fields:
        if field in data:
            content_parts.append(str(data[field]))

    if not content_parts:
        content_parts = [json.dumps(data, sort_keys=True)]

    return hashlib.sha256(":".join(content_parts).encode()).hexdigest()[:8]
