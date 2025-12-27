<script setup lang="ts">
import { ref } from 'vue';
import EventRowVariants from '../components/EventRowVariants.vue';
import EventRow from '../components/EventRow.vue';
import EventRowCompact from '../components/EventRowCompact.vue';
import type { EventSummary } from '../types';
import { useEventColors } from '../composables/useEventColors';

const { getGradientForSession, getColorForSession, getGradientForApp, getColorForApp, getHexColorForApp } = useEventColors();

const selectedVariant = ref(1);

// Mock test events (regular)
const testEvents: EventSummary[] = [
  {
    id: 1,
    source_app: 'claude-code',
    session_id: 'abc12345-6789-def0-1234-567890abcdef',
    hook_event_type: 'PreToolUse',
    timestamp: Date.now() - 60000,
    model_name: 'claude-sonnet-4',
    tool_name: 'Bash',
    tool_command: 'ls -la /home/user/project',
    summary: 'List directory contents',
    has_hitl: false
  },
  {
    id: 2,
    source_app: 'mmm-client',
    session_id: 'def45678-9abc-0123-4567-890abcdef123',
    hook_event_type: 'PostToolUse',
    timestamp: Date.now() - 45000,
    model_name: 'claude-haiku-3',
    tool_name: 'Read',
    tool_file_path: '/src/components/App.vue',
    summary: 'Read Vue component file, 245 lines',
    has_hitl: false
  },
  {
    id: 3,
    source_app: 'code-agent',
    session_id: 'ghi78901-2345-6789-abcd-ef0123456789',
    hook_event_type: 'PreToolUse',
    timestamp: Date.now() - 30000,
    model_name: 'claude-opus-4',
    tool_name: 'Edit',
    tool_file_path: '/src/utils/helpers.ts',
    summary: 'Update helper function',
    has_hitl: true,
    hitl_status: 'pending',
    hitl_type: 'permission'
  },
  {
    id: 4,
    source_app: 'dev-assistant',
    session_id: 'jkl01234-5678-9abc-def0-123456789abc',
    hook_event_type: 'Notification',
    timestamp: Date.now() - 15000,
    model_name: 'claude-sonnet-4',
    tool_name: 'Task',
    summary: 'Exploring codebase structure for optimization',
    has_hitl: true,
    hitl_status: 'responded',
    hitl_type: 'question'
  },
  {
    id: 5,
    source_app: 'claude-code',
    session_id: 'mno34567-89ab-cdef-0123-456789abcdef',
    hook_event_type: 'PostToolUse',
    timestamp: Date.now() - 5000,
    model_name: 'claude-haiku-3',
    tool_name: 'WebSearch',
    summary: 'Search for Vue 3 composition API docs',
    has_hitl: false
  }
];

// HITL test events for testing all HITL types
const hitlTestEvents: EventSummary[] = [
  {
    id: 101,
    source_app: 'claude-code',
    session_id: 'hitl-test-1234',
    hook_event_type: 'PreToolUse',
    timestamp: Date.now() - 10000,
    model_name: 'claude-opus-4',
    tool_name: 'Bash',
    tool_command: 'rm -rf /tmp/test',
    has_hitl: true,
    hitl_status: 'pending',
    hitl_type: 'permission',
    humanInTheLoop: {
      question: 'Allow deletion of /tmp/test directory?',
      type: 'permission',
      responseUrl: '/respond'
    }
  },
  {
    id: 102,
    source_app: 'dev-agent',
    session_id: 'hitl-test-5678',
    hook_event_type: 'Notification',
    timestamp: Date.now() - 8000,
    model_name: 'claude-sonnet-4',
    has_hitl: true,
    hitl_status: 'pending',
    hitl_type: 'question',
    humanInTheLoop: {
      question: 'What is the preferred database for this project - PostgreSQL or MySQL?',
      type: 'question',
      responseUrl: '/respond'
    }
  },
  {
    id: 103,
    source_app: 'code-reviewer',
    session_id: 'hitl-test-9abc',
    hook_event_type: 'PreToolUse',
    timestamp: Date.now() - 5000,
    model_name: 'claude-opus-4',
    tool_name: 'Edit',
    has_hitl: true,
    hitl_status: 'pending',
    hitl_type: 'approval',
    humanInTheLoop: {
      question: 'Approve this code change?',
      type: 'approval',
      responseUrl: '/respond',
      context: {
        file_path: '/src/utils/helpers.ts',
        old_string: 'const foo = 1;',
        new_string: 'const foo = 42;'
      }
    }
  },
  {
    id: 104,
    source_app: 'assistant',
    session_id: 'hitl-test-def0',
    hook_event_type: 'Notification',
    timestamp: Date.now() - 3000,
    model_name: 'claude-haiku-3',
    has_hitl: true,
    hitl_status: 'pending',
    hitl_type: 'choice',
    humanInTheLoop: {
      question: 'Which framework should we use?',
      type: 'choice',
      responseUrl: '/respond',
      choices: ['React', 'Vue', 'Svelte', 'Angular']
    }
  }
];

const variants = [
  { id: 1, name: 'Ultra-Compact', desc: 'Минимальные отступы, 2 строки' },
  { id: 2, name: 'Single-Line', desc: 'Всё в одну строку, моноширинный' },
  { id: 3, name: 'Card Micro', desc: 'Мини-карточка с бордером' },
  { id: 4, name: 'Timeline', desc: 'Временная линия слева' },
  { id: 5, name: 'Table Row', desc: 'Табличный стиль' },
  { id: 6, name: 'Chat Bubble', desc: 'Как сообщения в чате' },
  { id: 7, name: 'Status Bar', desc: 'Статусная строка' },
  { id: 8, name: 'Accordion', desc: 'Иерархический с expand' },
  { id: 9, name: 'Icon-First', desc: 'Большая иконка инструмента' },
  { id: 10, name: 'Horizontal Tags', desc: 'Горизонтальный скролл тегов' }
];

