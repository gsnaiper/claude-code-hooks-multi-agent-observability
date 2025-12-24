<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { ProjectSession, Project } from '../types'
import { useOrphanedSessions } from '../composables/useOrphanedSessions'
import { useProjects } from '../composables/useProjects'

const props = defineProps<{
  visible?: boolean
}>()

const emit = defineEmits<{
  (e: 'assign', session: ProjectSession, project: Project): void
}>()

const { unassignedSessions, unassignedCount, isLoading, error, fetchUnassignedSessions, assignToProject } = useOrphanedSessions()
const { projects, fetchProjects } = useProjects()

const selectedSessions = ref<Set<string>>(new Set())
const showAssignModal = ref(false)
const assignTarget = ref<string>('')

// Computed: sessions selected for bulk action
const hasSelection = computed(() => selectedSessions.value.size > 0)

onMounted(async () => {
  await Promise.all([
    fetchUnassignedSessions(),
    fetchProjects({ status: 'active' })
  ])
})

function toggleSession(sessionId: string): void {
  if (selectedSessions.value.has(sessionId)) {
    selectedSessions.value.delete(sessionId)
  } else {
    selectedSessions.value.add(sessionId)
  }
  // Force reactivity
  selectedSessions.value = new Set(selectedSessions.value)
}

function toggleAll(): void {
  if (selectedSessions.value.size === unassignedSessions.value.length) {
    selectedSessions.value = new Set()
  } else {
    selectedSessions.value = new Set(unassignedSessions.value.map(s => s.id))
  }
}

function openAssignModal(): void {
  assignTarget.value = ''
  showAssignModal.value = true
}

async function handleAssign(): Promise<void> {
  if (!assignTarget.value) return

  const targetProject = projects.value.find(p => p.id === assignTarget.value)
  if (!targetProject) return

  // Assign all selected sessions
  for (const sessionId of selectedSessions.value) {
    const session = await assignToProject(sessionId, assignTarget.value)
    if (session) {
      emit('assign', session, targetProject)
    }
  }

  selectedSessions.value = new Set()
  showAssignModal.value = false
}

async function assignSingle(session: ProjectSession, projectId: string): Promise<void> {
  const targetProject = projects.value.find(p => p.id === projectId)
  if (!targetProject) return

  const assigned = await assignToProject(session.id, projectId)
  if (assigned) {
    emit('assign', assigned, targetProject)
  }
}

function formatPath(path?: string): string {
  if (!path) return 'Unknown'
  // Shorten path by taking last 2 segments
  const parts = path.replace(/\\/g, '/').split('/')
  return parts.slice(-2).join('/')
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return 'Just now'
}
</script>

<template>
  <div v-if="unassignedCount > 0 || props.visible" class="border-t border-[var(--theme-border-primary)] pt-4">
    <!-- Header -->
    <div class="flex items-center justify-between mb-3">
      <div class="flex items-center gap-2">
        <h3 class="text-sm font-semibold text-[var(--theme-text-secondary)]">Unassigned Sessions</h3>
        <span class="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded-full">
          {{ unassignedCount }}
        </span>
      </div>
      <div v-if="hasSelection" class="flex items-center gap-2">
        <span class="text-xs text-[var(--theme-text-tertiary)]">{{ selectedSessions.size }} selected</span>
        <button
          @click="openAssignModal"
          class="px-2 py-1 text-xs bg-[var(--theme-primary)] text-white rounded hover:bg-[var(--primary-hover)] transition-colors"
        >
          Assign Selected
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-2 border-[var(--theme-primary)] border-t-transparent"></div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-sm text-red-400">{{ error }}</p>
    </div>

    <!-- Sessions List -->
    <div v-else-if="unassignedSessions.length > 0" class="space-y-2">
      <!-- Select All -->
      <div class="flex items-center gap-2 px-2 py-1">
        <input
          type="checkbox"
          :checked="selectedSessions.size === unassignedSessions.length"
          :indeterminate="selectedSessions.size > 0 && selectedSessions.size < unassignedSessions.length"
          @change="toggleAll"
          class="w-4 h-4 rounded border-[var(--theme-border-secondary)] text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
        />
        <span class="text-xs text-[var(--theme-text-tertiary)]">Select all</span>
      </div>

      <!-- Session Cards -->
      <div
        v-for="session in unassignedSessions"
        :key="session.id"
        class="flex items-start gap-3 p-3 bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-secondary)] hover:border-[var(--theme-primary)]/50 transition-colors"
      >
        <input
          type="checkbox"
          :checked="selectedSessions.has(session.id)"
          @change="toggleSession(session.id)"
          class="mt-1 w-4 h-4 rounded border-[var(--theme-border-secondary)] text-[var(--theme-primary)] focus:ring-[var(--theme-primary)]"
        />

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-mono text-[var(--theme-text-primary)]">{{ session.id.slice(0, 8) }}</span>
            <span
              :class="[
                'px-1.5 py-0.5 text-xs rounded',
                session.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-tertiary)]'
              ]"
            >
              {{ session.status }}
            </span>
            <span v-if="session.modelName" class="px-1.5 py-0.5 text-xs bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] rounded">
              {{ session.modelName.split('-')[0] }}
            </span>
          </div>

          <div class="flex items-center gap-3 text-xs text-[var(--theme-text-tertiary)]">
            <span title="Working directory">{{ formatPath(session.cwd) }}</span>
            <span v-if="session.gitBranch" class="text-[var(--theme-primary)]">{{ session.gitBranch }}</span>
            <span>{{ session.eventCount }} events</span>
            <span>{{ formatTimeAgo(session.startedAt) }}</span>
          </div>

          <p v-if="session.initialPrompt" class="mt-1 text-xs text-[var(--theme-text-secondary)] truncate">
            {{ session.initialPrompt }}
          </p>
        </div>

        <!-- Quick Assign Dropdown -->
        <div class="relative">
          <select
            @change="(e) => assignSingle(session, (e.target as HTMLSelectElement).value)"
            class="appearance-none px-2 py-1 text-xs bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-secondary)] rounded text-[var(--theme-text-secondary)] cursor-pointer hover:border-[var(--theme-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
          >
            <option value="">Assign to...</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.displayName || project.id }}
            </option>
          </select>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="text-center py-6 text-[var(--theme-text-tertiary)]">
      <p class="text-sm">No unassigned sessions</p>
    </div>

    <!-- Bulk Assign Modal -->
    <Teleport to="body">
      <div
        v-if="showAssignModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showAssignModal = false"
      >
        <div class="w-full max-w-md p-6 bg-[var(--theme-bg-primary)] rounded-xl shadow-2xl border border-[var(--theme-border-primary)]">
          <h3 class="text-lg font-semibold text-[var(--theme-text-primary)] mb-4">
            Assign {{ selectedSessions.size }} Sessions
          </h3>

          <select
            v-model="assignTarget"
            class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
          >
            <option value="">Select a project...</option>
            <option v-for="project in projects" :key="project.id" :value="project.id">
              {{ project.displayName || project.id }}
            </option>
          </select>

          <div class="flex justify-end gap-3 mt-6">
            <button
              @click="showAssignModal = false"
              class="px-4 py-2 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              @click="handleAssign"
              :disabled="!assignTarget"
              class="px-4 py-2 text-sm bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Assign Sessions
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
