<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { ProjectSession, ProjectSetting, SessionSetting, SettingType } from '../types'
import { useSessionSettings } from '../composables/useSessionSettings'
import { useProjectSettings } from '../composables/useProjectSettings'

const props = defineProps<{
  session: ProjectSession | null
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const {
  sessionSettings,
  overrideCounts,
  isLoading: sessionLoading,
  error: sessionError,
  fetchSessionOverrides,
  fetchEffectiveSettings,
  upsertSessionSetting,
  deleteSessionSetting,
  isOverridden,
  getOverrideInfo
} = useSessionSettings()

const {
  settingsByType: projectSettingsByType,
  isLoading: projectLoading,
  fetchSettings: fetchProjectSettings
} = useProjectSettings()

const activeTab = ref<SettingType>('skills')
const editingKey = ref<string | null>(null)
const editValue = ref<string>('')
const editOverrideMode = ref<'replace' | 'extend' | 'disable'>('replace')

// Load settings when modal opens or session changes
watch([() => props.visible, () => props.session], async ([visible, session]) => {
  if (visible && session) {
    await Promise.all([
      fetchProjectSettings(session.projectId),
      fetchSessionOverrides(session.id),
      fetchEffectiveSettings(session.id)
    ])
  }
}, { immediate: true })

// Computed: get project settings for current tab
const currentProjectSettings = computed(() => {
  return projectSettingsByType.value[activeTab.value] || []
})

// Computed: check if a setting has override
function hasOverride(type: SettingType, key: string): boolean {
  return isOverridden(type, key)
}

// Computed: get override info for a setting
function getOverride(type: SettingType, key: string): SessionSetting | undefined {
  return getOverrideInfo(type, key)
}

// Start editing a setting override
function startEdit(setting: ProjectSetting): void {
  editingKey.value = setting.settingKey
  const override = getOverride(setting.settingType, setting.settingKey)
  if (override) {
    editValue.value = JSON.stringify(override.settingValue, null, 2)
    editOverrideMode.value = override.overrideMode
  } else {
    editValue.value = JSON.stringify(setting.settingValue, null, 2)
    editOverrideMode.value = 'replace'
  }
}

// Save override
async function saveOverride(setting: ProjectSetting): Promise<void> {
  if (!props.session) return

  try {
    const value = JSON.parse(editValue.value)
    await upsertSessionSetting(
      props.session.id,
      setting.settingType,
      setting.settingKey,
      value,
      editOverrideMode.value,
      true
    )
    editingKey.value = null
  } catch (e) {
    console.error('Invalid JSON:', e)
  }
}

// Remove override
async function removeOverride(setting: ProjectSetting): Promise<void> {
  if (!props.session) return
  await deleteSessionSetting(props.session.id, setting.settingType, setting.settingKey)
}

// Disable a project setting for this session
async function disableSetting(setting: ProjectSetting): Promise<void> {
  if (!props.session) return
  await upsertSessionSetting(
    props.session.id,
    setting.settingType,
    setting.settingKey,
    {},
    'disable',
    true
  )
}

function close(): void {
  editingKey.value = null
  emit('close')
}

function handleBackdropClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    close()
  }
}

const isLoading = computed(() => sessionLoading.value || projectLoading.value)
const error = computed(() => sessionError.value)

const settingTypes: SettingType[] = ['skills', 'agents', 'commands', 'permissions', 'hooks', 'output_styles']

