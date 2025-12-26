<template>
  <div class="terminal-viewer">
    <div class="terminal-header">
      <span class="status-indicator" :class="statusClass"></span>
      <span class="status-text">{{ statusText }}</span>
      <button @click="toggleConnection" class="connection-toggle">
        {{ isConnected ? 'Disconnect' : 'Connect' }}
      </button>
    </div>
    <div ref="terminalRef" class="terminal-container"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTerminal } from '../composables/useTerminal';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// Props
interface Props {
  sessionId: string;
  initialCols?: number;
  initialRows?: number;
}

const props = withDefaults(defineProps<Props>(), {
  initialCols: 80,
  initialRows: 24,
});

// Emits
const emit = defineEmits<{
  connected: [];
  disconnected: [];
  error: [error: string];
}>();

// Refs
const terminalRef = ref<HTMLDivElement | null>(null);

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;

// Terminal composable
const {
  status,
  error,
  isConnected,
  connect,
  disconnect,
  sendInput,
  resize,
} = useTerminal({
  sessionId: props.sessionId,
  cols: props.initialCols,
  rows: props.initialRows,
  onData: (data: string) => {
    // Write data to terminal
    if (terminal) {
      terminal.write(data);
    }
  },
  onStatusChange: (newStatus) => {
    console.log('[TerminalViewer] Status changed:', newStatus);

    // Emit events based on status
    if (newStatus === 'connected') {
      emit('connected');
    } else if (newStatus === 'disconnected') {
      emit('disconnected');
    } else if (newStatus === 'error') {
      emit('error', error.value || 'Unknown error');
    }
  },
});

// Computed
const statusClass = computed(() => {
  switch (status.value) {
    case 'connected':
      return 'status-connected';
    case 'connecting':
      return 'status-connecting';
    case 'error':
    case 'agent_offline':
      return 'status-error';
    case 'disconnected':
    default:
      return 'status-disconnected';
  }
});

const statusText = computed(() => {
  switch (status.value) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    case 'error':
      return `Error: ${error.value || 'Connection failed'}`;
    case 'agent_offline':
      return 'Agent Offline';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
});

// Methods
function toggleConnection() {
  if (isConnected.value) {
    disconnect();
  } else {
    connect();
  }
}

function handleTerminalResize() {
  if (terminal && fitAddon) {
    fitAddon.fit();
    const { cols, rows } = terminal;
    resize(cols, rows);
  }
}

// Lifecycle
onMounted(() => {
  // Initialize xterm.js terminal
  if (!terminalRef.value) {
    console.error('[TerminalViewer] Terminal container ref not available');
    return;
  }

  // Create terminal instance
  terminal = new Terminal({
    cursorBlink: true,
    theme: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#d4d4d4',
      cursorAccent: '#1e1e1e',
      selectionBackground: 'rgba(255, 255, 255, 0.3)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#e5e5e5',
    },
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    cols: props.initialCols,
    rows: props.initialRows,
  });

  // Create and load FitAddon
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  // Open terminal in container
  terminal.open(terminalRef.value);

  // Fit terminal to container
  fitAddon.fit();

  // Handle user input from terminal
  terminal.onData((data: string) => {
    sendInput(data);
  });

  // Handle terminal resize
  const resizeObserver = new ResizeObserver(() => {
    handleTerminalResize();
  });
  resizeObserver.observe(terminalRef.value);

  // Store observer for cleanup
  (terminal as any)._resizeObserver = resizeObserver;

  // Auto-connect on mount
  connect();
});

onUnmounted(() => {
  // Cleanup terminal
  if (terminal) {
    const resizeObserver = (terminal as any)._resizeObserver;
    if (resizeObserver && terminalRef.value) {
      resizeObserver.unobserve(terminalRef.value);
    }
    terminal.dispose();
    terminal = null;
  }
  fitAddon = null;

  // Disconnect is handled by useTerminal composable's onUnmounted
});
</script>

<style scoped>
.terminal-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #1e1e1e;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #333;
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background-color: #252526;
  border-bottom: 1px solid #333;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-connected {
  background-color: #0dbc79;
  box-shadow: 0 0 8px rgba(13, 188, 121, 0.6);
}

.status-connecting {
  background-color: #e5e510;
  box-shadow: 0 0 8px rgba(229, 229, 16, 0.6);
  animation: pulse 1.5s ease-in-out infinite;
}

.status-error,
.status-disconnected {
  background-color: #cd3131;
  box-shadow: 0 0 8px rgba(205, 49, 49, 0.6);
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.status-text {
  flex: 1;
  color: #d4d4d4;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.connection-toggle {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #ffffff;
  background-color: #0e639c;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.connection-toggle:hover {
  background-color: #1177bb;
}

.connection-toggle:active {
  background-color: #0d5a8f;
}

.terminal-container {
  flex: 1;
  background-color: #1e1e1e;
  overflow: hidden;
  position: relative;
}

/* Ensure xterm.js terminal fills container when loaded */
.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 8px;
}

.terminal-container :deep(.xterm-viewport) {
  overflow-y: auto;
}

.terminal-container :deep(.xterm-screen) {
  height: 100%;
}
</style>
