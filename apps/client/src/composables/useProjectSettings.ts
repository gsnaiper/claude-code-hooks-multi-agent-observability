import { ref, computed } from 'vue'
import type { ProjectSetting, ProjectSettingInput, SettingType, ApiResponse } from '../types'
import { API_BASE_URL } from '../config'

// Reactive state
const settings = ref<ProjectSetting[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Group settings by type
const settingsByType = computed(() => {
  const grouped: Record<SettingType, ProjectSetting[]> = {
    skills: [],
    agents: [],
    commands: [],
    permissions: [],
    hooks: [],
    output_styles: []
  }

  for (const setting of settings.value) {
    if (grouped[setting.settingType]) {
      grouped[setting.settingType].push(setting)
    }
  }

  return grouped
})

export function useProjectSettings() {
  // Fetch all settings for a project
  async function fetchSettings(projectId: string, type?: SettingType): Promise<ProjectSetting[]> {
    isLoading.value = true
    error.value = null

    try {
      const url = type
        ? `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/settings/${type}`
        : `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/settings`

      const response = await fetch(url)
      const data: ApiResponse<ProjectSetting[]> = await response.json()

      if (data.success && data.data) {
        if (type) {
          // Update only settings of this type
          settings.value = settings.value.filter(s => s.settingType !== type).concat(data.data)
        } else {
          settings.value = data.data
        }
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch settings'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Get a specific setting
  async function getSetting(projectId: string, type: SettingType, key: string): Promise<ProjectSetting | null> {
    const existing = settings.value.find(
      s => s.projectId === projectId && s.settingType === type && s.settingKey === key
    )
    if (existing) return existing

    // Fetch from server if not in local cache
    const fetched = await fetchSettings(projectId, type)
    return fetched.find(s => s.settingKey === key) || null
  }

  // Update or create a setting
  async function updateSetting(
    projectId: string,
    type: SettingType,
    key: string,
    value: Record<string, any>,
    enabled?: boolean
  ): Promise<ProjectSetting | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/settings/${type}/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settingValue: value, enabled })
        }
      )
      const data: ApiResponse<ProjectSetting> = await response.json()

      if (data.success && data.data) {
        // Update local state
        const idx = settings.value.findIndex(
          s => s.projectId === projectId && s.settingType === type && s.settingKey === key
        )
        if (idx !== -1) {
          settings.value[idx] = data.data
        } else {
          settings.value.push(data.data)
        }
        return data.data
      } else {
        error.value = data.error || 'Failed to update setting'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Toggle setting enabled/disabled
  async function toggleSetting(setting: ProjectSetting): Promise<boolean> {
    const result = await updateSetting(
      setting.projectId,
      setting.settingType,
      setting.settingKey,
      setting.settingValue,
      !setting.enabled
    )
    return result !== null
  }

  // Delete a setting
  async function deleteSetting(projectId: string, type: SettingType, key: string): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/settings/${type}/${encodeURIComponent(key)}`,
        { method: 'DELETE' }
      )
      const data: ApiResponse = await response.json()

      if (data.success) {
        // Remove from local state
        settings.value = settings.value.filter(
          s => !(s.projectId === projectId && s.settingType === type && s.settingKey === key)
        )
        return true
      } else {
        error.value = data.error || 'Failed to delete setting'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Bulk upsert settings
  async function bulkUpsertSettings(
    projectId: string,
    type: SettingType,
    settingsInput: ProjectSettingInput[]
  ): Promise<ProjectSetting[]> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/settings/${type}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: settingsInput })
        }
      )
      const data: ApiResponse<ProjectSetting[]> = await response.json()

      if (data.success && data.data) {
        // Update local state
        settings.value = settings.value.filter(
          s => !(s.projectId === projectId && s.settingType === type)
        ).concat(data.data)
        return data.data
      } else {
        error.value = data.error || 'Failed to bulk upsert settings'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Clear all settings for a project from local state
  function clearSettings(projectId?: string): void {
    if (projectId) {
      settings.value = settings.value.filter(s => s.projectId !== projectId)
    } else {
      settings.value = []
    }
  }

  // Get count of enabled settings by type
  const enabledCounts = computed(() => {
    const counts: Record<SettingType, number> = {
      skills: 0,
      agents: 0,
      commands: 0,
      permissions: 0,
      hooks: 0,
      output_styles: 0
    }

    for (const setting of settings.value) {
      if (setting.enabled && counts[setting.settingType] !== undefined) {
        counts[setting.settingType]++
      }
    }

    return counts
  })

  return {
    // State
    settings,
    settingsByType,
    isLoading,
    error,

    // Actions
    fetchSettings,
    getSetting,
    updateSetting,
    toggleSetting,
    deleteSetting,
    bulkUpsertSettings,
    clearSettings,

    // Computed
    enabledCounts
  }
}
