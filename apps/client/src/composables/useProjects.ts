import { ref, computed } from 'vue'
import type { Project, ProjectSession, ProjectSearchQuery, ReassignSessionResult } from '../types'
import { API_BASE_URL } from '../config'

// Reactive state
const projects = ref<Project[]>([])
const selectedProject = ref<Project | null>(null)
const projectSessions = ref<ProjectSession[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useProjects() {
  // Fetch all projects
  async function fetchProjects(query?: ProjectSearchQuery): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const params = new URLSearchParams()
      if (query?.status) params.set('status', query.status)
      if (query?.query) params.set('query', query.query)
      if (query?.sortBy) params.set('sortBy', query.sortBy)
      if (query?.sortOrder) params.set('sortOrder', query.sortOrder)
      if (query?.limit) params.set('limit', String(query.limit))

      const url = `${API_BASE_URL}/api/projects${params.toString() ? '?' + params.toString() : ''}`
      console.log('[useProjects] Fetching from:', url)
      const response = await fetch(url)
      const data = await response.json()
      console.log('[useProjects] Response:', data)

      if (data.success) {
        projects.value = data.data
        console.log('[useProjects] Loaded', projects.value.length, 'projects')
      } else {
        error.value = data.error || 'Failed to fetch projects'
        console.error('[useProjects] Error:', error.value)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      console.error('[useProjects] Catch error:', e)
    } finally {
      isLoading.value = false
    }
  }

  // Fetch single project
  async function fetchProject(id: string): Promise<Project | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`)
      const data = await response.json()

      if (data.success) {
        selectedProject.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch project'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Fetch project sessions
  async function fetchProjectSessions(projectId: string): Promise<ProjectSession[]> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/sessions`)
      const data = await response.json()

      if (data.success) {
        projectSessions.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch sessions'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Update project
  async function updateProject(id: string, updates: Partial<Project>): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const data = await response.json()

      if (data.success) {
        // Update in local list
        const idx = projects.value.findIndex(p => p.id === id)
        if (idx !== -1) {
          projects.value[idx] = data.data
        }
        if (selectedProject.value?.id === id) {
          selectedProject.value = data.data
        }
        return true
      } else {
        error.value = data.error || 'Failed to update project'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Archive project
  async function archiveProject(id: string): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      })
      const data = await response.json()

      if (data.success) {
        // Update status in local list
        const idx = projects.value.findIndex(p => p.id === id)
        if (idx !== -1) {
          projects.value[idx].status = 'archived'
        }
        return true
      } else {
        error.value = data.error || 'Failed to archive project'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Create new project (manual)
  async function createProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
      })
      const data = await response.json()

      if (data.success) {
        // Add to local list
        projects.value = [...projects.value, data.data]
        return data.data
      } else {
        error.value = data.error || 'Failed to create project'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Select a project and load its sessions
  async function selectProject(project: Project | null): Promise<void> {
    selectedProject.value = project
    if (project) {
      await fetchProjectSessions(project.id)
    } else {
      projectSessions.value = []
    }
  }

  // Reassign session to a different project
  async function reassignSession(sessionId: string, newProjectId: string): Promise<ReassignSessionResult | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/reassign`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: newProjectId })
      })
      const data = await response.json()

      if (data.success) {
        // Remove session from current project sessions list
        const idx = projectSessions.value.findIndex(s => s.id === sessionId)
        if (idx !== -1) {
          projectSessions.value.splice(idx, 1)
        }
        return data.data
      } else {
        error.value = data.error || 'Failed to reassign session'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Computed helpers
  const activeProjects = computed(() =>
    projects.value.filter(p => p.status === 'active')
  )

  const archivedProjects = computed(() =>
    projects.value.filter(p => p.status === 'archived')
  )

  const totalEventCount = computed(() =>
    projectSessions.value.reduce((sum, s) => sum + s.eventCount, 0)
  )

  const totalToolCallCount = computed(() =>
    projectSessions.value.reduce((sum, s) => sum + s.toolCallCount, 0)
  )

  return {
    // State
    projects,
    selectedProject,
    projectSessions,
    isLoading,
    error,

    // Actions
    fetchProjects,
    fetchProject,
    fetchProjectSessions,
    updateProject,
    archiveProject,
    createProject,
    selectProject,
    reassignSession,

    // Computed
    activeProjects,
    archivedProjects,
    totalEventCount,
    totalToolCallCount
  }
}
