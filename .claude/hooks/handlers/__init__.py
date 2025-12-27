"""
Hook handlers package.
Each handler processes a specific event type.
"""
from .base import BaseHookHandler, SimpleHookHandler, HandlerResult

__all__ = [
    'BaseHookHandler',
    'SimpleHookHandler',
    'HandlerResult',
]