const showAll = ref(false);
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white p-4">
    <div class="max-w-4xl mx-auto">
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold mb-2">Event Row Variants Preview</h1>
        <p class="text-gray-400 text-sm">Выберите вариант для просмотра или включите показ всех</p>
      </div>

      <!-- Controls -->
      <div class="mb-6 flex flex-wrap gap-2 items-center">
        <button
          v-for="v in variants"
          :key="v.id"
          @click="selectedVariant = v.id; showAll = false"
          class="px-3 py-1.5 rounded text-sm transition-colors"
          :class="selectedVariant === v.id && !showAll
            ? 'bg-blue-600 text-white'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
        >
          {{ v.id }}. {{ v.name }}
        </button>
        <button
          @click="showAll = !showAll"
          class="px-3 py-1.5 rounded text-sm ml-auto"
          :class="showAll ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
        >
          {{ showAll ? '✓ Все варианты' : 'Показать все' }}
        </button>
      </div>

      <!-- Single variant preview -->
      <template v-if="!showAll">
        <div class="mb-4">
          <h2 class="text-lg font-medium mb-1">
            Вариант {{ selectedVariant }}: {{ variants[selectedVariant - 1].name }}
          </h2>
          <p class="text-gray-500 text-sm">{{ variants[selectedVariant - 1].desc }}</p>
        </div>

        <div class="space-y-2 bg-gray-800/30 rounded-lg p-3">
          <EventRowVariants
            v-for="event in testEvents"
            :key="event.id"
            :event="event"
            :variant="selectedVariant"
          />
        </div>
      </template>

      <!-- All variants preview -->
      <template v-else>
        <div v-for="v in variants" :key="v.id" class="mb-8">
          <div class="mb-3 flex items-center gap-3">
            <span class="bg-blue-600 text-white px-2 py-0.5 rounded text-sm font-bold">{{ v.id }}</span>
            <h2 class="text-lg font-medium">{{ v.name }}</h2>
            <span class="text-gray-500 text-sm">{{ v.desc }}</span>
          </div>

          <div class="space-y-2 bg-gray-800/30 rounded-lg p-3">
            <EventRowVariants
              v-for="event in testEvents"
              :key="`${v.id}-${event.id}`"
              :event="event"
              :variant="v.id"
            />
          </div>
        </div>
      </template>

      <!-- HITL Events Testing -->
      <div class="mt-12 pt-6 border-t border-gray-600">
        <h2 class="text-xl font-bold mb-4">🔐 HITL Events (Compact)</h2>
        <p class="text-gray-400 text-sm mb-4">Тестирование всех типов HITL в компактном режиме: permission, question, approval, choice</p>
        <div class="space-y-2 bg-gray-800/30 rounded-lg p-3">
          <EventRowCompact
            v-for="event in hitlTestEvents"
            :key="`hitl-${event.id}`"
            :event="event"
            :gradient-class="getGradientForSession(event.session_id)"
            :color-class="getColorForSession(event.session_id)"
            :app-gradient-class="getGradientForApp(event.source_app)"
            :app-color-class="getColorForApp(event.source_app)"
            :app-hex-color="getHexColorForApp(event.source_app)"
            :collapse-tags="false"
          />
        </div>
      </div>

      <!-- Comparison: Standard vs Compact -->
      <div class="mt-12 pt-6 border-t border-gray-600">
        <h2 class="text-xl font-bold mb-4">📊 Standard vs Compact Comparison</h2>
        <p class="text-gray-400 text-sm mb-6">Реальные компоненты EventRow и EventRowCompact</p>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Standard EventRow -->
          <div>
            <h3 class="text-lg font-medium mb-3 text-blue-400">Standard (EventRow)</h3>
            <div class="space-y-3 bg-gray-800/30 rounded-lg p-3">
              <EventRow
                v-for="event in testEvents.slice(0, 3)"
                :key="`std-${event.id}`"
                :event="event"
                :gradient-class="getGradientForSession(event.session_id)"
                :color-class="getColorForSession(event.session_id)"
                :app-gradient-class="getGradientForApp(event.source_app)"
                :app-color-class="getColorForApp(event.source_app)"
                :app-hex-color="getHexColorForApp(event.source_app)"
                :collapse-tags="false"
              />
            </div>
          </div>

          <!-- Compact EventRowCompact -->
          <div>
            <h3 class="text-lg font-medium mb-3 text-green-400">Compact (EventRowCompact)</h3>
            <div class="space-y-1 bg-gray-800/30 rounded-lg p-3">
              <EventRowCompact
                v-for="event in testEvents.slice(0, 3)"
                :key="`cmp-${event.id}`"
                :event="event"
                :gradient-class="getGradientForSession(event.session_id)"
                :color-class="getColorForSession(event.session_id)"
                :app-gradient-class="getGradientForApp(event.source_app)"
                :app-color-class="getColorForApp(event.source_app)"
                :app-hex-color="getHexColorForApp(event.source_app)"
                :collapse-tags="false"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Back link -->
      <div class="mt-8 pt-4 border-t border-gray-700">
        <router-link to="/events" class="text-blue-400 hover:text-blue-300 text-sm">
          ← Вернуться к событиям
        </router-link>
      </div>
    </div>
  </div>
</template>
