<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectSetting } from '../../types'

interface OutputStyleValue {
  name: string
  description?: string
  format?: 'markdown' | 'json' | 'plain' | 'custom'
  template?: string
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

const styles = computed(() => {
  return props.settings.map(s => ({
    ...s,
    value: s.settingValue as OutputStyleValue
  }))
})

const formatColors: Record<string, string> = {
  markdown: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  json: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  plain: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  custom: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Output Styles</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Configure output formatting for this project
        </p>
      </div>
      <button
        @click="emit('add')"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Add Style
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="styles.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      <div class="text-4xl mb-2">🎨</div>
      <p>No output styles configured</p>
      <button
        @click="emit('add')"
        class="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Add your first output style
      </button>
    </div>

    <!-- Styles list -->
    <div v-else class="space-y-2">
      <div
        v-for="style in styles"
        :key="style.id"
        :class="[
          'p-3 rounded-lg border transition-all',
          style.enabled
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 opacity-60'
        ]"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <!-- Toggle -->
            <button
              @click="emit('toggle', style)"
              :class="[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                style.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
              ]"
            >
              <span
                :class="[
                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                  style.enabled ? 'translate-x-5' : 'translate-x-1'
                ]"
              />
            </button>

            <!-- Style info -->
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-gray-900 dark:text-white">
                  {{ style.value.name || style.settingKey }}
                </span>
                <span
                  v-if="style.value.format"
                  :class="['px-1.5 py-0.5 text-xs rounded', formatColors[style.value.format] || formatColors.plain]"
                >
                  {{ style.value.format }}
                </span>
              </div>
              <div v-if="style.value.description" class="text-sm text-gray-500 dark:text-gray-400">
                {{ style.value.description }}
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              @click="emit('edit', style)"
              class="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
              title="Edit"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              @click="emit('delete', style)"
              class="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              title="Delete"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Template preview -->
        <div v-if="style.value.template" class="mt-2 ml-12">
          <code class="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded block truncate">
            {{ style.value.template }}
          </code>
        </div>
      </div>
    </div>
  </div>
</template>
