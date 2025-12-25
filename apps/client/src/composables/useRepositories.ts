import { ref, computed } from 'vue'
import type { Repository, RepositoryInput, ApiResponse } from '../types'

// Reactive state
const repositories = ref<Repository[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// API base URL
const API_BASE = 'http://localhost:4000/api'

export function useRepositories() {
  // Computed: get primary repository
  const primaryRepository = computed(() =>
    repositories.value.find(r => r.isPrimary) || repositories.value[0]
  )

  // Fetch all repositories for a project
  async function fetchRepositories(projectId: string): Promise<Repository[]> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/repositories`)
      const data: ApiResponse<Repository[]> = await response.json()

      if (data.success && data.data) {
        repositories.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch repositories'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Add a new repository
  async function addRepository(projectId: string, input: RepositoryInput): Promise<Repository | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/repositories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      })
      const data: ApiResponse<Repository> = await response.json()

      if (data.success && data.data) {
        repositories.value = [...repositories.value, data.data]
        return data.data
      } else {
        error.value = data.error || 'Failed to add repository'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Update a repository
  async function updateRepository(projectId: string, repoId: string, updates: Partial<RepositoryInput>): Promise<Repository | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const data: ApiResponse<Repository> = await response.json()

      if (data.success && data.data) {
        repositories.value = repositories.value.map(r => r.id === repoId ? data.data! : r)
        return data.data
      } else {
        error.value = data.error || 'Failed to update repository'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Delete a repository
  async function deleteRepository(projectId: string, repoId: string): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}`, {
        method: 'DELETE'
      })
      const data: ApiResponse = await response.json()

      if (data.success) {
        repositories.value = repositories.value.filter(r => r.id !== repoId)
        return true
      } else {
        error.value = data.error || 'Failed to delete repository'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Set a repository as primary
  async function setPrimary(projectId: string, repoId: string): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(`${API_BASE}/projects/${encodeURIComponent(projectId)}/repositories/${encodeURIComponent(repoId)}/primary`, {
        method: 'PUT'
      })
      const data: ApiResponse = await response.json()

      if (data.success) {
        // Update local state - clear all primaries then set the one
        repositories.value = repositories.value.map(r => ({
          ...r,
          isPrimary: r.id === repoId
        }))
        return true
      } else {
        error.value = data.error || 'Failed to set primary repository'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Clear local state
  function clearRepositories(): void {
    repositories.value = []
    error.value = null
  }

  return {
    // State
    repositories,
    primaryRepository,
    isLoading,
    error,
    // Methods
    fetchRepositories,
    addRepository,
    updateRepository,
    deleteRepository,
    setPrimary,
    clearRepositories
  }
}
