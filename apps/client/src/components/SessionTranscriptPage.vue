<template>
  <div class="h-screen flex flex-col bg-[var(--theme-bg-primary)]">
    <!-- Header -->
    <div class="flex-shrink-0 bg-[var(--theme-bg-secondary)] border-b border-[var(--theme-border-primary)] p-4 mobile:p-3">
      <div class="flex items-center justify-between mb-4 mobile:mb-2">
        <h1 class="text-2xl mobile:text-lg font-semibold text-[var(--theme-text-primary)]">
          Session Transcript
        </h1>
        <div class="flex items-center gap-2">
          <span v-if="sessionInfo" class="text-sm text-[var(--theme-text-secondary)]">
            {{ sessionInfo.eventCount }} events
          </span>
          <span class="text-xs text-[var(--theme-text-tertiary)] font-mono">
            {{ sessionId.slice(0, 8) }}
          </span>
        </div>
      </div>

      <!-- Search and Filters -->
      <div class="space-y-3">
        <!-- Search Input -->
        <div class="flex gap-2">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              @keyup.enter="executeSearch"
              type="text"
              placeholder="Search transcript..."
              class="w-full px-4 py-2 mobile:px-3 mobile:py-2 pl-10 mobile:pl-8 text-base border border-[var(--theme-border-secondary)] rounded-lg focus:ring-2 focus:ring-[var(--theme-primary)] focus:border-[var(--theme-primary)] bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)]"
            >
            <svg class="absolute left-3 top-2.5 w-5 h-5 text-[var(--theme-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button
            @click="executeSearch"
            class="px-4 py-2 bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] text-white font-medium rounded-lg transition-colors"
          >
            Search
          </button>
          <button
            @click="copyAllMessages"
            class="px-4 py-2 bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-border-primary)] text-[var(--theme-text-primary)] font-medium rounded-lg transition-colors border border-[var(--theme-border-secondary)]"
            title="Copy all messages as JSON"
          >
            {{ copyButtonText }}
          </button>
        </div>

        <!-- Filters -->
        <div class="flex flex-wrap gap-2 mobile:gap-1 max-h-20 overflow-y-auto p-2 bg-[var(--theme-bg-tertiary)] rounded-lg">
          <button
            v-for="filter in filters"
            :key="filter.type"
            @click="toggleFilter(filter.type)"
            class="px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap"
            :class="activeFilters.includes(filter.type)
              ? 'bg-[var(--theme-primary)] text-white'
              : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-border-primary)]'"
          >
            <span class="mr-1">{{ filter.icon }}</span>
            {{ filter.label }}
          </button>

          <!-- Clear Filters -->
          <button
            v-if="searchQuery || activeSearchQuery || activeFilters.length > 0"
            @click="clearSearch"
            class="px-3 py-1.5 rounded-full text-sm font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30"
          >
            Clear All
          </button>
        </div>

        <!-- Results Count -->
        <div v-if="activeSearchQuery || activeFilters.length > 0" class="text-sm text-[var(--theme-text-secondary)]">
          Showing {{ filteredChat.length }} of {{ allChatMessages.length }} messages
          <span v-if="activeSearchQuery" class="ml-2 font-medium">
            (searching for "{{ activeSearchQuery }}")
          </span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex-1 flex items-center justify-center">
      <div class="text-[var(--theme-text-secondary)]">Loading transcript...</div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-red-500">{{ error }}</div>
    </div>

    <!-- Empty -->
    <div v-else-if="allChatMessages.length === 0" class="flex-1 flex items-center justify-center">
      <div class="text-[var(--theme-text-tertiary)]">No chat messages in this session</div>
    </div>

    <!-- Content -->
    <div v-else class="flex-1 p-4 mobile:p-3 overflow-hidden flex flex-col">
      <ChatTranscript :chat="filteredChat" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import ChatTranscript from './ChatTranscript.vue';
import { API_BASE_URL } from '../config';
import type { HookEvent, ProjectSession } from '../types';

const props = defineProps<{
  sessionId: string;
}>();

const isLoading = ref(true);
const error = ref<string | null>(null);
const events = ref<HookEvent[]>([]);
const sessionInfo = ref<ProjectSession | null>(null);
const searchQuery = ref('');
const activeSearchQuery = ref('');
const activeFilters = ref<string[]>([]);
const copyButtonText = ref('Copy All');

const filters = [
  { type: 'user', label: 'User', icon: '' },
  { type: 'assistant', label: 'Assistant', icon: '' },
  { type: 'system', label: 'System', icon: '' },
  { type: 'tool_use', label: 'Tool Use', icon: '' },
  { type: 'tool_result', label: 'Tool Result', icon: '' },
  { type: 'Read', label: 'Read', icon: '' },
  { type: 'Write', label: 'Write', icon: '' },
  { type: 'Edit', label: 'Edit', icon: '' },
];

