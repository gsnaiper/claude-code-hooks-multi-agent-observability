<script setup lang="ts">
import type { EventSummary } from '../types';

const props = defineProps<{
  event: EventSummary;
  variant: number;
}>();

// Tool icons
const toolIcons: Record<string, string> = {
  Bash: '🔧',
  Read: '📖',
  Edit: '✏️',
  Write: '📝',
  Task: '🤖',
  Glob: '🔍',
  Grep: '🔎',
  WebSearch: '🌐',
  WebFetch: '📡',
  TodoWrite: '📋',
  AskUserQuestion: '❓',
  default: '⚡'
};

const getIcon = (tool?: string) => toolIcons[tool || ''] || toolIcons.default;

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
};

const truncate = (s: string | undefined, len: number) => {
  if (!s) return '';
  return s.length > len ? s.slice(0, len) + '...' : s;
};

const getStatusIcon = (event: EventSummary) => {
  if (event.hitl_status === 'pending') return '⏳';
  if (event.hitl_status === 'responded') return '✅';
  return '✓';
};

const getEventTypeShort = (type: string) => {
  const map: Record<string, string> = {
    PreToolUse: 'Pre',
    PostToolUse: 'Post',
    Notification: 'Notif',
    SessionStart: 'Start',
    SessionEnd: 'End'
  };
  return map[type] || type.slice(0, 4);
};
</script>

