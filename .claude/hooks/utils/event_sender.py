#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "anthropic",
#     "python-dotenv",
#     "redis",
# ]
# ///

"""
Event Sender Module - Reusable event sending functionality.

This module provides the core logic for sending events to the observability server,
extracted from send_event.py for reuse by other components like router.py.

Features:
- Direct HTTP POST to server (primary)
- Redis queue fallback when server unavailable
- WSL PowerShell fallback for Windows connectivity
- Deduplication support
- Auto-summarization
- Project ID detection
"""

import json
import sys
import os
import urllib.request
import urllib.error
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional, Tuple
from dotenv import load_dotenv

# Load .env from ~/.claude/.env
_env_path = Path.home() / '.claude' / '.env'
if _env_path.exists():
    load_dotenv(_env_path)

from utils.summarizer import generate_event_summary
from utils.model_extractor import get_model_from_transcript
from utils.dedup import is_duplicate_event, get_content_hash
from utils.redis_cache import get_hook_cache


def is_wsl() -> bool:
    """Detect if running in WSL."""
    try:
        with open('/proc/version', 'r') as f:
            return 'microsoft' in f.read().lower()
    except:
        return False


def get_allowed_hosts() -> Tuple[str, ...]:
    """Get allowed hosts from environment or defaults."""
    default_hosts = ('localhost', '127.0.0.1', '[::1]', '::1', 'ai.di4.dev')
    extra_hosts = os.environ.get('OBSERVABILITY_ALLOWED_HOSTS', '')
    if extra_hosts:
        return default_hosts + tuple(h.strip() for h in extra_hosts.split(',') if h.strip())
    return default_hosts


def get_default_server_url() -> str:
    """Get server URL from environment or default."""
    return os.environ.get('OBSERVABILITY_SERVER_URL', 'https://ai.di4.dev/events')


def validate_server_url(url: str) -> bool:
    """
    Validate server URL to prevent command injection.
    Only allows trusted hosts (localhost + OBSERVABILITY_ALLOWED_HOSTS).
    """
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        # Only allow http/https
        if parsed.scheme not in ('http', 'https'):
            return False
        # Allow localhost and configured hosts
        allowed_hosts = get_allowed_hosts()
        if parsed.hostname not in allowed_hosts:
            return False
        # Validate port is numeric
        if parsed.port is not None and not isinstance(parsed.port, int):
            return False
        return True
    except Exception:
        return False


def escape_json_for_powershell(json_str: str) -> str:
    """
    Escape JSON string for safe embedding in PowerShell here-string.
    Replaces characters that could break out of here-string.
    """
    # Here-strings in PowerShell end with '@ on a new line
    # We need to escape any '@ patterns and control characters
    escaped = json_str.replace("'@", "'`@")  # Escape here-string terminator
    return escaped


def send_via_powershell(event_data: Dict, server_url: str) -> bool:
    """
    Send event using PowerShell (for WSL-to-Windows connectivity).

    Security: Only allows localhost URLs to prevent command injection.
    """
    # SECURITY: Validate URL before using in PowerShell
    if not validate_server_url(server_url):
        print(f"[Hook] PowerShell fallback rejected: URL must be localhost", file=sys.stderr)
        return False

    try:
        import base64
        json_body = json.dumps(event_data)

        # SECURITY: Escape JSON for PowerShell here-string
        escaped_json = escape_json_for_powershell(json_body)

        # SECURITY: URL already validated as localhost
        ps_script = f"""
$body = @'
{escaped_json}
'@
Invoke-RestMethod -Method Post -Uri '{server_url}' -ContentType 'application/json' -Body $body
"""
        encoded = base64.b64encode(ps_script.encode('utf-16-le')).decode('ascii')
        cmd = ['powershell.exe', '-EncodedCommand', encoded]
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        return result.returncode == 0
    except Exception as e:
        print(f"PowerShell fallback failed: {e}", file=sys.stderr)
        return False


def queue_event_fallback(event_data: Dict) -> bool:
    """Queue event to Redis as fallback when server is unavailable."""
    try:
        cache = get_hook_cache()
        if cache.is_redis_available:
            if cache.queue_event(event_data):
                print("[Hook] Event queued to Redis (server unavailable)", file=sys.stderr)
                return True
    except Exception as e:
        print(f"[Hook] Queue fallback failed: {e}", file=sys.stderr)
    return False