// Merge all chat arrays from events
const allChatMessages = computed(() => {
  const messages: any[] = [];
  for (const event of events.value) {
    if (event.chat && Array.isArray(event.chat)) {
      messages.push(...event.chat);
    }
  }
  return messages;
});

const toggleFilter = (type: string) => {
  const index = activeFilters.value.indexOf(type);
  if (index > -1) {
    activeFilters.value.splice(index, 1);
  } else {
    activeFilters.value.push(type);
  }
};

const executeSearch = () => {
  activeSearchQuery.value = searchQuery.value;
};

const clearSearch = () => {
  searchQuery.value = '';
  activeSearchQuery.value = '';
  activeFilters.value = [];
};

const copyAllMessages = async () => {
  try {
    const jsonPayload = JSON.stringify(allChatMessages.value, null, 2);
    await navigator.clipboard.writeText(jsonPayload);
    copyButtonText.value = 'Copied!';
    setTimeout(() => {
      copyButtonText.value = 'Copy All';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
    copyButtonText.value = 'Failed';
    setTimeout(() => {
      copyButtonText.value = 'Copy All';
    }, 2000);
  }
};

const matchesSearch = (item: any, query: string): boolean => {
  const lowerQuery = query.toLowerCase().trim();

  if (typeof item.content === 'string') {
    const cleanContent = item.content.replace(/\u001b\[[0-9;]*m/g, '').toLowerCase();
    if (cleanContent.includes(lowerQuery)) return true;
  }

  if (item.role && item.role.toLowerCase().includes(lowerQuery)) return true;

  if (item.message) {
    if (item.message.role && item.message.role.toLowerCase().includes(lowerQuery)) return true;
    if (item.message.content) {
      if (typeof item.message.content === 'string' && item.message.content.toLowerCase().includes(lowerQuery)) return true;
      if (Array.isArray(item.message.content)) {
        for (const content of item.message.content) {
          if (content.text && content.text.toLowerCase().includes(lowerQuery)) return true;
          if (content.name && content.name.toLowerCase().includes(lowerQuery)) return true;
          if (content.input && JSON.stringify(content.input).toLowerCase().includes(lowerQuery)) return true;
        }
      }
    }
  }

  if (item.type && item.type.toLowerCase().includes(lowerQuery)) return true;

  return false;
};

const matchesFilters = (item: any): boolean => {
  if (activeFilters.value.length === 0) return true;

  if (item.type && activeFilters.value.includes(item.type)) return true;
  if (item.role && activeFilters.value.includes(item.role)) return true;

  if (item.type === 'system' && item.content) {
    const toolNames = ['Read', 'Write', 'Edit', 'Glob'];
    for (const tool of toolNames) {
      if (item.content.includes(tool) && activeFilters.value.includes(tool)) return true;
    }
  }

  if (item.message?.content && Array.isArray(item.message.content)) {
    for (const content of item.message.content) {
      if (content.type === 'tool_use' && activeFilters.value.includes('tool_use')) return true;
      if (content.type === 'tool_result' && activeFilters.value.includes('tool_result')) return true;
      if (content.name && activeFilters.value.includes(content.name)) return true;
    }
  }

  return false;
};

const filteredChat = computed(() => {
  if (!activeSearchQuery.value && activeFilters.value.length === 0) {
    return allChatMessages.value;
  }

  return allChatMessages.value.filter(item => {
    const matchesQueryCondition = !activeSearchQuery.value || matchesSearch(item, activeSearchQuery.value);
    const matchesFilterCondition = matchesFilters(item);
    return matchesQueryCondition && matchesFilterCondition;
  });
});

async function fetchSessionEvents() {
  isLoading.value = true;
  error.value = null;

  try {
    // Fetch session info
    const sessionRes = await fetch(`${API_BASE_URL}/api/sessions/${props.sessionId}`);
    const sessionData = await sessionRes.json();
    if (sessionData.success) {
      sessionInfo.value = sessionData.data;
    }

    // Fetch events
    const eventsRes = await fetch(`${API_BASE_URL}/api/sessions/${props.sessionId}/events`);
    const eventsData = await eventsRes.json();

    if (eventsData.success) {
      events.value = eventsData.data;
    } else {
      error.value = eventsData.error || 'Failed to load events';
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Network error';
  } finally {
    isLoading.value = false;
  }
}

onMounted(() => {
  fetchSessionEvents();
});
</script>
