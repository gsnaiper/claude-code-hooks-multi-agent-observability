<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectSetting, AgentSettingValue } from '../../types'

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

const agents = computed(() => {
  return props.settings.map(s => ({
    ...s,
    value: s.settingValue as AgentSettingValue
  }))
})

const modelColors: Record<string, string> = {
  haiku: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  sonnet: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  opus: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
}
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Agents</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Configure sub-agents for this project
        </p>
      </div>
      <button
        @click="emit('add')"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Add Agent
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="agents.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      <div class="text-4xl mb-2">🤖</div>
      <p>No agents configured for this project</p>
      <button
        @click="emit('add')"
        class="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Add your first agent
      </button>
    </div>

    <!-- Agents grid -->
    <div v-else class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="agent in agents"
        :key="agent.id"
        :class="[
          'p-4 rounded-lg border transition-all',
          agent.enabled
            ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
            : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 opacity-60'
        ]"
      >
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-2">
            <!-- Color indicator -->
            <div
              class="w-3 h-3 rounded-full"
              :style="{ backgroundColor: agent.value.color || '#6B7280' }"
            />
            <h4 class="font-medium text-gray-900 dark:text-white">
              {{ agent.value.name || agent.settingKey }}
            </h4>
          </div>

          <!-- Toggle -->
          <button
            @click="emit('toggle', agent)"
            :class="[
              'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
              agent.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            ]"
          >
            <span
              :class="[
                'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                agent.enabled ? 'translate-x-5' : 'translate-x-1'
              ]"
            />
          </button>
        </div>

        <!-- Model badge -->
        <div class="mt-2 flex items-center gap-2">
          <span
            :class="[
              'px-2 py-0.5 text-xs font-medium rounded',
              modelColors[agent.value.model] || 'bg-gray-100 text-gray-700'
            ]"
          >
            {{ agent.value.model }}
          </span>
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ agent.value.tools?.length || 0 }} tools
          </span>
        </div>

        <!-- Description -->
        <p v-if="agent.value.description" class="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
          {{ agent.value.description }}
        </p>

        <!-- Actions -->
        <div class="mt-3 flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
          <button
            @click="emit('edit', agent)"
            class="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Edit
          </button>
          <span class="text-gray-300 dark:text-gray-600">|</span>
          <button
            @click="emit('delete', agent)"
            class="text-xs text-red-600 hover:text-red-700 dark:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
