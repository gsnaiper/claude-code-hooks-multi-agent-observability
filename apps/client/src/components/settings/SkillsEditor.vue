<script setup lang="ts">
import { computed } from 'vue'
import type { ProjectSetting, SkillSettingValue } from '../../types'

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

const skills = computed(() => {
  return props.settings.map(s => ({
    ...s,
    value: s.settingValue as SkillSettingValue
  }))
})
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h3 class="text-lg font-medium text-gray-900 dark:text-white">Skills</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          Manage skills available for this project
        </p>
      </div>
      <button
        @click="emit('add')"
        class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        + Add Skill
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="skills.length === 0"
      class="text-center py-8 text-gray-500 dark:text-gray-400"
    >
      <div class="text-4xl mb-2">🎯</div>
      <p>No skills configured for this project</p>
      <button
        @click="emit('add')"
        class="mt-2 text-blue-600 hover:text-blue-700 dark:text-blue-400"
      >
        Add your first skill
      </button>
    </div>

    <!-- Skills list -->
    <div v-else class="space-y-2">
      <div
        v-for="skill in skills"
        :key="skill.id"
        class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
      >
        <div class="flex items-center gap-3">
          <!-- Toggle -->
          <button
            @click="emit('toggle', skill)"
            :class="[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              skill.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            ]"
          >
            <span
              :class="[
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                skill.enabled ? 'translate-x-6' : 'translate-x-1'
              ]"
            />
          </button>

          <!-- Info -->
          <div>
            <div class="font-medium text-gray-900 dark:text-white">
              {{ skill.value.name || skill.settingKey }}
            </div>
            <div v-if="skill.value.description" class="text-sm text-gray-500 dark:text-gray-400">
              {{ skill.value.description }}
            </div>
            <div v-if="skill.value.path" class="text-xs text-gray-400 dark:text-gray-500 font-mono">
              {{ skill.value.path }}
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center gap-2">
          <button
            @click="emit('edit', skill)"
            class="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Edit"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            @click="emit('delete', skill)"
            class="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Delete"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Allowed tools info -->
    <div v-if="skills.some(s => s.value.allowedTools?.length)" class="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
      <div class="text-sm text-blue-700 dark:text-blue-300">
        <strong>Note:</strong> Some skills have tool restrictions configured.
      </div>
    </div>
  </div>
</template>
