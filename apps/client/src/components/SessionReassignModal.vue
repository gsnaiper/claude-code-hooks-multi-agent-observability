<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Project, ProjectSession } from '../types'

const props = defineProps<{
  session: ProjectSession | null
  currentProject: Project
  projects: Project[]
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'reassign', sessionId: string, newProjectId: string): void
}>()

const selectedProjectId = ref<string>('')
const isReassigning = ref(false)

// Filter out current project from available targets
const availableProjects = computed(() => {
  return props.projects.filter(p => p.id !== props.currentProject.id && p.status === 'active')
})

// Reset selection when modal opens
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedProjectId.value = ''
      isReassigning.value = false
    }
  }
)

async function handleReassign() {
  if (!props.session || !selectedProjectId.value) return

  isReassigning.value = true
  try {
    emit('reassign', props.session.id, selectedProjectId.value)
  } finally {
    isReassigning.value = false
  }
}

function close() {
  emit('close')
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && session"
      class="fixed inset-0 z-50 overflow-y-auto"
      @click.self="close"
    >
      <!-- Backdrop -->
      <div class="fixed inset-0 bg-black/50 transition-opacity" @click="close" />

      <!-- Modal -->
      <div class="relative min-h-screen flex items-center justify-center p-4">
        <div
          class="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md"
          @click.stop
        >
          <!-- Header -->
          <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
              Reassign Session
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Move this session and all its events to another project
            </p>
          </div>

          <!-- Content -->
          <div class="p-6 space-y-4">
            <!-- Session info -->
            <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div class="text-sm font-medium text-gray-900 dark:text-white">
                Session: {{ session.id.substring(0, 8) }}...
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Started: {{ formatDate(session.startedAt) }}
              </div>
              <div class="flex gap-4 mt-2 text-xs text-gray-600 dark:text-gray-400">
                <span>{{ session.eventCount }} events</span>
                <span>{{ session.toolCallCount }} tool calls</span>
              </div>
            </div>

            <!-- Current project -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Current Project
              </label>
              <div class="p-2 bg-gray-100 dark:bg-gray-800 rounded text-sm text-gray-600 dark:text-gray-400">
                {{ currentProject.displayName || currentProject.id }}
              </div>
            </div>

            <!-- Target project selector -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Move to Project
              </label>
              <select
                v-model="selectedProjectId"
                class="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select a project...</option>
                <option
                  v-for="project in availableProjects"
                  :key="project.id"
                  :value="project.id"
                >
                  {{ project.displayName || project.id }}
                </option>
              </select>
            </div>

            <!-- Warning -->
            <div class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div class="flex items-start gap-2">
                <span class="text-yellow-600">⚠️</span>
                <div class="text-sm text-yellow-700 dark:text-yellow-400">
                  <strong>Note:</strong> All events associated with this session will be moved to the new project.
                  This action cannot be easily undone.
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
            <button
              @click="close"
              class="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              @click="handleReassign"
              :disabled="!selectedProjectId || isReassigning"
              :class="[
                'px-4 py-2 text-sm rounded-lg transition-colors',
                selectedProjectId && !isReassigning
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
              ]"
            >
              <span v-if="isReassigning">Moving...</span>
              <span v-else>Move Session</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
