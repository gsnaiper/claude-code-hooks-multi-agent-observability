import { ref, computed } from 'vue'
import type { SessionSetting, SessionSettingInput, ProjectSetting, SettingType, ApiResponse, OverrideMode } from '../types'

// Reactive state
const sessionSettings = ref<SessionSetting[]>([])
const effectiveSettings = ref<ProjectSetting[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// API base URL
const API_BASE = 'http://localhost:4000/api'

// Track current session for detecting stale requests
let currentSessionId: string | null = null
// AbortController for cancelling in-flight requests
let abortController: AbortController | null = null

export function useSessionSettings() {
  // Computed: group settings by type
  const settingsByType = computed(() => {
    const grouped: Record<SettingType, SessionSetting[]> = {
      skills: [],
      agents: [],
      commands: [],
      permissions: [],
      hooks: [],
      output_styles: []
    }
    for (const setting of sessionSettings.value) {
      if (grouped[setting.settingType]) {
        grouped[setting.settingType].push(setting)
      }
    }
    return grouped
  })

  // Computed: count overrides by type
  const overrideCounts = computed(() => {
    const counts: Record<SettingType, number> = {
      skills: 0,
      agents: 0,
      commands: 0,
      permissions: 0,
      hooks: 0,
      output_styles: 0
    }
    for (const setting of sessionSettings.value) {
      if (counts[setting.settingType] !== undefined) {
        counts[setting.settingType]++
      }
    }
    return counts
  })

  // Fetch session-level overrides only
  async function fetchSessionOverrides(sessionId: string, type?: SettingType): Promise<SessionSetting[]> {
    // Cancel any in-flight request if session changed
    if (abortController && currentSessionId !== sessionId) {
      abortController.abort()
    }

    currentSessionId = sessionId
    abortController = new AbortController()
    const signal = abortController.signal

    isLoading.value = true
    error.value = null

    try {
      let url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/settings/overrides`
      if (type) {
        url += `?type=${encodeURIComponent(type)}`
      }

      const response = await fetch(url, { signal })
      const data: ApiResponse<SessionSetting[]> = await response.json()

      // Check if this request is still relevant (session hasn't changed)
      if (currentSessionId !== sessionId) {
        return [] // Stale request, ignore
      }

      if (data.success && data.data) {
        sessionSettings.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch session settings'
        return []
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return [] // Request was cancelled, not an error
      }
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Fetch effective settings (merged project + session)
  async function fetchEffectiveSettings(sessionId: string, type?: SettingType): Promise<ProjectSetting[]> {
    // Cancel any in-flight request if session changed
    if (abortController && currentSessionId !== sessionId) {
      abortController.abort()
    }

    currentSessionId = sessionId
    abortController = new AbortController()
    const signal = abortController.signal

    isLoading.value = true
    error.value = null

    try {
      let url = `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/settings`
      if (type) {
        url += `?type=${encodeURIComponent(type)}`
      }

      const response = await fetch(url, { signal })
      const data: ApiResponse<ProjectSetting[]> = await response.json()

      // Check if this request is still relevant (session hasn't changed)
      if (currentSessionId !== sessionId) {
        return [] // Stale request, ignore
      }

      if (data.success && data.data) {
        effectiveSettings.value = data.data
        return data.data
      } else {
        error.value = data.error || 'Failed to fetch effective settings'
        return []
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        return [] // Request was cancelled, not an error
      }
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Update or create a session setting override
  async function upsertSessionSetting(
    sessionId: string,
    type: SettingType,
    key: string,
    value: Record<string, any>,
    overrideMode: OverrideMode = 'replace',
    enabled: boolean = true
  ): Promise<SessionSetting | null> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/settings/${encodeURIComponent(type)}/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settingKey: key,
            settingValue: value,
            overrideMode,
            enabled
          } as SessionSettingInput)
        }
      )
      const data: ApiResponse<SessionSetting> = await response.json()

      if (data.success && data.data) {
        // Update local state
        const existing = sessionSettings.value.findIndex(
          s => s.settingType === type && s.settingKey === key
        )
        if (existing >= 0) {
          sessionSettings.value[existing] = data.data
        } else {
          sessionSettings.value = [...sessionSettings.value, data.data]
        }
        return data.data
      } else {
        error.value = data.error || 'Failed to update session setting'
        return null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Delete a session setting override (falls back to project setting)
  async function deleteSessionSetting(sessionId: string, type: SettingType, key: string): Promise<boolean> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/settings/${encodeURIComponent(type)}/${encodeURIComponent(key)}`,
        { method: 'DELETE' }
      )
      const data: ApiResponse = await response.json()

      if (data.success) {
        sessionSettings.value = sessionSettings.value.filter(
          s => !(s.settingType === type && s.settingKey === key)
        )
        return true
      } else {
        error.value = data.error || 'Failed to delete session setting'
        return false
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return false
    } finally {
      isLoading.value = false
    }
  }

  // Bulk upsert session settings
  async function bulkUpsertSessionSettings(
    sessionId: string,
    type: SettingType,
    settings: SessionSettingInput[]
  ): Promise<SessionSetting[]> {
    isLoading.value = true
    error.value = null

    try {
      const response = await fetch(
        `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/settings/${encodeURIComponent(type)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings })
        }
      )
      const data: ApiResponse<SessionSetting[]> = await response.json()

      if (data.success && data.data) {
        // Update local state
        const otherTypes = sessionSettings.value.filter(s => s.settingType !== type)
        sessionSettings.value = [...otherTypes, ...data.data]
        return data.data
      } else {
        error.value = data.error || 'Failed to bulk upsert session settings'
        return []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Network error'
      return []
    } finally {
      isLoading.value = false
    }
  }

  // Check if a setting is overridden at session level
  function isOverridden(type: SettingType, key: string): boolean {
    return sessionSettings.value.some(s => s.settingType === type && s.settingKey === key)
  }

  // Get override info for a setting
  function getOverrideInfo(type: SettingType, key: string): SessionSetting | undefined {
    return sessionSettings.value.find(s => s.settingType === type && s.settingKey === key)
  }

  // Clear local state
  function clearSessionSettings(): void {
    sessionSettings.value = []
    effectiveSettings.value = []
    error.value = null
  }

  return {
    // State
    sessionSettings,
    effectiveSettings,
    settingsByType,
    overrideCounts,
    isLoading,
    error,
    // Methods
    fetchSessionOverrides,
    fetchEffectiveSettings,
    upsertSessionSetting,
    deleteSessionSetting,
    bulkUpsertSessionSettings,
    isOverridden,
    getOverrideInfo,
    clearSessionSettings
  }
}
