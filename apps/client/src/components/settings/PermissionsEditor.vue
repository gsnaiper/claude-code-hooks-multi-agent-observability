<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ProjectSetting, PermissionsSettingValue } from '../../types'

const props = defineProps<{
  settings: ProjectSetting[]
  isLoading: boolean
}>()

const emit = defineEmits<{
  (e: 'update', key: string, value: PermissionsSettingValue): void
}>()

// Local state for editing
const localConfig = ref<PermissionsSettingValue>({
  protectedFiles: [],
  hitlEnabled: true,
  hitlTypes: {},
  timeouts: {}
})

const newProtectedFile = ref('')

// Load settings into local state
watch(
  () => props.settings,
  (newSettings) => {
    const permSetting = newSettings.find(s => s.settingKey === 'default')
    if (permSetting) {
      localConfig.value = { ...permSetting.settingValue as PermissionsSettingValue }
    }
  },
  { immediate: true }
)

const hitlTypeOptions = [
  { value: 'approval', label: 'Require Approval', description: 'Must approve before action' },
  { value: 'notify', label: 'Notify Only', description: 'Notify but proceed' },
  { value: 'auto', label: 'Auto-approve', description: 'No interaction needed' }
]

const defaultHitlTypes = [
  { key: 'Bash', label: 'Bash Commands' },
  { key: 'Edit', label: 'File Edits' },
  { key: 'Write', label: 'File Writes' },
  { key: 'WebFetch', label: 'Web Fetches' },
  { key: 'Task', label: 'Sub-agents' }
]

function addProtectedFile() {
  if (newProtectedFile.value.trim()) {
    if (!localConfig.value.protectedFiles) {
      localConfig.value.protectedFiles = []
    }
    localConfig.value.protectedFiles.push(newProtectedFile.value.trim())
    newProtectedFile.value = ''
    saveChanges()
  }
}

function removeProtectedFile(index: number) {
  localConfig.value.protectedFiles?.splice(index, 1)
  saveChanges()
}

function updateHitlType(key: string, value: 'approval' | 'notify' | 'auto') {
  if (!localConfig.value.hitlTypes) {
    localConfig.value.hitlTypes = {}
  }
  localConfig.value.hitlTypes[key] = value
  saveChanges()
}

function updateTimeout(key: string, value: number) {
  if (!localConfig.value.timeouts) {
    localConfig.value.timeouts = {}
  }
  localConfig.value.timeouts[key] = value
  saveChanges()
}

function toggleHitl() {
  localConfig.value.hitlEnabled = !localConfig.value.hitlEnabled
  saveChanges()
}

function saveChanges() {
  emit('update', 'default', { ...localConfig.value })
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h3 class="text-lg font-medium text-gray-900 dark:text-white">Permissions & HITL</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Configure human-in-the-loop approvals and protected files
      </p>
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="flex justify-center py-8">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>

    <template v-else>
      <!-- HITL Master Toggle -->
      <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium text-gray-900 dark:text-white">Human-in-the-Loop</div>
            <div class="text-sm text-gray-500 dark:text-gray-400">
              Enable approval workflows for sensitive operations
            </div>
          </div>
          <button
            @click="toggleHitl"
            :class="[
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              localConfig.hitlEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
            ]"
          >
            <span
              :class="[
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                localConfig.hitlEnabled ? 'translate-x-6' : 'translate-x-1'
              ]"
            />
          </button>
        </div>
      </div>

      <!-- HITL Type Settings -->
      <div v-if="localConfig.hitlEnabled" class="space-y-3">
        <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">Tool Approval Settings</h4>

        <div
          v-for="tool in defaultHitlTypes"
          :key="tool.key"
          class="flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
        >
          <div class="font-medium text-gray-900 dark:text-white">{{ tool.label }}</div>

          <div class="flex items-center gap-2">
            <select
              :value="localConfig.hitlTypes?.[tool.key] || 'approval'"
              @change="updateHitlType(tool.key, ($event.target as HTMLSelectElement).value as any)"
              class="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option v-for="opt in hitlTypeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>

            <!-- Timeout input -->
            <div class="flex items-center gap-1">
              <input
                type="number"
                :value="localConfig.timeouts?.[tool.key] || 30"
                @change="updateTimeout(tool.key, parseInt(($event.target as HTMLInputElement).value))"
                min="5"
                max="300"
                class="w-16 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <span class="text-xs text-gray-500">sec</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Protected Files -->
      <div class="space-y-3">
        <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">Protected Files</h4>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Files that require explicit approval before modification
        </p>

        <!-- Add new file -->
        <div class="flex gap-2">
          <input
            v-model="newProtectedFile"
            type="text"
            placeholder="e.g., .env, secrets.json, *.key"
            class="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
            @keyup.enter="addProtectedFile"
          />
          <button
            @click="addProtectedFile"
            class="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Add
          </button>
        </div>

        <!-- Protected files list -->
        <div v-if="localConfig.protectedFiles?.length" class="flex flex-wrap gap-2">
          <span
            v-for="(file, idx) in localConfig.protectedFiles"
            :key="idx"
            class="inline-flex items-center gap-1 px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded text-sm"
          >
            <code class="font-mono">{{ file }}</code>
            <button
              @click="removeProtectedFile(idx)"
              class="ml-1 text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </span>
        </div>
        <div v-else class="text-sm text-gray-500 dark:text-gray-400 italic">
          No protected files configured
        </div>
      </div>
    </template>
  </div>
</template>
