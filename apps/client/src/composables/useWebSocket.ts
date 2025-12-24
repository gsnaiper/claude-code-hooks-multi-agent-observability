import { ref, onMounted, onUnmounted } from 'vue';
import type { EventSummary, WebSocketMessage } from '../types';

export function useWebSocket(url: string) {
  const events = ref<EventSummary[]>([]);
  const isConnected = ref(false);
  const error = ref<string | null>(null);
  
  let ws: WebSocket | null = null;
  let reconnectTimeout: number | null = null;
  
  // Get max events from environment variable or use default
  const maxEvents = parseInt(import.meta.env.VITE_MAX_EVENTS_TO_DISPLAY || '300');
  
  const connect = () => {
    try {
      ws = new WebSocket(url);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        isConnected.value = true;
        error.value = null;
      };
      
      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'initial') {
            const initialEvents = (Array.isArray(message.data) ? message.data : []) as EventSummary[];
            // Filter valid events and keep only the most recent up to maxEvents
            events.value = initialEvents
              .filter(e => e && e.id)
              .slice(-maxEvents);
          } else if (message.type === 'event') {
            const newEvent = message.data as EventSummary;
            // Only add if event has valid id
            if (newEvent && newEvent.id) {
              events.value.push(newEvent);

              // Limit events array to maxEvents, removing oldest in-place with splice
              if (events.value.length > maxEvents) {
                // Remove the oldest 10 events in-place
                events.value.splice(0, 10);
              }
            }
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };
      
      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        error.value = 'WebSocket connection error';
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        isConnected.value = false;
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeout = window.setTimeout(() => {
          console.log('Attempting to reconnect...');
          connect();
        }, 3000);
      };
    } catch (err) {
      console.error('Failed to connect:', err);
      error.value = 'Failed to connect to server';
    }
  };
  
  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    
    if (ws) {
      ws.close();
      ws = null;
    }
  };
  
  onMounted(() => {
    connect();
  });
  
  onUnmounted(() => {
    disconnect();
  });

  const clearEvents = () => {
    events.value = [];
  };

  return {
    events,
    isConnected,
    error,
    clearEvents
  };
}