<template>
  <div
    class="group relative bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-lg p-4 cursor-pointer transition-all duration-200 hover:border-[var(--theme-primary)] hover:shadow-lg"
    @click="handleClick"
  >
    <!-- Status indicator -->
    <div
      class="absolute top-3 right-3 w-2 h-2 rounded-full"
      :class="statusColor"
    ></div>

    <!-- Project color bar -->
    <div
      class="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
      :style="{ backgroundColor: projectColor }"
    ></div>

    <!-- Content -->
    <div class="pl-3">
      <!-- Title - Inline Editable -->
      <div v-if="isEditing" class="pr-4" @click.stop>
        <input
          ref="editInput"
          v-model="editedName"
          type="text"
          class="w-full bg-[var(--theme-bg-tertiary)] border border-[var(--theme-primary)] rounded px-2 py-0.5 text-sm font-semibold text-[var(--theme-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--theme-primary)]"
          @keyup.enter="saveEdit"
          @keyup.escape="cancelEdit"
          @blur="saveEdit"
        />
      </div>
      <h3
        v-else
        class="text-[var(--theme-text-primary)] font-semibold text-sm truncate pr-4"
        @dblclick.stop="startEdit"
        :title="'Double-click to rename'"
      >
        {{ project.displayName || project.id }}
      </h3>

      <!-- Project ID (if different from displayName) -->
      <p
        v-if="project.displayName && project.displayName !== project.id"
        class="text-[var(--theme-text-tertiary)] text-xs mt-0.5 truncate font-mono"
      >
        {{ project.id }}
      </p>

      <!-- Description -->
      <p
        v-if="project.description"
        class="text-[var(--theme-text-secondary)] text-xs mt-2 line-clamp-2"
      >
        {{ project.description }}
      </p>

      <!-- Stats -->
      <div class="flex items-center gap-4 mt-3 text-xs text-[var(--theme-text-tertiary)]">
        <!-- Last activity -->
        <div class="flex items-center gap-1" :title="lastActivityFull">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ lastActivityRelative }}</span>
        </div>

        <!-- Session indicator -->
        <div
          v-if="project.lastSessionId"
          class="flex items-center gap-1"
          :title="'Last session: ' + project.lastSessionId.slice(0, 8)"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span class="font-mono">{{ project.lastSessionId.slice(0, 8) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import type { Project } from '../types'
import { useEventColors } from '../composables/useEventColors'

const props = defineProps<{
  project: Project
}>()

const emit = defineEmits<{
  rename: [projectId: string, newName: string]
}>()

const router = useRouter()
const { getHexColorForApp } = useEventColors()

// Inline editing state
const isEditing = ref(false)
const editedName = ref('')
const editInput = ref<HTMLInputElement | null>(null)

// Handle card click - navigate to project detail
function handleClick() {
  if (!isEditing.value) {
    router.push(`/projects/${props.project.id}`)
  }
}

// Start inline edit mode
async function startEdit() {
  editedName.value = props.project.displayName || props.project.id
  isEditing.value = true
  await nextTick()
  editInput.value?.focus()
  editInput.value?.select()
}

// Save the edit
function saveEdit() {
  if (!isEditing.value) return

  const trimmedName = editedName.value.trim()
  if (trimmedName && trimmedName !== (props.project.displayName || props.project.id)) {
    emit('rename', props.project.id, trimmedName)
  }
  isEditing.value = false
}

// Cancel the edit
function cancelEdit() {
  isEditing.value = false
  editedName.value = ''
}

const projectColor = computed(() => getHexColorForApp(props.project.id))

const statusColor = computed(() => {
  switch (props.project.status) {
    case 'active': return 'bg-green-500'
    case 'paused': return 'bg-yellow-500'
    case 'archived': return 'bg-gray-500'
    default: return 'bg-gray-500'
  }
})

const lastActivityRelative = computed(() => {
  if (!props.project.lastActivityAt) return 'No activity'

  const diff = Date.now() - props.project.lastActivityAt
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
})

const lastActivityFull = computed(() => {
  if (!props.project.lastActivityAt) return 'No activity recorded'
  return new Date(props.project.lastActivityAt).toLocaleString()
})
</script>
