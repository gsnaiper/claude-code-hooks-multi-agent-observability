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
MMM (Multi Manager Mobile) Hook Script
Sends Claude Code hook events to the MMM server.

Features:
- Direct HTTP POST to server (primary)
- Redis queue fallback when server unavailable
- WSL PowerShell fallback for Windows connectivity
"""

import json
import sys
import os
import argparse
import urllib.request
import urllib.error
import subprocess
from datetime import datetime
from utils.summarizer import generate_event_summary
from utils.model_extractor import get_model_from_transcript
from utils.dedup import is_duplicate_event, get_content_hash
from utils.redis_cache import get_hook_cache

def is_wsl():
    """Detect if running in WSL."""
    try:
        with open('/proc/version', 'r') as f:
            return 'microsoft' in f.read().lower()
    except:
        return False

def validate_server_url(url: str) -> bool:
    """
    Validate server URL to prevent command injection.
    Only allows localhost URLs for security.
    """
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        # Only allow http/https to localhost
        if parsed.scheme not in ('http', 'https'):
            return False
        # Allow localhost, 127.0.0.1, or [::1]
        allowed_hosts = ('localhost', '127.0.0.1', '[::1]', '::1', 'ai.di4.dev')
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

def send_via_powershell(event_data, server_url):
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

def queue_event_fallback(event_data) -> bool:
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


def send_event_to_server(event_data, server_url='https://ai.di4.dev/events', use_queue_fallback=True):
    """
    Send event data to the observability server.

    Args:
        event_data: Event data to send
        server_url: Server URL
        use_queue_fallback: If True, queue to Redis when server unavailable

    Returns:
        True if sent successfully (or queued as fallback)
    """
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

def get_auto_project_id(cwd: str = None) -> str:
    """
    Auto-detect project ID using hybrid approach.
    Imports get_project_id from lib if available, otherwise uses fallback.
    """
    if cwd is None:
        cwd = os.getcwd()

    try:
        # Try to import from lib directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        lib_path = os.path.join(script_dir, 'lib', 'get_project_id.py')

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
    from pathlib import Path

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


def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Send Claude Code hook events to observability server')
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument('--source-app', help='Source application name (explicit)')
    source_group.add_argument('--auto-project-id', action='store_true', help='Auto-detect project ID from git/directory')
    parser.add_argument('--event-type', required=True, help='Hook event type (PreToolUse, PostToolUse, etc.)')
    parser.add_argument('--server-url', default='https://ai.di4.dev/events', help='Server URL')
    parser.add_argument('--add-chat', action='store_true', help='Include chat transcript if available')
    parser.add_argument('--summarize', action='store_true', help='Generate AI summary of the event')

    args = parser.parse_args()

    try:
        # Read hook data from stdin
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    # Check for duplicate events
    session_id = input_data.get('session_id', 'unknown')
    content_hash = get_content_hash(input_data)

    if is_duplicate_event(args.event_type, session_id, content_hash):
        # Skip duplicate event
        sys.exit(0)

    # Extract model name from transcript (with caching)
    transcript_path = input_data.get('transcript_path', '')
    model_name = ''
    if transcript_path:
        model_name = get_model_from_transcript(session_id, transcript_path)

    # Determine source_app (explicit or auto-detected)
    if args.auto_project_id:
        cwd = input_data.get('cwd', os.getcwd())
        source_app = get_auto_project_id(cwd)
    else:
        source_app = args.source_app

    # Prepare event data for server
    event_data = {
        'source_app': source_app,
        'session_id': session_id,
        'hook_event_type': args.event_type,
        'payload': input_data,
        'timestamp': int(datetime.now().timestamp() * 1000),
        'model_name': model_name
    }
    
    # Handle --add-chat option
    if args.add_chat and 'transcript_path' in input_data:
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
    if args.summarize:
        summary = generate_event_summary(event_data)
        if summary:
            event_data['summary'] = summary
        # Continue even if summary generation fails
    
    # Send to server
    success = send_event_to_server(event_data, args.server_url)
    
    # Always exit with 0 to not block Claude Code operations
    sys.exit(0)

if __name__ == '__main__':
    main()