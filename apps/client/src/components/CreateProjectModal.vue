<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Project, RepositoryInput } from '../types'
import { useProjects } from '../composables/useProjects'
import { useRepositories } from '../composables/useRepositories'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', project: Project): void
}>()

const { createProject, isLoading, error } = useProjects()
const { addRepository: saveRepository } = useRepositories()

// Form state
const projectId = ref('')
const displayName = ref('')
const description = ref('')
const repositories = ref<RepositoryInput[]>([])

// New repo form
const newRepoName = ref('')
const newRepoUrl = ref('')
const newRepoPath = ref('')
const newRepoBranch = ref('')
const showAddRepo = ref(false)

// Validation
const validationError = ref<string | null>(null)

// Reset form when modal opens
watch(() => props.visible, (visible) => {
  if (visible) {
    projectId.value = ''
    displayName.value = ''
    description.value = ''
    repositories.value = []
    validationError.value = null
    showAddRepo.value = false
  }
})

function generateProjectId(): void {
  // Generate a simple project ID from display name
  if (displayName.value && !projectId.value) {
    projectId.value = displayName.value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }
}

function addRepository(): void {
  if (!newRepoName.value.trim()) {
    validationError.value = 'Repository name is required'
    return
  }

  repositories.value.push({
    name: newRepoName.value.trim(),
    gitRemoteUrl: newRepoUrl.value.trim() || undefined,
    localPath: newRepoPath.value.trim() || undefined,
    gitBranch: newRepoBranch.value.trim() || undefined,
    isPrimary: repositories.value.length === 0 // First repo is primary
  })

  // Reset new repo form
  newRepoName.value = ''
  newRepoUrl.value = ''
  newRepoPath.value = ''
  newRepoBranch.value = ''
  showAddRepo.value = false
  validationError.value = null
}

function removeRepository(index: number): void {
  const wasPrimary = repositories.value[index]?.isPrimary
  repositories.value.splice(index, 1)

  // If we removed the primary, make the first remaining one primary
  if (wasPrimary && repositories.value.length > 0) {
    repositories.value[0].isPrimary = true
  }
}

function setPrimary(index: number): void {
  repositories.value.forEach((r, i) => {
    r.isPrimary = i === index
  })
}

async function handleSubmit(): Promise<void> {
  validationError.value = null

  if (!projectId.value.trim()) {
    validationError.value = 'Project ID is required'
    return
  }

  const project = await createProject({
    id: projectId.value.trim(),
    displayName: displayName.value.trim() || undefined,
    description: description.value.trim() || undefined,
    status: 'active',
    isManual: true
  })

  if (project) {
    // Save repositories after project is created
    if (repositories.value.length > 0) {
      for (const repo of repositories.value) {
        try {
          await saveRepository(project.id, repo)
        } catch (e) {
          console.error('Failed to add repository:', e)
        }
      }
    }

    emit('created', project)
    close()
  }
}

function close(): void {
  emit('close')
}

function handleBackdropClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) {
    close()
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click="handleBackdropClick"
    >
      <div class="w-full max-w-2xl max-h-[85vh] bg-[var(--theme-bg-primary)] rounded-xl shadow-2xl border border-[var(--theme-border-primary)] flex flex-col overflow-hidden">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-[var(--theme-border-primary)]">
          <h2 class="text-xl font-semibold text-[var(--theme-text-primary)]">Create New Project</h2>
          <button
            @click="close"
            class="p-2 rounded-lg hover:bg-[var(--theme-hover-bg)] text-[var(--theme-text-secondary)] transition-colors"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Form -->
        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Project ID -->
          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-1">
              Project ID <span class="text-red-400">*</span>
            </label>
            <input
              v-model="projectId"
              type="text"
              placeholder="my-project"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
            <p class="mt-1 text-xs text-[var(--theme-text-tertiary)]">Unique identifier for this project (e.g., company:project-name)</p>
          </div>

          <!-- Display Name -->
          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-1">Display Name</label>
            <input
              v-model="displayName"
              type="text"
              placeholder="My Project"
              @blur="generateProjectId"
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            />
          </div>

          <!-- Description -->
          <div>
            <label class="block text-sm font-medium text-[var(--theme-text-secondary)] mb-1">Description</label>
            <textarea
              v-model="description"
              rows="2"
              placeholder="Brief description of the project..."
              class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)] resize-none"
            />
          </div>

          <!-- Repositories Section -->
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="block text-sm font-medium text-[var(--theme-text-secondary)]">Repositories</label>
              <button
                @click="showAddRepo = true"
                class="text-sm text-[var(--theme-primary)] hover:text-[var(--primary-hover)] transition-colors"
              >
                + Add Repository
              </button>
            </div>

            <!-- Repository List -->
            <div v-if="repositories.length > 0" class="space-y-2 mb-3">
              <div
                v-for="(repo, index) in repositories"
                :key="index"
                class="flex items-center gap-2 p-2 bg-[var(--theme-bg-secondary)] rounded-lg border border-[var(--theme-border-secondary)]"
              >
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-[var(--theme-text-primary)] truncate">{{ repo.name }}</span>
                    <span
                      v-if="repo.isPrimary"
                      class="px-1.5 py-0.5 text-xs bg-[var(--theme-primary)] text-white rounded"
                    >
                      Primary
                    </span>
                  </div>
                  <div v-if="repo.gitRemoteUrl" class="text-xs text-[var(--theme-text-tertiary)] truncate">
                    {{ repo.gitRemoteUrl }}
                  </div>
                </div>
                <button
                  v-if="!repo.isPrimary"
                  @click="setPrimary(index)"
                  class="p-1 text-[var(--theme-text-tertiary)] hover:text-[var(--theme-primary)] transition-colors"
                  title="Set as primary"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                  </svg>
                </button>
                <button
                  @click="removeRepository(index)"
                  class="p-1 text-[var(--theme-text-tertiary)] hover:text-red-400 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Add Repository Form -->
            <div v-if="showAddRepo" class="p-3 bg-[var(--theme-bg-tertiary)] rounded-lg border border-[var(--theme-border-secondary)] space-y-3">
              <input
                v-model="newRepoName"
                type="text"
                placeholder="Repository name *"
                class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <input
                v-model="newRepoUrl"
                type="text"
                placeholder="Git remote URL (optional)"
                class="w-full px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
              />
              <div class="flex gap-2">
                <input
                  v-model="newRepoPath"
                  type="text"
                  placeholder="Local path (optional)"
                  class="flex-1 px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
                />
                <input
                  v-model="newRepoBranch"
                  type="text"
                  placeholder="Branch"
                  class="w-24 px-3 py-2 bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-secondary)] rounded text-sm text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
                />
              </div>
              <div class="flex justify-end gap-2">
                <button
                  @click="showAddRepo = false"
                  class="px-3 py-1.5 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  @click="addRepository"
                  class="px-3 py-1.5 text-sm bg-[var(--theme-primary)] text-white rounded hover:bg-[var(--primary-hover)] transition-colors"
                >
                  Add
                </button>
              </div>
            </div>

            <p v-if="repositories.length === 0 && !showAddRepo" class="text-sm text-[var(--theme-text-tertiary)]">
              No repositories added yet. You can add them now or later.
            </p>
          </div>

          <!-- Error Messages -->
          <div v-if="validationError || error" class="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p class="text-sm text-red-400">{{ validationError || error }}</p>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-end gap-3 p-4 border-t border-[var(--theme-border-primary)]">
          <button
            @click="close"
            class="px-4 py-2 text-sm text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            @click="handleSubmit"
            :disabled="isLoading"
            class="px-4 py-2 text-sm bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ isLoading ? 'Creating...' : 'Create Project' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