def send_event_to_server(event_data: Dict, server_url: Optional[str] = None, use_queue_fallback: bool = True) -> bool:
    """
    Send event data to the observability server.

    Args:
        event_data: Event data to send
        server_url: Server URL (defaults to OBSERVABILITY_SERVER_URL env var)
        use_queue_fallback: If True, queue to Redis when server unavailable

    Returns:
        True if sent successfully (or queued as fallback)
    """
    if server_url is None:
        server_url = get_default_server_url()

    try:
        # Prepare the request
        req = urllib.request.Request(
            server_url,
            data=json.dumps(event_data).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Claude-Code-Hook/1.0'
            }
        )

        # Send the request
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return True
            else:
                print(f"Server returned status: {response.status}", file=sys.stderr)
                if use_queue_fallback:
                    return queue_event_fallback(event_data)
                return False

    except urllib.error.URLError as e:
        # WSL-to-Windows fallback: use PowerShell if urllib fails
        if is_wsl():
            if send_via_powershell(event_data, server_url):
                return True

        # Queue fallback when server is unavailable
        if use_queue_fallback:
            return queue_event_fallback(event_data)

        print(f"Failed to send event: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        if use_queue_fallback:
            return queue_event_fallback(event_data)
        return False


def get_auto_project_id(cwd: Optional[str] = None) -> str:
    """
    Auto-detect project ID using hybrid approach.
    Imports get_project_id from lib if available, otherwise uses fallback.
    """
    if cwd is None:
        cwd = os.getcwd()

    try:
        # Try to import from lib directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        lib_path = os.path.join(os.path.dirname(script_dir), 'lib', 'get_project_id.py')

        if os.path.exists(lib_path):
            import importlib.util
            spec = importlib.util.spec_from_file_location("get_project_id", lib_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.get_project_id(cwd)
    except Exception:
        pass

    # Fallback: simple implementation
    import hashlib

    # Try git remote
    try:
        result = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=cwd, capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            url = result.stdout.strip().removesuffix(".git")
            parts = url.split("/")
            if len(parts) >= 2:
                owner = parts[-2].split(":")[-1].split("@")[-1]
                repo = parts[-1]
                if owner and repo:
                    return f"{owner}:{repo}"
    except Exception:
        pass

    # Fallback to directory hash
    abs_path = Path(cwd).resolve()
    path_hash = hashlib.sha256(str(abs_path).encode()).hexdigest()[:12]
    dir_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in abs_path.name)[:30]
    return f"local:{dir_name}-{path_hash}"


def send_event_direct(input_data: Dict, options: Dict) -> bool:
    """
    Main entry point for sending events programmatically.

    This function is designed to be called by other modules like router.py
    without requiring CLI argument parsing.

    Args:
        input_data: The hook JSON data from stdin or other source
        options: Configuration dict with the following keys:
            - event_type (str, required): Hook event type (PreToolUse, PostToolUse, etc.)
            - server_url (str, optional): Server URL (defaults to env var or ai.di4.dev)
            - add_chat (bool, optional): Include chat transcript if available (default: False)
            - summarize (bool, optional): Generate AI summary of the event (default: False)
            - auto_project_id (bool, optional): Auto-detect project ID from git/directory (default: False)
            - source_app (str, optional): Source application name (required if auto_project_id=False)
            - use_queue_fallback (bool, optional): Use Redis queue fallback (default: True)

    Returns:
        bool: True if sent successfully (or queued as fallback), False otherwise
    """
    # Extract options with defaults
    event_type = options.get('event_type')
    server_url = options.get('server_url')
    add_chat = options.get('add_chat', False)
    summarize = options.get('summarize', False)
    auto_project_id = options.get('auto_project_id', False)
    source_app = options.get('source_app')
    use_queue_fallback = options.get('use_queue_fallback', True)

    if not event_type:
        raise ValueError("event_type is required in options")

    if not auto_project_id and not source_app:
        raise ValueError("Either auto_project_id=True or source_app must be provided in options")

    # Check for duplicate events
    session_id = input_data.get('session_id', 'unknown')
    content_hash = get_content_hash(input_data)

    if is_duplicate_event(event_type, session_id, content_hash):
        # Skip duplicate event
        return True  # Return True as this is not an error

    # Extract model name from transcript (with caching)
    transcript_path = input_data.get('transcript_path', '')
    model_name = ''
    if transcript_path:
        model_name = get_model_from_transcript(session_id, transcript_path)

    # Determine source_app (explicit or auto-detected)
    if auto_project_id:
        cwd = input_data.get('cwd', os.getcwd())
        source_app = get_auto_project_id(cwd)

    # Prepare event data for server
    event_data = {
        'source_app': source_app,
        'session_id': session_id,
        'hook_event_type': event_type,
        'payload': input_data,
        'timestamp': int(datetime.now().timestamp() * 1000),
        'model_name': model_name
    }

    # Handle add_chat option
    if add_chat and 'transcript_path' in input_data:
        transcript_path = input_data['transcript_path']
        if os.path.exists(transcript_path):
            # Read .jsonl file and convert to JSON array
            chat_data = []
            try:
                with open(transcript_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                chat_data.append(json.loads(line))
                            except json.JSONDecodeError:
                                pass  # Skip invalid lines

                # Add chat to event data
                event_data['chat'] = chat_data
            except Exception as e:
                print(f"Failed to read transcript: {e}", file=sys.stderr)

    # Generate summary if requested
    if summarize:
        summary = generate_event_summary(event_data)
        if summary:
            event_data['summary'] = summary
        # Continue even if summary generation fails

    # Send to server
    success = send_event_to_server(event_data, server_url, use_queue_fallback)

    return success
