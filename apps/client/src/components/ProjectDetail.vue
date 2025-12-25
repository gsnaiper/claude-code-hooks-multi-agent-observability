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

        <!-- Open All Terminals button -->
        <button
          v-if="sessionsWithCwd.length > 0"
          @click="openAllTerminals"
          class="p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] transition-colors"
          :title="`Open ${sessionsWithCwd.length} terminal(s)`"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        <!-- Settings button -->
        <button
          @click="showSettings = true"
          class="p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] transition-colors"
          title="Project settings"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

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
          <!-- Header row: ID + timestamp -->
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-2">
              <!-- Session status dot -->
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
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

          <!-- Working directory -->
          <div v-if="session.cwd" class="flex items-center gap-1.5 mt-1.5 text-xs text-[var(--theme-text-secondary)]">
            <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span class="font-mono truncate" :title="session.cwd">
              {{ shortenPath(session.cwd) }}
            </span>
          </div>

          <!-- Meta row: branch, model, events, tools -->
          <div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-[var(--theme-text-tertiary)]">
            <!-- Git branch -->
            <span v-if="session.gitBranch" class="flex items-center gap-1 text-purple-400">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {{ session.gitBranch }}
            </span>
            <!-- Model badge -->
            <span v-if="session.modelName" :class="modelBadgeClass(session.modelName)">
              {{ formatModelName(session.modelName) }}
            </span>
            <span>{{ session.eventCount }} events</span>
            <span>{{ session.toolCallCount }} tools</span>
            <span v-if="session.endedAt">
              {{ formatDuration(session.startedAt, session.endedAt) }}
            </span>
            <span v-else class="text-green-500 font-medium">● Active</span>
          </div>

          <!-- Summary or initial prompt preview -->
          <div
            v-if="session.summary || session.initialPrompt"
            class="mt-2 text-xs text-[var(--theme-text-secondary)] line-clamp-2 italic"
          >
            "{{ truncateText(session.summary || session.initialPrompt, 100) }}"
          </div>

          <!-- Actions row -->
          <div class="flex items-center gap-2 mt-2.5">
            <!-- View Transcript Button -->
            <button
              v-if="session.eventCount > 0"
              @click.stop="openTranscript(session.id)"
              class="px-3 py-1.5 text-xs font-medium bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-dark)] text-white rounded-lg transition-colors"
            >
              View Transcript
            </button>

            <!-- Session Settings Button -->
            <button
              @click.stop="openSessionSettings(session)"
              class="px-3 py-1.5 text-xs font-medium bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] rounded-lg transition-colors"
              title="Session-level settings overrides"
            >
              <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>

            <!-- Reassign Session Button -->
            <button
              @click.stop="openReassignModal(session)"
              class="px-3 py-1.5 text-xs font-medium bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] rounded-lg transition-colors"
              title="Move to another project"
            >
              <svg class="w-3.5 h-3.5 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Move
            </button>

            <!-- Open Terminal Button -->
            <button
              v-if="session.cwd"
              @click.stop="openTerminal(session)"
              @mouseenter="checkTmuxAvailability(session.id)"
              class="px-3 py-1.5 text-xs font-medium bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] rounded-lg transition-colors flex items-center gap-1.5"
              :title="getTmuxTooltip(session)"
            >
              <!-- Tmux status indicator -->
              <div
                class="w-2 h-2 rounded-full flex-shrink-0"
                :class="getTmuxStatusColor(getTmuxStatus(session.id))"
              ></div>
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Terminal
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Project Settings Modal -->
    <ProjectSettingsModal
      :project="project"
      :visible="showSettings"
      @close="showSettings = false"
      @update:project="handleProjectUpdate"
    />

    <!-- Session Reassign Modal -->
    <SessionReassignModal
      :session="sessionToReassign"
      :currentProject="project"
      :projects="allProjects"
      :visible="showReassignModal"
      @close="closeReassignModal"
      @reassign="handleSessionReassign"
    />

    <!-- Session Settings Modal -->
    <SessionSettingsModal
      :session="sessionForSettings"
      :visible="showSessionSettings"
      @close="showSessionSettings = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { Project, ProjectSession, TmuxAvailability } from '../types'
import { useProjects } from '../composables/useProjects'
import { useEventColors } from '../composables/useEventColors'
import ProjectSettingsModal from './ProjectSettingsModal.vue'
import SessionReassignModal from './SessionReassignModal.vue'
import SessionSettingsModal from './SessionSettingsModal.vue'

const props = defineProps<{
  project: Project
}>()

const emit = defineEmits<{
  back: []
  'update:project': [project: Project]
}>()

const {
  projects: allProjects,
  projectSessions: sessions,
  isLoading,
  fetchProjects,
  fetchProjectSessions,
  updateProject,
  reassignSession
} = useProjects()

// Modal state
const showSettings = ref(false)
const showReassignModal = ref(false)
const sessionToReassign = ref<ProjectSession | null>(null)
const showSessionSettings = ref(false)
const sessionForSettings = ref<ProjectSession | null>(null)
const { getHexColorForApp } = useEventColors()

// Tmux availability state
const sessionTmuxInfo = ref<Map<string, TmuxAvailability>>(new Map())
const checkingTmux = ref<Set<string>>(new Set())

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

