<template>
  <div
    class="group relative bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-[var(--theme-primary)] hover:shadow-lg"
    @click="$emit('select', project)"
  >
    <!-- Status indicator -->
    <div
      class="absolute top-3 right-3 w-2 h-2 rounded-full"
      :class="statusColor"
    ></div>

    <!-- Project color bar -->
    <div
      class="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
      :style="{ backgroundColor: projectColor }"
    ></div>

    <!-- Content -->
    <div class="pl-3">
      <!-- Title -->
      <h3 class="text-[var(--theme-text-primary)] font-semibold text-sm truncate pr-4">
        {{ project.displayName || project.id }}
      </h3>

      <!-- Project ID (if different from displayName) -->
      <p
        v-if="project.displayName && project.displayName !== project.id"
        class="text-[var(--theme-text-tertiary)] text-xs mt-0.5 truncate font-mono"
      >
        {{ project.id }}
      </p>

      <!-- Description -->
      <p
        v-if="project.description"
        class="text-[var(--theme-text-secondary)] text-xs mt-2 line-clamp-2"
      >
        {{ project.description }}
      </p>

      <!-- Stats -->
      <div class="flex items-center gap-4 mt-3 text-xs text-[var(--theme-text-tertiary)]">
        <!-- Last activity -->
        <div class="flex items-center gap-1" :title="lastActivityFull">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ lastActivityRelative }}</span>
        </div>

        <!-- Session indicator -->
        <div
          v-if="project.lastSessionId"
          class="flex items-center gap-1"
          :title="'Last session: ' + project.lastSessionId.slice(0, 8)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span class="font-mono">{{ project.lastSessionId.slice(0, 8) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '../types'
import { useEventColors } from '../composables/useEventColors'

const props = defineProps<{
  project: Project
}>()

defineEmits<{
  select: [project: Project]
}>()

const { getHexColorForApp } = useEventColors()

const projectColor = computed(() => getHexColorForApp(props.project.id))

const statusColor = computed(() => {
  switch (props.project.status) {
    case 'active': return 'bg-green-500'
    case 'paused': return 'bg-yellow-500'
    case 'archived': return 'bg-gray-500'
    default: return 'bg-gray-500'
  }
})

const lastActivityRelative = computed(() => {
  if (!props.project.lastActivityAt) return 'No activity'

  const diff = Date.now() - props.project.lastActivityAt
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
})

const lastActivityFull = computed(() => {
  if (!props.project.lastActivityAt) return 'No activity recorded'
  return new Date(props.project.lastActivityAt).toLocaleString()
})
</script>
