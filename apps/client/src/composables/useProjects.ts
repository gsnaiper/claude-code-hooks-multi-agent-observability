import { ref, computed } from 'vue'
import type { Project, ProjectSession, ProjectSearchQuery } from '../types'
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
      const response = await fetch(url)
      const data = await response.json()

      if (data.success) {
        projects.value = data.data
      } else {
        error.value = data.error || 'Failed to fetch projects'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
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

  // Select a project and load its sessions
  async function selectProject(project: Project | null): Promise<void> {
    selectedProject.value = project
    if (project) {
      await fetchProjectSessions(project.id)
    } else {
      projectSessions.value = []
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
    selectProject,

    // Computed
    activeProjects,
    archivedProjects,
    totalEventCount,
    totalToolCallCount
  }
}
