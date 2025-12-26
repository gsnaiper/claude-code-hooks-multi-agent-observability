import json
import socket
import asyncio
import os
from threading import Thread
from typing import Optional, Dict, Any, Literal
from pathlib import Path
import time

# Load .env for configuration
try:
    from dotenv import load_dotenv
    _env_path = Path.home() / '.claude' / '.env'
    if _env_path.exists():
        load_dotenv(_env_path)
except ImportError:
    pass  # dotenv not available, use defaults


def get_observability_url() -> str:
    """Get observability server URL from environment or default."""
    url = os.environ.get('OBSERVABILITY_SERVER_URL', 'http://localhost:4000/events')
    # Remove /events suffix if present (we add it when needed)
    return url.replace('/events', '').rstrip('/')


class HITLRequest:
    """Helper class for human-in-the-loop requests"""

    def __init__(
        self,
        question: str,
        hitl_type: Literal['question', 'permission', 'choice', 'approval'] = 'question',
        choices: Optional[list[str]] = None,
        context: Optional[Dict[str, Any]] = None,  # Additional context for approval
        timeout: int = 300,  # 5 minutes default
        observability_url: Optional[str] = None
    ):
        if observability_url is None:
            observability_url = get_observability_url()
        self.question = question
        self.hitl_type = hitl_type
        self.choices = choices
        self.context = context
        self.timeout = timeout
        self.observability_url = observability_url
        self.response_port = self._find_free_port()
        self.response_data: Optional[Dict[str, Any]] = None
        self.server_thread: Optional[Thread] = None

    def _find_free_port(self) -> int:
        """Find an available port for WebSocket server"""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('', 0))
            s.listen(1)
            port = s.getsockname()[1]
        return port

    def _start_response_server(self):
        """Start local WebSocket server to receive response"""
        try:
            from websockets.server import serve
        except ImportError:
            print("Warning: websockets package not installed. Install with: pip install websockets")
            return

        async def handle_connection(websocket):
            """Handle incoming response from observability server"""
            try:
                message = await websocket.recv()
                self.response_data = json.loads(message)
                await websocket.close()
            except Exception as e:
                print(f"Error receiving HITL response: {e}")

        async def start_server():
            try:
                async with serve(handle_connection, "localhost", self.response_port):
                    # Keep server running until response received or timeout
                    start_time = time.time()
                    while self.response_data is None:
                        await asyncio.sleep(0.1)
                        if time.time() - start_time > self.timeout:
                            break
            except Exception as e:
                print(f"Error starting WebSocket server: {e}")

        # Run server in event loop
        try:
            asyncio.run(start_server())
        except Exception as e:
            print(f"Error in response server: {e}")

    def get_hitl_data(self) -> Dict[str, Any]:
        """Get HITL data for inclusion in HookEvent"""
        data = {
            "question": self.question,
            "responseWebSocketUrl": f"ws://localhost:{self.response_port}",
            "type": self.hitl_type,
            "choices": self.choices,
            "timeout": self.timeout,
            "requiresResponse": True
        }
        if self.context:
            data["context"] = self.context
        return data

    def _poll_for_response(self, event_id: int) -> Optional[Dict[str, Any]]:
        """Poll server for HITL response using GET /events/:id/response with exponential backoff"""
        import urllib.request
        import urllib.error
        import random

        start_time = time.time()
        attempt = 0
        max_interval = 10.0  # Max wait between polls
        max_retries = 300  # Max number of poll attempts

        while time.time() - start_time < self.timeout and attempt < max_retries:
            attempt += 1
            try:
                url = f"{self.observability_url}/events/{event_id}/response"
                req = urllib.request.Request(url, method='GET')
                with urllib.request.urlopen(req, timeout=5) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    if data.get('success') and data.get('data'):
                        return data['data']
            except urllib.error.HTTPError as e:
                if e.code in (404, 202):
                    # No response yet (404 or 202 Accepted), continue polling
                    pass
                elif e.code in (400, 403, 405):
                    # Non-retryable errors - fail immediately
                    print(f"[HITL] Fatal HTTP error: {e.code}", file=__import__('sys').stderr)
                    return None
                elif e.code == 429:
                    # Rate limited - use longer backoff
                    time.sleep(min(30, 5 * (2 ** min(attempt, 4))))
                    continue
                else:
                    print(f"[HITL] HTTP error polling: {e.code}", file=__import__('sys').stderr)
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                print(f"[HITL] Invalid response format: {e}", file=__import__('sys').stderr)
            except urllib.error.URLError as e:
                print(f"[HITL] Network error: {e.reason}", file=__import__('sys').stderr)
            except Exception as e:
                print(f"[HITL] Unexpected error: {type(e).__name__}: {e}", file=__import__('sys').stderr)

            # Exponential backoff with jitter (1s, 2s, 4s... up to max_interval)
            backoff = min(max_interval, (2 ** min(attempt - 1, 4)) + random.uniform(0, 0.5))
            time.sleep(backoff)

        return None  # Timeout or max retries

    def send_and_wait(
        self,
        hook_event_data: Dict[str, Any],
        session_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Send HITL request and wait for response using polling.

        Args:
            hook_event_data: The hook event payload
            session_data: Session information (session_id, source_app, etc.)

        Returns:
            Response data or None if timeout
        """
        # Prepare complete event with HITL data
        event_payload = {
            **session_data,
            "hook_event_type": hook_event_data.get("hook_event_type", "HumanInTheLoop"),
            "payload": hook_event_data.get("payload", {}),
            "humanInTheLoop": self.get_hitl_data(),
            "timestamp": int(time.time() * 1000)
        }

        # Send to observability server
        event_id = None
        try:
            import requests
            response = requests.post(
                f"{self.observability_url}/events",
                json=event_payload,
                timeout=10
            )
            response.raise_for_status()
            # Extract event ID from response
            result = response.json()
            event_id = result.get('id')
        except ImportError:
            print("Warning: requests package not installed. Install with: pip install requests", file=__import__('sys').stderr)
            return None
        except Exception as e:
            print(f"[HITL] Failed to send request: {e}", file=__import__('sys').stderr)
            return None

        # Validate event_id is a positive integer
        if not isinstance(event_id, int) or event_id <= 0:
            print(f"[HITL] Invalid event ID returned: {event_id} (type: {type(event_id).__name__})", file=__import__('sys').stderr)
            return None

        # Small delay to ensure database write is committed
        time.sleep(0.1)

        # Poll for response
        return self._poll_for_response(event_id)


# Convenience functions
def ask_question(
    question: str,
    session_data: Dict[str, Any],
    timeout: int = 300
) -> Optional[str]:
    """Ask a question and wait for text response"""
    hitl = HITLRequest(question, hitl_type='question', timeout=timeout)
    response = hitl.send_and_wait(
        {"hook_event_type": "HumanInTheLoop", "payload": {}},
        session_data
    )
    return response.get("response") if response else None


def ask_permission(
    question: str,
    session_data: Dict[str, Any],
    timeout: int = 300
) -> bool:
    """Ask for permission and wait for yes/no response"""
    hitl = HITLRequest(question, hitl_type='permission', timeout=timeout)
    response = hitl.send_and_wait(
        {"hook_event_type": "HumanInTheLoop", "payload": {}},
        session_data
    )
    return response.get("permission", False) if response else False


def ask_choice(
    question: str,
    choices: list[str],
    session_data: Dict[str, Any],
    timeout: int = 300
) -> Optional[str]:
    """Ask user to choose from options"""
    hitl = HITLRequest(
        question,
        hitl_type='choice',
        choices=choices,
        timeout=timeout
    )
    response = hitl.send_and_wait(
        {"hook_event_type": "HumanInTheLoop", "payload": {}},
        session_data
    )
    return response.get("choice") if response else None


# ApprovalResponse type for type hints
class ApprovalResponse:
    """Response from ask_approval()"""
    def __init__(self, approved: bool, comment: Optional[str] = None):
        self.approved = approved
        self.comment = comment

    def __bool__(self):
        return self.approved


def ask_approval(
    question: str,
    session_data: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    hook_event_type: str = "PreToolUse",
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 300
) -> ApprovalResponse:
    """
    Ask for approval with optional comment (voice or text input).

    Use for pre-hooks that need human approval before continuing.

    Args:
        question: The approval question to show (e.g., "Allow rm -rf command?")
        session_data: Session information (session_id, source_app, etc.)
        context: Additional context (e.g., tool_name, command details)
        hook_event_type: The hook event type (default: PreToolUse)
        payload: The original hook payload
        timeout: Timeout in seconds (default: 5 minutes)

    Returns:
        ApprovalResponse with .approved (bool) and .comment (optional str)

    Example:
        result = ask_approval(
            "Allow dangerous rm -rf command?",
            session_data,
            context={"tool_name": "Bash", "command": "rm -rf /tmp/test"},
            payload=original_payload
        )
        if result.approved:
            print(f"Approved! Comment: {result.comment}")
            sys.exit(0)  # Allow
        else:
            print(f"Denied. Reason: {result.comment}")
            sys.exit(2)  # Block
    """
    hitl = HITLRequest(
        question,
        hitl_type='approval',
        context=context,
        timeout=timeout
    )
    response = hitl.send_and_wait(
        {"hook_event_type": hook_event_type, "payload": payload or {}},
        session_data
    )

    if response:
        return ApprovalResponse(
            approved=response.get("approved", False),
            comment=response.get("comment")
        )

    # Timeout or error - deny by default
    return ApprovalResponse(approved=False, comment="Timeout - no response received")


# QuestionResponse type for ask_question_via_hitl
class QuestionInputResponse:
    """Response from ask_question_via_hitl()"""
    def __init__(self, answered: bool, response: Optional[str] = None, cancelled: bool = False):
        self.answered = answered
        self.response = response
        self.cancelled = cancelled

    def __bool__(self):
        return self.answered and self.response is not None


def ask_question_via_hitl(
    question: str,
    session_data: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
    hook_event_type: str = "PreToolUse",
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 300
) -> QuestionInputResponse:
    """
    Redirect Claude's AskUserQuestion to the observability UI with voice input support.

    This intercepts questions Claude wants to ask and routes them through
    the HITL system so users can respond via the dashboard with voice or text.

    Args:
        question: The question Claude wants to ask the user
        session_data: Session information (session_id, source_app, etc.)
        context: Additional context (e.g., question options, type)
        hook_event_type: The hook event type (default: PreToolUse)
        payload: The original hook payload
        timeout: Timeout in seconds (default: 5 minutes)

    Returns:
        QuestionInputResponse with .answered (bool), .response (str), .cancelled (bool)

    Example:
        result = ask_question_via_hitl(
            "Which database should I use for this project?",
            session_data,
            context={"options": ["PostgreSQL", "MySQL", "MongoDB"]},
            payload=original_payload
        )
        if result.answered:
            print(f"User answered: {result.response}")
            # Return the answer to Claude
        elif result.cancelled:
            print("User cancelled the question")
            sys.exit(2)  # Block the tool
    """
    hitl = HITLRequest(
        question,
        hitl_type='question_input',
        context=context,
        timeout=timeout
    )
    response = hitl.send_and_wait(
        {"hook_event_type": hook_event_type, "payload": payload or {}},
        session_data
    )

    if response:
        # Check if user cancelled
        if response.get("cancelled", False):
            return QuestionInputResponse(
                answered=False,
                response=None,
                cancelled=True
            )

        # User provided a response
        user_response = response.get("response")
        if user_response:
            return QuestionInputResponse(
                answered=True,
                response=user_response,
                cancelled=False
            )

    # Timeout or error
    return QuestionInputResponse(
        answered=False,
        response=None,
        cancelled=False
    )
