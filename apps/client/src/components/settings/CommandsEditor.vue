<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectSetting, CommandSettingValue } from '../../types'

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

const commands = computed(() => {
  return props.settings.map(s => ({
    ...s,
    value: s.settingValue as CommandSettingValue
  }))
})
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Commands</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Custom slash commands for this project
        </p>
      </div>
      <button
        @click="emit('add')"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Add Command
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="commands.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      <div class="text-4xl mb-2">⌘</div>
      <p>No custom commands configured</p>
      <button
        @click="emit('add')"
        class="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Add your first command
      </button>
    </div>

    <!-- Commands list -->
    <div v-else class="space-y-2">
      <div
        v-for="cmd in commands"
        :key="cmd.id"
        :class="[
          'p-3 rounded-lg border transition-all',
          cmd.enabled
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 opacity-60'
        ]"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Toggle -->
            <button
              @click="emit('toggle', cmd)"
              :class="[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                cmd.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                  cmd.enabled ? 'translate-x-5' : 'translate-x-1'
                ]"
              />
            </button>

            <!-- Command name -->
            <div>
              <code class="text-sm font-mono text-blue-600 dark:text-blue-400">
                /{{ cmd.value.name || cmd.settingKey }}
              </code>
              <span v-if="cmd.value.argumentHint" class="ml-1 text-xs text-gray-400">
                {{ cmd.value.argumentHint }}
              </span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              @click="emit('edit', cmd)"
              class="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              title="Edit"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              @click="emit('delete', cmd)"
              class="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              title="Delete"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Description -->
        <p v-if="cmd.value.description" class="mt-2 ml-12 text-sm text-gray-600 dark:text-gray-400">
          {{ cmd.value.description }}
        </p>

        <!-- Allowed tools -->
        <div v-if="cmd.value.allowedTools?.length" class="mt-2 ml-12 flex flex-wrap gap-1">
          <span
            v-for="tool in cmd.value.allowedTools"
            :key="tool"
            class="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded"
          >
            {{ tool }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
