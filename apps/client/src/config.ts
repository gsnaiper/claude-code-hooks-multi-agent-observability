// Centralized configuration for API and WebSocket URLs
// Uses relative URLs for gateway mode, with fallback for dev mode

// Determine WebSocket protocol based on page protocol
const wsProtocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173';

// API base - relative URL (goes through nginx proxy in production)
export const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// WebSocket URL - uses current host (goes through nginx proxy in production)
export const WS_URL = import.meta.env.VITE_WS_URL || `${wsProtocol}//${host}/stream`;