function getTabLabel(type: SettingType): string {
  const labels: Record<SettingType, string> = {
    skills: 'Skills',
    agents: 'Agents',
    commands: 'Commands',
    permissions: 'Permissions',
    hooks: 'Hooks',
    output_styles: 'Output'
  }
  return labels[type]
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && session"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click="handleBackdropClick"
    >
      <div class="w-full max-w-4xl max-h-[85vh] bg-[var(--bg-primary)] rounded-xl shadow-2xl border border-[var(--border-primary)] flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 class="text-xl font-semibold text-[var(--text-primary)]">Session Settings</h2>
            <p class="text-sm text-[var(--text-tertiary)]">
              Session: <span class="font-mono">{{ session.id.slice(0, 8) }}</span>
              <span class="mx-2">|</span>
              Inheriting from: <span class="text-[var(--primary)]">{{ session.projectId }}</span>
            </p>
          </div>
          <button
            @click="close"
            class="p-2 rounded-lg hover:bg-[var(--hover-bg)] text-[var(--text-secondary)] transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b border-[var(--border-primary)]">
          <button
            v-for="type in settingTypes"
            :key="type"
            @click="activeTab = type"
            :class="[
              'px-4 py-3 text-sm font-medium transition-colors relative',
              activeTab === type
                ? 'text-[var(--primary)] bg-[var(--bg-secondary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)]'
            ]"
          >
            {{ getTabLabel(type) }}
            <span
              v-if="overrideCounts[type] > 0"
              class="ml-1.5 px-1.5 py-0.5 text-xs bg-[var(--primary)] text-white rounded-full"
            >
              {{ overrideCounts[type] }}
            </span>
            <div
              v-if="activeTab === type"
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary)]"
            />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-4">
          <!-- Loading -->
          <div v-if="isLoading" class="flex items-center justify-center py-12">
            <div class="animate-spin rounded-full h-8 w-8 border-2 border-[var(--primary)] border-t-transparent"></div>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p class="text-sm text-red-400">{{ error }}</p>
          </div>

          <!-- Settings List -->
          <div v-else class="space-y-3">
            <div v-if="currentProjectSettings.length === 0" class="text-center py-8 text-[var(--text-tertiary)]">
              <p class="text-sm">No {{ getTabLabel(activeTab).toLowerCase() }} settings in project</p>
            </div>

            <div
              v-for="setting in currentProjectSettings"
              :key="setting.id"
              :class="[
                'p-4 rounded-lg border transition-colors',
                hasOverride(setting.settingType, setting.settingKey)
                  ? 'bg-[var(--primary)]/10 border-[var(--primary)]/30'
                  : 'bg-[var(--bg-secondary)] border-[var(--border-secondary)]'
              ]"
            >
              <div class="flex items-start justify-between mb-2">
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-[var(--text-primary)]">{{ setting.settingKey }}</span>
                    <!-- Override Indicator -->
                    <span
                      v-if="hasOverride(setting.settingType, setting.settingKey)"
                      :class="[
                        'px-1.5 py-0.5 text-xs rounded',
                        getOverride(setting.settingType, setting.settingKey)?.overrideMode === 'disable'
                          ? 'bg-red-500/20 text-red-400'
                          : getOverride(setting.settingType, setting.settingKey)?.overrideMode === 'extend'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-[var(--primary)]/20 text-[var(--primary)]'
                      ]"
                    >
                      {{ getOverride(setting.settingType, setting.settingKey)?.overrideMode }}
                    </span>
                    <span v-else class="text-xs text-[var(--text-tertiary)]">(from project)</span>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button
                    v-if="!hasOverride(setting.settingType, setting.settingKey)"
                    @click="startEdit(setting)"
                    class="px-2 py-1 text-xs text-[var(--primary)] hover:bg-[var(--primary)]/10 rounded transition-colors"
                  >
                    Override
                  </button>
                  <button
                    v-if="!hasOverride(setting.settingType, setting.settingKey)"
                    @click="disableSetting(setting)"
                    class="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                  >
                    Disable
                  </button>
                  <template v-else>
                    <button
                      @click="startEdit(setting)"
                      class="px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] rounded transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      @click="removeOverride(setting)"
                      class="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    >
                      Remove Override
                    </button>
                  </template>
                </div>
              </div>

              <!-- Editing Area -->
              <div v-if="editingKey === setting.settingKey" class="mt-3 space-y-3">
                <div>
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">Override Mode</label>
                  <div class="flex gap-2">
                    <button
                      v-for="mode in ['replace', 'extend', 'disable'] as const"
                      :key="mode"
                      @click="editOverrideMode = mode"
                      :class="[
                        'px-3 py-1.5 text-xs rounded transition-colors',
                        editOverrideMode === mode
                          ? 'bg-[var(--primary)] text-white'
                          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--hover-bg)]'
                      ]"
                    >
                      {{ mode }}
                    </button>
                  </div>
                </div>

                <div v-if="editOverrideMode !== 'disable'">
                  <label class="block text-xs text-[var(--text-secondary)] mb-1">Value (JSON)</label>
                  <textarea
                    v-model="editValue"
                    rows="4"
                    class="w-full px-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-sm font-mono text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] resize-none"
                  />
                </div>

                <div class="flex justify-end gap-2">
                  <button
                    @click="editingKey = null"
                    class="px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    @click="saveOverride(setting)"
                    class="px-3 py-1.5 text-xs bg-[var(--primary)] text-white rounded hover:bg-[var(--primary-hover)] transition-colors"
                  >
                    Save Override
                  </button>
                </div>
              </div>

              <!-- Value Preview (when not editing) -->
              <div v-else class="mt-2">
                <pre class="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] p-2 rounded overflow-x-auto max-h-32">{{
                  JSON.stringify(
                    hasOverride(setting.settingType, setting.settingKey)
                      ? getOverride(setting.settingType, setting.settingKey)?.settingValue
                      : setting.settingValue,
                    null,
                    2
                  )
                }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between p-4 border-t border-[var(--border-primary)]">
          <div class="text-sm text-[var(--text-tertiary)]">
            {{ sessionSettings.length }} override(s) active
          </div>
          <button
            @click="close"
            class="px-4 py-2 text-sm bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-lg hover:bg-[var(--hover-bg)] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
