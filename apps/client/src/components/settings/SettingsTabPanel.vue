<script setup lang="ts">
import { computed } from 'vue'
import type { SettingType } from '../../types'

const props = defineProps<{
  activeTab: SettingType
  counts: Record<SettingType, number>
}>()

const emit = defineEmits<{
  (e: 'update:activeTab', tab: SettingType): void
}>()

const tabs: { type: SettingType; label: string; icon: string }[] = [
  { type: 'skills', label: 'Skills', icon: '🎯' },
  { type: 'agents', label: 'Agents', icon: '🤖' },
  { type: 'commands', label: 'Commands', icon: '⌘' },
  { type: 'permissions', label: 'Permissions', icon: '🔒' },
  { type: 'hooks', label: 'Hooks', icon: '🪝' },
  { type: 'output_styles', label: 'Output Styles', icon: '🎨' }
]

function selectTab(type: SettingType) {
  emit('update:activeTab', type)
}
</script>

<template>
  <div class="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
    <button
      v-for="tab in tabs"
      :key="tab.type"
      @click="selectTab(tab.type)"
      :class="[
        'flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
        activeTab === tab.type
          ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      ]"
    >
      <span>{{ tab.icon }}</span>
      <span>{{ tab.label }}</span>
      <span
        v-if="counts[tab.type] > 0"
        class="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300"
      >
        {{ counts[tab.type] }}
      </span>
    </button>
  </div>
</template>