const sessionsWithCwd = computed(() =>
  sessions.value.filter(s => s.cwd)
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

function modelBadgeClass(name: string): string {
  const base = 'px-1.5 py-0.5 rounded text-xs font-medium'
  if (name.includes('opus')) return `${base} bg-purple-500/20 text-purple-400`
  if (name.includes('sonnet')) return `${base} bg-blue-500/20 text-blue-400`
  if (name.includes('haiku')) return `${base} bg-green-500/20 text-green-400`
  return `${base} bg-gray-500/20 text-gray-400`
}

function shortenPath(path: string): string {
  if (!path) return ''

  // Replace common home directory patterns with ~
  let short = path
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^C:\\Users\\[^\\]+/, '~')
    .replace(/^\/mnt\/c\/Users\/[^/]+/, '~')

  // If still long, show last 3 segments
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = short.split(separator).filter(Boolean)
  if (parts.length > 4) {
    short = '.../' + parts.slice(-3).join('/')
  }

  return short
}

function truncateText(text: string | undefined, maxLen: number): string {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trim() + '...'
}

function openTranscript(sessionId: string) {
  window.open(`/?transcript=${sessionId}`, '_blank')
}

// Open reassign modal
function openReassignModal(session: ProjectSession) {
  sessionToReassign.value = session
  showReassignModal.value = true
}

// Close reassign modal
function closeReassignModal() {
  showReassignModal.value = false
  sessionToReassign.value = null
}

// Open session settings modal
function openSessionSettings(session: ProjectSession) {
  sessionForSettings.value = session
  showSessionSettings.value = true
}

// Terminal integration with ttyd
const TTYD_URL = import.meta.env.VITE_TTYD_URL || 'https://ttyd.di4.dev'
const API_URL = import.meta.env.VITE_API_URL || ''

// Check tmux availability for a session
async function checkTmuxAvailability(sessionId: string): Promise<TmuxAvailability | null> {
  if (checkingTmux.value.has(sessionId)) {
    return null // Already checking
  }

  checkingTmux.value.add(sessionId)

  try {
    const response = await fetch(`${API_URL}/api/sessions/${sessionId}/tmux`)
    const result = await response.json()

    if (result.success && result.data) {
      const availability: TmuxAvailability = {
        available: result.data.available,
        tmuxInfo: result.data.tmuxInfo,
        ttydUrl: result.data.ttydUrl,
        error: result.data.error,
        lastChecked: result.data.lastChecked || Date.now()
      }
      sessionTmuxInfo.value.set(sessionId, availability)
      return availability
    }
  } catch (err) {
    console.warn('Failed to check tmux:', err)
  } finally {
    checkingTmux.value.delete(sessionId)
  }

  return null
}

// Get tmux status for display
function getTmuxStatus(sessionId: string): 'live' | 'attachable' | 'checking' | 'unavailable' {
  if (checkingTmux.value.has(sessionId)) {
    return 'checking'
  }

  const info = sessionTmuxInfo.value.get(sessionId)
  if (!info || !info.available) {
    return 'unavailable'
  }

  return info.tmuxInfo?.isAttached ? 'live' : 'attachable'
}

function getTmuxStatusColor(status: string): string {
  switch (status) {
    case 'live': return 'bg-green-500'
    case 'attachable': return 'bg-yellow-500'
    case 'checking': return 'bg-blue-500 animate-pulse'
    default: return 'bg-gray-500'
  }
}

function getTmuxTooltip(session: ProjectSession): string {
  const status = getTmuxStatus(session.id)
  const info = sessionTmuxInfo.value.get(session.id)

  switch (status) {
    case 'live':
      return `Attach to live tmux session: ${info?.tmuxInfo?.target}`
    case 'attachable':
      return `Attach to tmux session: ${info?.tmuxInfo?.target}`
    case 'checking':
      return 'Checking tmux availability...'
    default:
      return 'Copy tmux command & open terminal (paste with Ctrl+Shift+V)'
  }
}

async function openTerminal(session: ProjectSession) {
  const shortId = session.id.slice(0, 8)

  // Check if session is available in tmux
  let tmuxData = sessionTmuxInfo.value.get(session.id)
  if (!tmuxData) {
    tmuxData = await checkTmuxAvailability(session.id)
  }

  if (tmuxData && tmuxData.available && tmuxData.ttydUrl) {
    // Session found in tmux - attach directly
    console.log('Attaching to tmux session:', tmuxData.tmuxInfo?.target)
    window.open(tmuxData.ttydUrl, `terminal-${shortId}`)
  } else {
    // Fallback: copy command and open ttyd
    const cwd = session.cwd || '~'
    const tmuxCmd = `cd '${cwd}' && tmux new-session -A -s obs-${shortId}`

    try {
      await navigator.clipboard.writeText(tmuxCmd)
      console.log('Command copied to clipboard:', tmuxCmd)
    } catch (err) {
      console.error('Failed to copy:', err)
    }

    window.open(TTYD_URL, `terminal-${shortId}`)
  }
}

function openAllTerminals() {
  sessionsWithCwd.value.forEach((session, i) => {
    // Stagger popup windows to avoid browser blocking
    setTimeout(() => openTerminal(session), i * 300)
  })
}

// Handle session reassignment
async function handleSessionReassign(sessionId: string, newProjectId: string) {
  const result = await reassignSession(sessionId, newProjectId)
  if (result) {
    closeReassignModal()
    // Refresh sessions list
    await fetchProjectSessions(props.project.id)
  }
}

// Handle project update from settings modal
async function handleProjectUpdate(updatedProject: Project) {
  const success = await updateProject(props.project.id, {
    displayName: updatedProject.displayName,
    description: updatedProject.description
  })
  if (success) {
    emit('update:project', updatedProject)
  }
}

// Load sessions when project changes
watch(() => props.project.id, (newId) => {
  fetchProjectSessions(newId)
}, { immediate: true })

onMounted(async () => {
  await fetchProjects() // Load all projects for reassignment dropdown
  fetchProjectSessions(props.project.id)
})
</script>
