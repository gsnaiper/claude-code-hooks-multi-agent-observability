<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex-shrink-0 p-4 border-b border-[var(--theme-border-primary)]">
      <div class="flex items-center gap-3">
        <!-- Back button -->
        <button
          @click="$emit('back')"
          class="p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] transition-colors"
          title="Back to projects"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <!-- Project color indicator -->
        <div
          class="w-3 h-3 rounded-full"
          :style="{ backgroundColor: projectColor }"
        ></div>

        <div class="flex-1 min-w-0">
          <h2 class="text-[var(--theme-text-primary)] text-lg font-semibold truncate">
            {{ project.displayName || project.id }}
          </h2>
          <p
            v-if="project.displayName && project.displayName !== project.id"
            class="text-[var(--theme-text-tertiary)] text-xs font-mono truncate"
          >
            {{ project.id }}
          </p>
        </div>

        <!-- Status badge -->
        <span
          class="px-2 py-1 text-xs rounded-full"
          :class="statusClasses"
        >
          {{ project.status }}
        </span>
      </div>

      <!-- Stats row -->
      <div class="flex items-center gap-6 mt-4 text-sm text-[var(--theme-text-secondary)]">
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span>{{ sessions.length }} sessions</span>
        </div>
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>{{ totalEvents }} events</span>
        </div>
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span>{{ totalToolCalls }} tool calls</span>
        </div>
      </div>
    </div>

    <!-- Sessions list -->
    <div class="flex-1 overflow-y-auto p-4">
      <h3 class="text-[var(--theme-text-secondary)] text-sm font-medium mb-3">Sessions</h3>

      <!-- Loading -->
      <div v-if="isLoading" class="flex items-center justify-center h-24">
        <div class="text-[var(--theme-text-tertiary)]">Loading sessions...</div>
      </div>

      <!-- Empty -->
      <div v-else-if="sessions.length === 0" class="flex flex-col items-center justify-center h-24 text-center">
        <p class="text-[var(--theme-text-tertiary)] text-sm">No sessions recorded yet</p>
      </div>

      <!-- Session list -->
      <div v-else class="space-y-2">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-3"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <!-- Session status -->
              <div
                class="w-2 h-2 rounded-full"
                :class="sessionStatusColor(session.status)"
              ></div>
              <span class="text-[var(--theme-text-primary)] text-sm font-mono">
                {{ session.id.slice(0, 8) }}
              </span>
            </div>
            <span class="text-[var(--theme-text-tertiary)] text-xs">
              {{ formatSessionTime(session.startedAt) }}
            </span>
          </div>

          <!-- Session stats -->
          <div class="flex items-center gap-4 mt-2 text-xs text-[var(--theme-text-tertiary)]">
            <span v-if="session.modelName" class="text-[var(--theme-primary)]">
              {{ formatModelName(session.modelName) }}
            </span>
            <span>{{ session.eventCount }} events</span>
            <span>{{ session.toolCallCount }} tools</span>
            <span v-if="session.endedAt">
              Duration: {{ formatDuration(session.startedAt, session.endedAt) }}
            </span>
            <span v-else class="text-green-500">Active</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import type { Project, ProjectSession } from '../types'
import { useProjects } from '../composables/useProjects'
import { useEventColors } from '../composables/useEventColors'

const props = defineProps<{
  project: Project
}>()

defineEmits<{
  back: []
}>()

const { projectSessions: sessions, isLoading, fetchProjectSessions } = useProjects()
const { getHexColorForApp } = useEventColors()

const projectColor = computed(() => getHexColorForApp(props.project.id))

const statusClasses = computed(() => {
  switch (props.project.status) {
    case 'active': return 'bg-green-500/20 text-green-400'
    case 'paused': return 'bg-yellow-500/20 text-yellow-400'
    case 'archived': return 'bg-gray-500/20 text-gray-400'
    default: return 'bg-gray-500/20 text-gray-400'
  }
})

const totalEvents = computed(() =>
  sessions.value.reduce((sum, s) => sum + s.eventCount, 0)
)

const totalToolCalls = computed(() =>
  sessions.value.reduce((sum, s) => sum + s.toolCallCount, 0)
)

function sessionStatusColor(status: string) {
  switch (status) {
    case 'active': return 'bg-green-500'
    case 'completed': return 'bg-blue-500'
    case 'abandoned': return 'bg-gray-500'
    default: return 'bg-gray-500'
  }
}

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(start: number, end: number): string {
  const diff = end - start
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m`
}

function formatModelName(name: string): string {
  // claude-opus-4-5-20251101 -> Opus 4.5
  if (name.includes('opus')) return 'Opus ' + (name.match(/opus-(\d+-\d+)/) || ['', '4'])[1].replace('-', '.')
  if (name.includes('sonnet')) return 'Sonnet'
  if (name.includes('haiku')) return 'Haiku'
  return name.slice(0, 15)
}

// Load sessions when project changes
watch(() => props.project.id, (newId) => {
  fetchProjectSessions(newId)
}, { immediate: true })

onMounted(() => {
  fetchProjectSessions(props.project.id)
})
</script>
