#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = ["requests", "websockets", "python-dotenv", "redis"]
# ///

import json
import sys
import argparse
from pathlib import Path

# Add hooks dir to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from utils.event_sender import send_event_direct

# Handler registry - lazy loading
HANDLERS = {
    'PreToolUse': 'handlers.pre_tool_use:PreToolUseHandler',
    'PostToolUse': 'handlers.post_tool_use:PostToolUseHandler',
    'Notification': 'handlers.notification:NotificationHandler',
    'Stop': 'handlers.stop:StopHandler',
    'SubagentStop': 'handlers.subagent_stop:SubagentStopHandler',
    'SessionStart': 'handlers.session_start:SessionStartHandler',
    'SessionEnd': 'handlers.session_end:SessionEndHandler',
    'PreCompact': 'handlers.pre_compact:PreCompactHandler',
    'UserPromptSubmit': 'handlers.user_prompt_submit:UserPromptSubmitHandler',
}

def get_handler_class(event_type: str):
    """Lazy load handler class by event type."""
    if event_type not in HANDLERS:
        raise ValueError(f"Unknown event type: {event_type}")

    module_path, class_name = HANDLERS[event_type].rsplit(':', 1)
    module = __import__(module_path, fromlist=[class_name])
    return getattr(module, class_name)

def main():
    parser = argparse.ArgumentParser(description='Unified hooks router')
    parser.add_argument('--event-type', required=True, help='Hook event type')
    parser.add_argument('--server-url', default=None, help='Server URL for events')
    parser.add_argument('--auto-project-id', action='store_true')
    parser.add_argument('--source-app', help='Source app name')
    parser.add_argument('--add-chat', action='store_true', help='Include chat transcript')
    parser.add_argument('--summarize', action='store_true', help='Generate summary')
    # Handler-specific flags
    parser.add_argument('--notify', action='store_true', help='TTS notification')
    parser.add_argument('--load-context', action='store_true', help='Load dev context')
    parser.add_argument('--announce', action='store_true', help='Announce session events')
    parser.add_argument('--save-stats', action='store_true', help='Save session stats')
    parser.add_argument('--backup', action='store_true', help='Backup transcript')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    parser.add_argument('--name-agent', action='store_true', help='Generate agent name')
    parser.add_argument('--validate', action='store_true', help='Validate prompt')

    args = parser.parse_args()

    # Read stdin ONCE
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        print(f"Error parsing stdin JSON: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error reading stdin: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        # Get and instantiate handler
        handler_class = get_handler_class(args.event_type)
        handler = handler_class(args.event_type)

        # Execute handler
        result = handler.execute(input_data, args)

        # Output handler result if any
        if result.output:
            print(json.dumps(result.output))

        # Send event if handler requests it
        if result.should_send_event:
            options = {
                'event_type': args.event_type,
                'server_url': args.server_url,
                'add_chat': args.add_chat,
                'summarize': args.summarize,
                'auto_project_id': args.auto_project_id,
                'source_app': args.source_app,
            }
            options.update(result.send_event_options)
            send_event_direct(input_data, options)

        sys.exit(result.exit_code)

    except Exception as e:
        print(f"Router error: {e}", file=sys.stderr)
        # Don't block on router errors
        sys.exit(0)

if __name__ == '__main__':
    main()
