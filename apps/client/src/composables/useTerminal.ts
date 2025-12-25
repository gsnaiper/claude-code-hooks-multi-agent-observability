import { ref, onUnmounted, computed } from 'vue';

export interface UseTerminalOptions {
  sessionId: string;
  cols?: number;
  rows?: number;
  onData?: (data: string) => void;
  onStatusChange?: (status: TerminalStatus) => void;
}

export type TerminalStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'agent_offline';

interface TerminalMessage {
  type: 'terminal:output' | 'terminal:status' | 'terminal:error';
  session_id?: string;
  data?: string; // raw string for output
  status?: 'connected' | 'disconnected' | 'error' | 'connecting';
  message?: string;
  error?: string;
  connection_type?: string;
  agent_id?: string;
}

export function useTerminal(options: UseTerminalOptions) {
  const {
    sessionId,
    cols = 80,
    rows = 24,
    onData,
    onStatusChange,
  } = options;

  // State
  const status = ref<TerminalStatus>('disconnected');
  const error = ref<string | null>(null);

  // WebSocket connection
  let ws: WebSocket | null = null;
  let reconnectTimeout: number | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const reconnectDelay = 3000;

  // Computed
  const isConnected = computed(() => status.value === 'connected');

  /**
   * Get terminal WebSocket URL from environment
   * Replaces /stream path with /terminal
   */
  function getTerminalUrl(): string {
    const wsUrl = import.meta.env.VITE_WS_URL || 'wss://cli.di4.dev/stream';
    // Replace /stream with /terminal
    return wsUrl.replace(/\/stream$/, '/terminal');
  }

  /**
   * Update status and notify callback
   */
  function updateStatus(newStatus: TerminalStatus) {
    status.value = newStatus;
    if (onStatusChange) {
      onStatusChange(newStatus);
    }
  }

  /**
   * Connect to terminal WebSocket
   */
  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      console.log('Terminal WebSocket already connected or connecting');
      return;
    }

    try {
      const url = getTerminalUrl();
      console.log(`Connecting to terminal WebSocket: ${url}`);

      updateStatus('connecting');
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('Terminal WebSocket connected');
        updateStatus('connected');
        error.value = null;
        reconnectAttempts = 0;

        // Send terminal:connect message with session info
        const connectMessage = {
          type: 'terminal:connect',
          session_id: sessionId,
          project_id: sessionId.split(':')[0], // TODO: Pass proper project_id
          cols,
          rows,
        };

        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(connectMessage));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: TerminalMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'terminal:output':
              // Pass raw string output to callback (server sends UTF-8, not base64)
              if (message.data && onData) {
                onData(message.data);
              }
              break;

            case 'terminal:status':
              // Update status from server
              if (message.status) {
                // Map server status to our TerminalStatus type
                const mappedStatus: TerminalStatus =
                  message.status === 'connecting' ? 'connecting' :
                  message.status === 'connected' ? 'connected' :
                  message.status === 'error' ? 'error' : 'disconnected';
                updateStatus(mappedStatus);
              }
              break;

            case 'terminal:error':
              // Handle error from server
              console.error('Terminal error:', message.error);
              error.value = message.error || 'Unknown terminal error';
              updateStatus('error');
              break;

            default:
              console.warn('Unknown terminal message type:', message);
          }
        } catch (err) {
          console.error('Failed to parse terminal WebSocket message:', err);
          error.value = 'Failed to parse server message';
        }
      };

      ws.onerror = (err) => {
        console.error('Terminal WebSocket error:', err);
        error.value = 'WebSocket connection error';
        updateStatus('error');
      };

      ws.onclose = () => {
        console.log('Terminal WebSocket disconnected');
        updateStatus('disconnected');

        // Attempt to reconnect if not at max attempts
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);

          reconnectTimeout = window.setTimeout(() => {
            connect();
          }, reconnectDelay);
        } else {
          console.log('Max reconnect attempts reached');
          error.value = 'Failed to reconnect to terminal';
        }
      };
    } catch (err) {
      console.error('Failed to connect to terminal:', err);
      error.value = 'Failed to connect to terminal server';
      updateStatus('error');
    }
  }

  /**
   * Disconnect from terminal WebSocket
   */
  function disconnect() {
    // Clear reconnect timeout
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    // Reset reconnect attempts
    reconnectAttempts = maxReconnectAttempts; // Prevent auto-reconnect

    // Close WebSocket
    if (ws) {
      ws.close();
      ws = null;
    }

    updateStatus('disconnected');
  }

  /**
   * Send input to terminal (raw string, server expects UTF-8)
   */
  function sendInput(data: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send input: WebSocket not connected');
      return;
    }

    try {
      const message = {
        type: 'terminal:input',
        session_id: sessionId,
        data: data,
      };

      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('Failed to send terminal input:', err);
      error.value = 'Failed to send input';
    }
  }

  /**
   * Resize terminal
   */
  function resize(newCols: number, newRows: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot resize: WebSocket not connected');
      return;
    }

    try {
      const message = {
        type: 'terminal:resize',
        session_id: sessionId,
        cols: newCols,
        rows: newRows,
      };

      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error('Failed to resize terminal:', err);
      error.value = 'Failed to resize terminal';
    }
  }

  // Cleanup on component unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    status,
    error,
    isConnected,
    connect,
    disconnect,
    sendInput,
    resize,
  };
}
