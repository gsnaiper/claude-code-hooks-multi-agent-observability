import { ref, reactive } from 'vue';
import type { HookEvent } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Cache for event details (persists across component instances)
const eventCache = reactive<Map<number, HookEvent>>(new Map());
const loadingEvents = reactive<Set<number>>(new Set());

export function useEventDetail() {
  const error = ref<string | null>(null);

  /**
   * Fetch full event detail by ID.
   * Returns cached value if available.
   */
  async function fetchEventDetail(eventId: number): Promise<HookEvent | null> {
    // Return cached value if exists
    if (eventCache.has(eventId)) {
      return eventCache.get(eventId)!;
    }

    // Don't fetch if already loading
    if (loadingEvents.has(eventId)) {
      return null;
    }

    loadingEvents.add(eventId);
    error.value = null;

    try {
      const response = await fetch(`${API_BASE}/events/${eventId}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch event: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch event');
      }

      const event = result.data as HookEvent;
      eventCache.set(eventId, event);
      return event;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch event';
      return null;
    } finally {
      loadingEvents.delete(eventId);
    }
  }

  /**
   * Check if an event is currently being loaded.
   */
  function isLoading(eventId: number): boolean {
    return loadingEvents.has(eventId);
  }

  /**
   * Get cached event detail if available.
   */
  function getCached(eventId: number): HookEvent | undefined {
    return eventCache.get(eventId);
  }

  /**
   * Clear the event cache.
   */
  function clearCache(): void {
    eventCache.clear();
  }

  /**
   * Remove a specific event from cache.
   */
  function invalidate(eventId: number): void {
    eventCache.delete(eventId);
  }

  return {
    fetchEventDetail,
    isLoading,
    getCached,
    clearCache,
    invalidate,
    error
  };
}