<template>
  <!-- Variant 1: Ultra-Compact -->
  <div v-if="variant === 1" class="bg-gray-800 rounded p-1.5 text-xs">
    <div class="flex items-center justify-between gap-1 text-gray-400 mb-0.5">
      <div class="flex items-center gap-1">
        <span class="text-blue-400">{{ event.source_app }}</span>
        <span class="text-gray-600">·</span>
        <span>{{ event.session_id?.slice(0, 4) }}</span>
        <span class="text-gray-600">·</span>
        <span class="text-purple-400">{{ event.model_name?.split('-')[0] || 'n/a' }}</span>
        <span class="text-gray-600">·</span>
        <span class="text-green-400">{{ getEventTypeShort(event.hook_event_type) }}</span>
      </div>
      <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
    </div>
    <div class="flex items-center justify-between">
      <span class="flex items-center gap-1">
        <span>{{ getIcon(event.tool_name) }}</span>
        <span class="text-white font-medium">{{ event.tool_name || event.hook_event_type }}:</span>
        <span class="text-gray-300">{{ truncate(event.summary || event.tool_command, 40) }}</span>
      </span>
      <span class="text-gray-500">{{ getStatusIcon(event) }}</span>
    </div>
  </div>

  <!-- Variant 2: Single-Line Dense -->
  <div v-else-if="variant === 2" class="bg-gray-800/50 rounded px-2 py-1 text-xs font-mono">
    <span class="text-gray-500">[</span>
    <span class="text-blue-400">{{ event.source_app }}</span>
    <span class="text-gray-600">:</span>
    <span class="text-gray-400">{{ event.session_id?.slice(0, 4) }}</span>
    <span class="text-gray-500">]</span>
    <span class="mx-1 text-white">{{ event.tool_name || event.hook_event_type }}:</span>
    <span class="text-gray-300">{{ truncate(event.summary || event.tool_command, 30) }}</span>
    <span class="text-gray-600 mx-1">|</span>
    <span class="text-green-400">{{ getStatusIcon(event) }}</span>
    <span class="text-gray-600 mx-1">|</span>
    <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
  </div>

  <!-- Variant 3: Card Micro -->
  <div v-else-if="variant === 3" class="bg-gray-800 rounded-lg border border-gray-700 p-2 text-xs">
    <div class="flex items-center justify-between text-gray-400 mb-1">
      <span class="text-blue-400 font-medium">{{ event.source_app }}</span>
      <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
    </div>
    <div class="text-white font-medium">
      {{ getIcon(event.tool_name) }} {{ event.tool_name || event.hook_event_type }}: {{ truncate(event.summary || event.tool_command, 35) }}
    </div>
    <div class="text-gray-500 mt-1 flex items-center gap-2">
      <span>{{ getStatusIcon(event) }}</span>
      <span class="text-purple-400 text-[10px]">{{ event.model_name?.split('-')[0] }}</span>
    </div>
  </div>

  <!-- Variant 4: Timeline Style -->
  <div v-else-if="variant === 4" class="flex items-start gap-2 text-xs pl-2 border-l-2 border-blue-500/50">
    <div class="flex items-center gap-2">
      <span class="text-gray-500 font-mono w-12">{{ formatTime(event.timestamp) }}</span>
      <span class="w-2 h-2 rounded-full bg-blue-500"></span>
    </div>
    <div class="flex-1">
      <span class="text-gray-500">[</span>
      <span class="text-blue-400">{{ event.source_app }}</span>
      <span class="text-gray-500">]</span>
      <span class="text-white ml-1">{{ event.tool_name || event.hook_event_type }}:</span>
      <span class="text-gray-300 ml-1">{{ truncate(event.summary || event.tool_command, 40) }}</span>
      <span class="text-gray-600 ml-2">→</span>
      <span class="text-green-400 ml-1">{{ getStatusIcon(event) }}</span>
    </div>
  </div>

  <!-- Variant 5: Table Row -->
  <div v-else-if="variant === 5" class="grid grid-cols-[60px_80px_80px_1fr_40px] gap-1 text-xs bg-gray-800/30 px-2 py-1 border-b border-gray-700/50 font-mono">
    <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
    <span class="text-blue-400 truncate">{{ event.source_app }}</span>
    <span class="text-purple-400 truncate">{{ event.tool_name || event.hook_event_type }}</span>
    <span class="text-gray-300 truncate">{{ event.summary || event.tool_command || '-' }}</span>
    <span class="text-right text-green-400">{{ getStatusIcon(event) }}</span>
  </div>

  <!-- Variant 6: Chat Bubble -->
  <div v-else-if="variant === 6" class="flex justify-end">
    <div class="bg-blue-600/20 border border-blue-500/30 rounded-xl rounded-br-sm px-3 py-1.5 max-w-[85%] text-xs">
      <div class="text-white font-medium">
        {{ getIcon(event.tool_name) }} {{ event.tool_name || event.hook_event_type }}: {{ truncate(event.summary || event.tool_command, 40) }}
      </div>
      <div class="flex items-center justify-end gap-2 mt-1 text-gray-400 text-[10px]">
        <span>{{ getStatusIcon(event) }}</span>
        <span class="text-blue-400">{{ event.source_app }}</span>
        <span>{{ formatTime(event.timestamp) }}</span>
      </div>
    </div>
  </div>

  <!-- Variant 7: Status Bar -->
  <div v-else-if="variant === 7" class="flex items-center justify-between bg-gray-800 rounded px-2 py-1 text-xs">
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full" :class="event.hitl_status === 'pending' ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'"></span>
      <span class="text-green-400">{{ getEventTypeShort(event.hook_event_type) }}</span>
      <span class="text-purple-400">{{ event.tool_name }}</span>
      <span class="text-gray-300">{{ truncate(event.tool_command || event.summary, 30) }}</span>
    </div>
    <div class="flex items-center gap-2">
      <span class="text-gray-500">{{ formatTime(event.timestamp) }}</span>
      <button class="text-gray-400 hover:text-white">▶</button>
    </div>
  </div>

  <!-- Variant 8: Accordion Style -->
  <div v-else-if="variant === 8" class="text-xs">
    <div class="flex items-center gap-1 text-gray-300">
      <span class="text-blue-400">{{ event.source_app }}</span>
      <span class="text-gray-600">›</span>
      <span class="text-white font-medium">{{ event.tool_name || event.hook_event_type }}:</span>
      <span>{{ truncate(event.summary || event.tool_command, 35) }}</span>
      <span class="ml-auto text-gray-500">{{ formatTime(event.timestamp) }}</span>
    </div>
    <div class="pl-4 text-gray-500 mt-0.5 flex items-center gap-2">
      <span>└─</span>
      <span>{{ getStatusIcon(event) }}</span>
      <span class="text-purple-400">{{ event.model_name?.split('-')[0] }}</span>
      <span class="text-gray-600 cursor-pointer hover:text-gray-400">[expand ▼]</span>
    </div>
  </div>

  <!-- Variant 9: Icon-First -->
  <div v-else-if="variant === 9" class="flex items-start gap-2 text-xs p-1">
    <span class="text-2xl">{{ getIcon(event.tool_name) }}</span>
    <div class="flex-1">
      <div class="text-white font-medium">{{ truncate(event.tool_command || event.summary || event.tool_name, 40) }}</div>
      <div class="flex items-center gap-2 text-gray-500 mt-0.5">
        <span class="text-blue-400">{{ event.source_app }}</span>
        <span class="text-purple-400">{{ event.model_name?.split('-')[0] }}</span>
        <span>{{ formatTime(event.timestamp) }}</span>
      </div>
    </div>
    <span class="text-green-400">{{ getStatusIcon(event) }}</span>
  </div>

  <!-- Variant 10: Horizontal Tags -->
  <div v-else-if="variant === 10" class="bg-gray-800 rounded-lg p-1.5 text-xs">
    <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide">
      <span class="bg-blue-600/30 text-blue-300 px-1.5 py-0.5 rounded shrink-0">{{ event.tool_name || event.hook_event_type }}</span>
      <span class="text-gray-300 truncate flex-1">{{ event.tool_command || event.summary }}</span>
      <span class="bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded shrink-0">{{ getStatusIcon(event) }}</span>
      <span class="bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded shrink-0">{{ formatTime(event.timestamp) }}</span>
    </div>
    <div class="flex items-center gap-1 mt-1 text-[10px] text-gray-500 overflow-x-auto scrollbar-hide">
      <span class="bg-gray-700/50 px-1 rounded">{{ event.source_app }}</span>
      <span class="bg-gray-700/50 px-1 rounded">{{ event.session_id?.slice(0, 8) }}</span>
      <span class="bg-purple-900/30 text-purple-400 px-1 rounded">{{ event.model_name?.split('-')[0] }}</span>
    </div>
  </div>

  <!-- Fallback -->
  <div v-else class="text-red-400 text-xs p-2">
    Unknown variant: {{ variant }}
  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
