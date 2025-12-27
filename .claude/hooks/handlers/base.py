#!/usr/bin/env python3
"""
Base handler class for unified hooks router.
All hook handlers inherit from BaseHookHandler.
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class HandlerResult:
    """Result from handler execution."""
    exit_code: int = 0  # 0=allow, 2=block
    output: Optional[Dict[str, Any]] = None  # JSON output for Claude
    should_send_event: bool = True
    send_event_options: Dict[str, Any] = field(default_factory=dict)


class BaseHookHandler(ABC):
    """Abstract base class for all hook handlers."""

    def __init__(self, event_type: str, timeout: int = 10):
        self.event_type = event_type
        self.timeout = timeout
        self._result = HandlerResult()

    @abstractmethod
    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """
        Execute handler logic.

        Args:
            input_data: JSON data from stdin (parsed once by router)
            args: Parsed CLI arguments from router

        Returns:
            HandlerResult with exit_code, optional output, and event options
        """
        pass

    def get_session_id(self, input_data: Dict[str, Any]) -> str:
        """Extract session_id from input data."""
        return input_data.get('session_id', 'unknown')

    def get_tool_name(self, input_data: Dict[str, Any]) -> str:
        """Extract tool_name from input data (for tool hooks)."""
        return input_data.get('tool_name', '')

    def get_tool_input(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract tool_input from input data (for tool hooks)."""
        return input_data.get('tool_input', {})

    def allow(self, output: Optional[Dict] = None) -> HandlerResult:
        """Allow tool execution, optionally with modified output."""
        return HandlerResult(
            exit_code=0,
            output=output,
            should_send_event=True,
            send_event_options=self._result.send_event_options
        )

    def block(self, reason: str) -> HandlerResult:
        """Block tool execution with reason."""
        return HandlerResult(
            exit_code=0,  # Exit 0 but with deny output
            output={
                "hookSpecificOutput": {
                    "hookEventName": self.event_type,
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason
                }
            },
            should_send_event=True,
            send_event_options=self._result.send_event_options
        )

    def set_send_event_options(self, **kwargs):
        """Set options for send_event (add_chat, summarize, etc)."""
        self._result.send_event_options.update(kwargs)


class SimpleHookHandler(BaseHookHandler):
    """
    Base class for simple hooks that just log and send events.
    Used for: Notification, PostToolUse, SessionStart, SessionEnd, etc.
    """

    def execute(self, input_data: Dict[str, Any], args: Any) -> HandlerResult:
        """Default implementation: log and allow."""
        self.log_event(input_data)
        return self.allow()

    def log_event(self, input_data: Dict[str, Any]):
        """Override to implement custom logging."""
        pass
