import { ref, computed } from 'vue'
import type { ProjectSession, ApiResponse } from '../types'

// Reactive state
const unassignedSessions = ref<ProjectSession[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// API base URL
const API_BASE = 'http://localhost:4000/api'

export function useOrphanedSessions() {
  // Computed: count of unassigned sessions
  const unassignedCount = computed(() => unassignedSessions.value.length)

  // Computed: group by working directory (for suggestions)
  const sessionsByDirectory = computed(() => {
    const grouped: Record<string, ProjectSession[]> = {}
    for (const session of unassignedSessions.value) {
      const dir = session.cwd || 'unknown'
      if (!grouped[dir]) {
        grouped[dir] = []
      }
      grouped[dir].push(session)
    }
    return grouped
  })

  // Fetch unassigned sessions (from auto-created projects)
  async function fetchUnassignedSessions(): Promise<ProjectSession[]> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/sessions/unassigned`)
      const data: ApiResponse<ProjectSession[]> = await response.json()

      if (data.success && data.data) {
        unassignedSessions.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch unassigned sessions'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Assign a session to a project
  async function assignToProject(sessionId: string, projectId: string): Promise<ProjectSession | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId })
      })
      const data: ApiResponse<ProjectSession> = await response.json()

      if (data.success && data.data) {
        // Remove from unassigned list
        unassignedSessions.value = unassignedSessions.value.filter(s => s.id !== sessionId)
        return data.data
      } else {
        error.value = data.error || 'Failed to assign session'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Assign multiple sessions to a project
  async function assignMultipleToProject(sessionIds: string[], projectId: string): Promise<number> {
    let successCount = 0

    for (const sessionId of sessionIds) {
      const result = await assignToProject(sessionId, projectId)
      if (result) {
        successCount++
      }
    }

    return successCount
  }

  // Find sessions that might belong to a project (based on cwd or git branch)
  function suggestForProject(projectPath: string): ProjectSession[] {
    const normalizedPath = projectPath.toLowerCase().replace(/\\/g, '/')
    return unassignedSessions.value.filter(session => {
      const sessionPath = (session.cwd || '').toLowerCase().replace(/\\/g, '/')
      return sessionPath.includes(normalizedPath) || normalizedPath.includes(sessionPath)
    })
  }

  // Clear local state
  function clearUnassignedSessions(): void {
    unassignedSessions.value = []
    error.value = null
  }

  return {
    // State
    unassignedSessions,
    unassignedCount,
    sessionsByDirectory,
    isLoading,
    error,
    // Methods
    fetchUnassignedSessions,
    assignToProject,
    assignMultipleToProject,
    suggestForProject,
    clearUnassignedSessions
  }
}
