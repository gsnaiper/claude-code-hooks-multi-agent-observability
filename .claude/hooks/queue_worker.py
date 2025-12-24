#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#     "redis",
#     "python-dotenv",
# ]
# ///

"""
Event Queue Worker for Claude Code Hooks.
Processes events from Redis Streams and forwards them to the observability server.

Features:
- Consumer group based processing (at-least-once delivery)
- Automatic retry with exponential backoff
- Dead letter queue for failed events
- Stale event recovery from crashed workers
- Graceful shutdown handling

Usage:
    uv run queue_worker.py [--consumer CONSUMER_ID] [--batch-size N]
"""

import json
import sys
import os
import time
import signal
import argparse
import urllib.request
import urllib.error
import random
from datetime import datetime
from typing import Optional, Tuple

# Add utils to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils.redis_cache import get_hook_cache

# Configuration
DEFAULT_STREAM = "hook_events"
DEFAULT_GROUP = "event_processors"
DEFAULT_SERVER_URL = "http://localhost:4000/events"
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # seconds
STALE_CHECK_INTERVAL = 60  # seconds
STALE_THRESHOLD_MS = 300000  # 5 minutes

# Global shutdown flag
shutdown_requested = False


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global shutdown_requested
    print(f"\n[QueueWorker] Shutdown requested (signal {signum})")
    shutdown_requested = True


