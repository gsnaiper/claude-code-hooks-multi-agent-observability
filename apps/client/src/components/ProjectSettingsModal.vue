<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Project, SettingType, ProjectSetting, PermissionsSettingValue } from '../types'
import { useProjectSettings } from '../composables/useProjectSettings'
import SettingsTabPanel from './settings/SettingsTabPanel.vue'
import SkillsEditor from './settings/SkillsEditor.vue'
import AgentsEditor from './settings/AgentsEditor.vue'
import CommandsEditor from './settings/CommandsEditor.vue'
import PermissionsEditor from './settings/PermissionsEditor.vue'
import HooksEditor from './settings/HooksEditor.vue'
import OutputStylesEditor from './settings/OutputStylesEditor.vue'

const props = defineProps<{
  project: Project
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'update:project', project: Project): void
}>()

const {
  settingsByType,
  isLoading,
  error,
  fetchSettings,
  toggleSetting,
  deleteSetting,
  updateSetting,
  enabledCounts
} = useProjectSettings()

// Local state
const activeTab = ref<SettingType>('skills')
const editingName = ref(false)
const localName = ref('')
const localDescription = ref('')

// Initialize form when project changes
watch(
  () => props.project,
  (newProject) => {
    localName.value = newProject.displayName || newProject.id
    localDescription.value = newProject.description || ''
  },
  { immediate: true }
)

// Load settings when modal opens
watch(
  () => props.visible,
  async (visible) => {
    if (visible && props.project) {
      await fetchSettings(props.project.id)
    }
  },
  { immediate: true }
)

// Computed counts for tabs
const counts = computed(() => {
  const result: Record<SettingType, number> = {
    skills: 0,
    agents: 0,
    commands: 0,
    permissions: 0,
    hooks: 0,
    output_styles: 0
  }

  for (const type of Object.keys(settingsByType.value) as SettingType[]) {
    result[type] = settingsByType.value[type].length
  }

  return result
})

// Save project metadata
async function saveProjectInfo() {
  emit('update:project', {
    ...props.project,
    displayName: localName.value,
    description: localDescription.value
  })
  editingName.value = false
}

// Handle setting toggle
async function handleToggle(setting: ProjectSetting) {
  await toggleSetting(setting)
}

// Handle setting deletion
async function handleDelete(setting: ProjectSetting) {
  if (confirm(`Delete "${setting.settingKey}"?`)) {
    await deleteSetting(props.project.id, setting.settingType, setting.settingKey)
  }
}

// Handle add new setting
function handleAdd() {
  // In a real implementation, this would open a sub-modal for adding
  console.log('Add new setting for type:', activeTab.value)
  alert(`Add ${activeTab.value} - Coming soon!`)
}

// Handle edit setting
function handleEdit(setting: ProjectSetting) {
  console.log('Edit setting:', setting)
  alert(`Edit ${setting.settingKey} - Coming soon!`)
}

// Handle permissions update
async function handlePermissionsUpdate(key: string, value: PermissionsSettingValue) {
  await updateSetting(props.project.id, 'permissions', key, value, true)
}

// Close modal
function close() {
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 overflow-y-auto"
      @click.self="close"
    >
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/50 transition-opacity" @click="close" />

      <!-- Modal -->
      <div class="relative min-h-screen flex items-center justify-center p-4">
        <div
          class="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
          @click.stop
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div class="flex-1">
              <!-- Project name - editable -->
              <div v-if="editingName" class="flex items-center gap-2">
                <input
                  v-model="localName"
                  type="text"
                  class="text-xl font-semibold bg-transparent border-b-2 border-blue-500 focus:outline-none text-gray-900 dark:text-white"
                  @keyup.enter="saveProjectInfo"
                  @keyup.escape="editingName = false"
                  autofocus
                />
                <button
                  @click="saveProjectInfo"
                  class="text-green-600 hover:text-green-700"
                >
                  ✓
                </button>
                <button
                  @click="editingName = false"
                  class="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <h2
                v-else
                class="text-xl font-semibold text-gray-900 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                @click="editingName = true"
                title="Click to rename"
              >
                {{ localName }}
                <span class="text-sm font-normal text-gray-400 ml-2">
                  (click to rename)
                </span>
              </h2>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {{ project.id }}
              </p>
            </div>

            <!-- Close button -->
            <button
              @click="close"
              class="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Description -->
          <div class="px-6 py-3 border-b border-gray-200 dark:border-gray-700">
            <textarea
              v-model="localDescription"
              placeholder="Add a project description..."
              rows="2"
              class="w-full text-sm bg-transparent border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 text-gray-700 dark:text-gray-300 placeholder-gray-400 resize-none"
              @blur="saveProjectInfo"
            />
          </div>

          <!-- Tabs -->
          <SettingsTabPanel
            :activeTab="activeTab"
            :counts="counts"
            @update:activeTab="activeTab = $event"
          />

          <!-- Content -->
          <div class="flex-1 overflow-y-auto p-6">
            <!-- Error display -->
            <div
              v-if="error"
              class="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg"
            >
              {{ error }}
            </div>

            <!-- Tab content -->
            <SkillsEditor
              v-if="activeTab === 'skills'"
              :settings="settingsByType.skills"
              :isLoading="isLoading"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
              @add="handleAdd"
            />

            <AgentsEditor
              v-else-if="activeTab === 'agents'"
              :settings="settingsByType.agents"
              :isLoading="isLoading"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
              @add="handleAdd"
            />

            <CommandsEditor
              v-else-if="activeTab === 'commands'"
              :settings="settingsByType.commands"
              :isLoading="isLoading"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
              @add="handleAdd"
            />

            <PermissionsEditor
              v-else-if="activeTab === 'permissions'"
              :settings="settingsByType.permissions"
              :isLoading="isLoading"
              @update="handlePermissionsUpdate"
            />

            <HooksEditor
              v-else-if="activeTab === 'hooks'"
              :settings="settingsByType.hooks"
              :isLoading="isLoading"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
              @add="handleAdd"
            />

            <OutputStylesEditor
              v-else-if="activeTab === 'output_styles'"
              :settings="settingsByType.output_styles"
              :isLoading="isLoading"
              @toggle="handleToggle"
              @edit="handleEdit"
              @delete="handleDelete"
              @add="handleAdd"
            />
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div class="text-sm text-gray-500 dark:text-gray-400">
              {{ enabledCounts.skills + enabledCounts.agents + enabledCounts.commands + enabledCounts.hooks + enabledCounts.output_styles }} settings enabled
            </div>
            <button
              @click="close"
              class="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
