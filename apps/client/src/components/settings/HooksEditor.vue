<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectSetting } from '../../types'

interface HookSettingValue {
  name: string
  event: string
  command: string
  timeout?: number
  enabled?: boolean
}

const props = defineProps<{
  settings: ProjectSetting[]
  isLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', setting: ProjectSetting): void
  (e: 'edit', setting: ProjectSetting): void
  (e: 'delete', setting: ProjectSetting): void
  (e: 'add'): void
}>()

const hooks = computed(() => {
  return props.settings.map(s => ({
    ...s,
    value: s.settingValue as HookSettingValue
  }))
})

const hookEvents = [
  { value: 'PreToolUse', label: 'Pre Tool Use', color: 'yellow' },
  { value: 'PostToolUse', label: 'Post Tool Use', color: 'green' },
  { value: 'Notification', label: 'Notification', color: 'blue' },
  { value: 'Stop', label: 'Stop', color: 'red' }
]

function getEventColor(event: string): string {
  const found = hookEvents.find(e => e.value === event)
  const color = found?.color || 'gray'
  const colors: Record<string, string> = {
    yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
  }
  return colors[color]
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Hooks</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Configure event hooks for this project
        </p>
      </div>
      <button
        @click="emit('add')"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Add Hook
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="hooks.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      <div class="text-4xl mb-2">🪝</div>
      <p>No hooks configured for this project</p>
      <button
        @click="emit('add')"
        class="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Add your first hook
      </button>
    </div>

    <!-- Hooks list -->
    <div v-else class="space-y-2">
      <div
        v-for="hook in hooks"
        :key="hook.id"
        :class="[
          'p-3 rounded-lg border transition-all',
          hook.enabled
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 opacity-60'
        ]"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Toggle -->
            <button
              @click="emit('toggle', hook)"
              :class="[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                hook.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                  hook.enabled ? 'translate-x-5' : 'translate-x-1'
                ]"
              />
            </button>

            <!-- Hook info -->
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-gray-900 dark:text-white">
                  {{ hook.value.name || hook.settingKey }}
                </span>
                <span :class="['px-1.5 py-0.5 text-xs rounded', getEventColor(hook.value.event)]">
                  {{ hook.value.event }}
                </span>
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              @click="emit('edit', hook)"
              class="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              title="Edit"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              @click="emit('delete', hook)"
              class="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              title="Delete"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Command preview -->
        <div class="mt-2 ml-12">
          <code class="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block truncate">
            {{ hook.value.command }}
          </code>
          <div v-if="hook.value.timeout" class="mt-1 text-xs text-gray-500">
            Timeout: {{ hook.value.timeout }}s
          </div>
        </div>
      </div>
    </div>

    <!-- Info box -->
    <div class="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
      <div class="text-sm text-blue-700 dark:text-blue-300">
        <strong>Tip:</strong> Hooks run shell commands in response to Claude events.
        Use PreToolUse to intercept tool calls, PostToolUse for logging, and Notification for alerts.
      </div>
    </div>
  </div>
</template>