def send_event_to_server(event_data: dict, server_url: str) -> bool:
    """Send event to the observability server."""
    try:
        req = urllib.request.Request(
            server_url,
            data=json.dumps(event_data).encode('utf-8'),
            headers={
                'Content-Type': 'application/json',
                'User-Agent': 'Claude-Queue-Worker/1.0'
            }
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status == 200

    except urllib.error.URLError as e:
        print(f"[QueueWorker] Server error: {e}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[QueueWorker] Unexpected error: {e}", file=sys.stderr)
        return False


def parse_event_data(raw_data: dict) -> dict:
    """Parse event data from Redis (strings back to proper types)."""
    parsed = {}
    for key, value in raw_data.items():
        try:
            # Try to parse JSON values
            parsed[key] = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            parsed[key] = value
    return parsed


def move_to_dlq(cache, event_id: str, event_data: dict, error: str):
    """Move failed event to dead letter queue."""
    dlq_stream = f"{DEFAULT_STREAM}_dlq"
    dlq_data = {
        'original_id': event_id,
        'error': error,
        'failed_at': datetime.now().isoformat(),
        **event_data
    }
    cache.queue_event(dlq_data, stream=dlq_stream)
    print(f"[QueueWorker] Moved to DLQ: {event_id}")


def process_event(cache, event_id: str, event_data: dict, server_url: str) -> Tuple[bool, bool]:
    """
    Process a single event with retry logic.

    Returns:
        Tuple of (success, should_requeue):
        - (True, False) = processed successfully
        - (False, False) = failed, move to DLQ
        - (False, True) = interrupted, should re-queue for later
    """
    parsed_data = parse_event_data(event_data)

    for attempt in range(MAX_RETRIES):
        if shutdown_requested:
            # Shutdown requested - signal to re-queue this event
            print(f"[QueueWorker] Shutdown during processing, will re-queue {event_id}")
            return (False, True)

        if send_event_to_server(parsed_data, server_url):
            return (True, False)

        # Exponential backoff with jitter to prevent thundering herd
        if attempt < MAX_RETRIES - 1:
            base_wait = RETRY_BACKOFF_BASE ** attempt
            jitter = base_wait * (0.5 + random.random())  # 50-150% of base
            wait_time = base_wait + jitter
            print(f"[QueueWorker] Retry {attempt + 1}/{MAX_RETRIES} in {wait_time:.1f}s")
            time.sleep(wait_time)

    return (False, False)


def run_worker(
    consumer_id: str,
    batch_size: int = 10,
    server_url: str = DEFAULT_SERVER_URL
):
    """Main worker loop."""
    global shutdown_requested

    cache = get_hook_cache()

    if not cache.is_redis_available:
        print("[QueueWorker] Redis not available, exiting")
        sys.exit(1)

    # Ensure consumer group exists
    if not cache.ensure_consumer_group(DEFAULT_STREAM, DEFAULT_GROUP):
        print("[QueueWorker] Failed to create consumer group")
        sys.exit(1)

    print(f"[QueueWorker] Started: consumer={consumer_id}, batch={batch_size}")
    print(f"[QueueWorker] Server: {server_url}")

    last_stale_check = time.time()
    events_processed = 0
    events_failed = 0
    events_requeued = 0

    def process_single_event(event_id: str, event_data: dict) -> None:
        """Process a single event with proper ACK ordering."""
        nonlocal events_processed, events_failed, events_requeued

        success, should_requeue = process_event(cache, event_id, event_data, server_url)

        if success:
            cache.ack_event(event_id, DEFAULT_STREAM, DEFAULT_GROUP)
            events_processed += 1
        elif should_requeue:
            # Shutdown requested - don't ACK, event will be reprocessed
            # The event stays in pending state for another worker to pick up
            events_requeued += 1
        else:
            # Failed after retries - ACK first, then move to DLQ
            # This order prevents duplicate DLQ entries if DLQ write fails
            cache.ack_event(event_id, DEFAULT_STREAM, DEFAULT_GROUP)
            move_to_dlq(cache, event_id, event_data, "Max retries exceeded")
            events_failed += 1

    while not shutdown_requested:
        try:
            # Periodically check for stale events from crashed workers
            if time.time() - last_stale_check > STALE_CHECK_INTERVAL:
                stale_events = cache.claim_stale_events(
                    stream=DEFAULT_STREAM,
                    group=DEFAULT_GROUP,
                    consumer=consumer_id,
                    min_idle_ms=STALE_THRESHOLD_MS
                )
                if stale_events:
                    print(f"[QueueWorker] Claimed {len(stale_events)} stale events, processing...")
                    # Actually process the claimed stale events
                    for event_id, event_data in stale_events:
                        if shutdown_requested:
                            break
                        process_single_event(event_id, event_data)
                last_stale_check = time.time()

            # Read new events (blocking with timeout)
            events = cache.consume_events(
                stream=DEFAULT_STREAM,
                group=DEFAULT_GROUP,
                consumer=consumer_id,
                count=batch_size,
                block_ms=5000
            )

            if not events:
                continue

            for event_id, event_data in events:
                if shutdown_requested:
                    break
                process_single_event(event_id, event_data)

        except KeyboardInterrupt:
            shutdown_requested = True
        except Exception as e:
            print(f"[QueueWorker] Error: {e}", file=sys.stderr)
            time.sleep(1)  # Prevent tight loop on persistent errors

    print(f"\n[QueueWorker] Shutdown complete")
    print(f"[QueueWorker] Processed: {events_processed}, Failed: {events_failed}, Requeued: {events_requeued}")


def show_status():
    """Show queue status and pending events."""
    cache = get_hook_cache()

    if not cache.is_redis_available:
        print("[QueueWorker] Redis not available")
        return

    # Stream info
    info = cache.get_stream_info(DEFAULT_STREAM)
    if info:
        print(f"\nStream: {DEFAULT_STREAM}")
        print(f"  Length: {info['length']}")
        print(f"  Groups: {info['groups']}")
    else:
        print(f"\nStream {DEFAULT_STREAM} not found")

    # Pending events
    pending = cache.get_pending_events(DEFAULT_STREAM, DEFAULT_GROUP)
    if pending:
        print(f"\nPending events ({len(pending)}):")
        for p in pending[:10]:
            print(f"  {p['id']}: consumer={p['consumer']}, idle={p['idle_time_ms']}ms, deliveries={p['delivery_count']}")
        if len(pending) > 10:
            print(f"  ... and {len(pending) - 10} more")
    else:
        print("\nNo pending events")

    # DLQ info
    dlq_info = cache.get_stream_info(f"{DEFAULT_STREAM}_dlq")
    if dlq_info:
        print(f"\nDead Letter Queue: {dlq_info['length']} events")


def main():
    parser = argparse.ArgumentParser(description='Event Queue Worker')
    parser.add_argument('--consumer', default=f"worker-{os.getpid()}",
                       help='Consumer ID (default: worker-PID)')
    parser.add_argument('--batch-size', type=int, default=10,
                       help='Batch size for reading events')
    parser.add_argument('--server-url', default=DEFAULT_SERVER_URL,
                       help='Observability server URL')
    parser.add_argument('--status', action='store_true',
                       help='Show queue status and exit')

    args = parser.parse_args()

    if args.status:
        show_status()
        return

    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    run_worker(
        consumer_id=args.consumer,
        batch_size=args.batch_size,
        server_url=args.server_url
    )


if __name__ == '__main__':
    main()
