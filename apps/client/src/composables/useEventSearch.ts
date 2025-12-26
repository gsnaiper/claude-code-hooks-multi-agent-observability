import { ref, computed } from 'vue';
import type { EventSummary } from '../types';

export function useEventSearch() {
  const searchPattern = ref<string>('');
  const searchError = ref<string>('');

  // Validate regex pattern
  const validateRegex = (pattern: string): { valid: boolean; error?: string } => {
    if (!pattern || pattern.trim() === '') {
      return { valid: true };
    }

    try {
      new RegExp(pattern);
      return { valid: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid regex pattern';
      return { valid: false, error: errorMessage };
    }
  };

  // Extract searchable text from event
  const getSearchableText = (event: EventSummary): string => {
    const parts: string[] = [];

    // Event type
    if (event.hook_event_type) {
      parts.push(event.hook_event_type);
    }

    // Source app and session
    if (event.source_app) {
      parts.push(event.source_app);
    }
    if (event.session_id) {
      parts.push(event.session_id);
    }

    // Model name
    if (event.model_name) {
      parts.push(event.model_name);
    }

    // Tool information
    if (event.tool_name) {
      parts.push(event.tool_name);
    }
    if (event.tool_command) {
      parts.push(event.tool_command);
    }
    if (event.tool_file_path) {
      parts.push(event.tool_file_path);
    }

    // Summary text
    if (event.summary) {
      parts.push(event.summary);
    }

    // HITL type
    if (event.hitl_type) {
      parts.push(event.hitl_type);
    }

    return parts.join(' ').toLowerCase();
  };

  // Get value for a specific field from event
  const getFieldValue = (event: EventSummary, field: string): string | undefined => {
    const fieldMap: Record<string, () => string | undefined> = {
      source_app: () => event.source_app,
      session_id: () => event.session_id,
      hook_event_type: () => event.hook_event_type,
      tool_name: () => event.tool_name,
      model_name: () => event.model_name ?? undefined,
      tool_command: () => event.tool_command ?? undefined,
      tool_file_path: () => event.tool_file_path ?? undefined,
      summary: () => event.summary ?? undefined,
      hitl_type: () => event.hitl_type ?? undefined,
    };
    return fieldMap[field]?.();
  };

  // Check if event matches a single condition (field:value or regex)
  const matchesSingleCondition = (event: EventSummary, condition: string): boolean => {
    // Check for field:value syntax
    const fieldMatch = condition.match(/^(\w+):(.+)$/);
    if (fieldMatch) {
      const [, field, value] = fieldMatch;
      const eventValue = getFieldValue(event, field);
      if (!eventValue) return false;
      return eventValue.toLowerCase().includes(value.toLowerCase());
    }

    // Regular regex on all fields
    const validation = validateRegex(condition);
    if (!validation.valid) return false;

    try {
      const regex = new RegExp(condition, 'i');
      const searchableText = getSearchableText(event);
      return regex.test(searchableText);
    } catch {
      return false;
    }
  };

  // Check if event matches pattern (supports space-separated conditions with AND logic)
  const matchesPattern = (event: EventSummary, pattern: string): boolean => {
    if (!pattern || pattern.trim() === '') {
      return true;
    }

    // Split by spaces to get individual conditions
    const conditions = pattern.split(/\s+/).filter(Boolean);

    // All conditions must match (AND logic)
    for (const condition of conditions) {
      if (!matchesSingleCondition(event, condition)) {
        return false;
      }
    }

    return true;
  };

  // Filter events by pattern
  const searchEvents = (events: EventSummary[], pattern: string): EventSummary[] => {
    if (!pattern || pattern.trim() === '') {
      return events;
    }

    return events.filter(event => matchesPattern(event, pattern));
  };

  // Computed property for current error
  const hasError = computed(() => searchError.value.length > 0);

  // Update search pattern and validate
  const updateSearchPattern = (pattern: string) => {
    searchPattern.value = pattern;

    if (!pattern || pattern.trim() === '') {
      searchError.value = '';
      return;
    }

    const validation = validateRegex(pattern);
    if (!validation.valid) {
      searchError.value = validation.error || 'Invalid regex pattern';
    } else {
      searchError.value = '';
    }
  };

  // Clear search
  const clearSearch = () => {
    searchPattern.value = '';
    searchError.value = '';
  };

  return {
    searchPattern,
    searchError,
    hasError,
    validateRegex,
    matchesPattern,
    searchEvents,
    updateSearchPattern,
    clearSearch,
    getSearchableText
  };
}
