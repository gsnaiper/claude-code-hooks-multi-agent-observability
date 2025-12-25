<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="flex-shrink-0 p-4 border-b border-[var(--theme-border-primary)]">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-[var(--theme-text-primary)] text-lg font-semibold">Projects</h2>
        <div class="flex items-center gap-2">
          <button
            @click="showCreateModal = true"
            class="px-3 py-1.5 text-sm bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--theme-primary-hover)] transition-colors flex items-center gap-1"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            New Project
          </button>
          <button
            @click="refresh"
            class="p-2 rounded-lg bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] transition-colors"
            :class="{ 'animate-spin': isLoading }"
            title="Refresh projects"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Search & Filter -->
      <div class="flex gap-2">
        <div class="relative flex-1">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search projects..."
            class="w-full px-3 py-2 pl-9 text-sm bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] placeholder-[var(--theme-text-tertiary)] focus:outline-none focus:border-[var(--theme-primary)]"
          />
          <svg class="absolute left-3 top-2.5 w-4 h-4 text-[var(--theme-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <!-- Status filter -->
        <select
          v-model="statusFilter"
          class="px-3 py-2 text-sm bg-[var(--theme-bg-tertiary)] border border-[var(--theme-border-secondary)] rounded-lg text-[var(--theme-text-primary)] focus:outline-none focus:border-[var(--theme-primary)]"
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="archived">Archived</option>
        </select>
      </div>
    </div>

    <!-- Project Grid -->
    <div class="flex-1 overflow-y-auto p-4">
      <!-- Loading state -->
      <div v-if="isLoading && projects.length === 0" class="flex items-center justify-center h-32">
        <div class="text-[var(--theme-text-tertiary)]">Loading projects...</div>
      </div>

      <!-- Empty state -->
      <div v-else-if="filteredProjects.length === 0" class="flex flex-col items-center justify-center h-32 text-center">
        <svg class="w-12 h-12 text-[var(--theme-text-tertiary)] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <p class="text-[var(--theme-text-tertiary)] text-sm">
          {{ searchQuery || statusFilter ? 'No projects match your filters' : 'No projects yet' }}
        </p>
        <p class="text-[var(--theme-text-quaternary)] text-xs mt-1">
          Projects are auto-registered when Claude Code sends events
        </p>
      </div>

      <!-- Project grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <ProjectCard
          v-for="project in filteredProjects"
          :key="project.id"
          :project="project"
        />
      </div>

      <!-- Orphaned Sessions Panel -->
      <OrphanedSessionsPanel
        class="mt-4"
        @assign="handleSessionAssigned"
      />
    </div>

    <!-- Footer stats -->
    <div class="flex-shrink-0 px-4 py-2 border-t border-[var(--theme-border-primary)] text-xs text-[var(--theme-text-tertiary)]">
      {{ filteredProjects.length }} of {{ projects.length }} projects
      <span v-if="activeCount > 0" class="ml-2">
        ({{ activeCount }} active)
      </span>
    </div>

    <!-- Create Project Modal -->
    <CreateProjectModal
      :visible="showCreateModal"
      @close="showCreateModal = false"
      @created="handleProjectCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Project, ProjectSession } from '../types'
import { useProjects } from '../composables/useProjects'
import ProjectCard from './ProjectCard.vue'
import CreateProjectModal from './CreateProjectModal.vue'
import OrphanedSessionsPanel from './OrphanedSessionsPanel.vue'

const { projects, isLoading, fetchProjects } = useProjects()

const searchQuery = ref('')
const statusFilter = ref<string>('')
const showCreateModal = ref(false)

const filteredProjects = computed(() => {
  let result = projects.value

  if (statusFilter.value) {
    result = result.filter(p => p.status === statusFilter.value)
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    result = result.filter(p =>
      p.id.toLowerCase().includes(query) ||
      p.displayName?.toLowerCase().includes(query) ||
      p.description?.toLowerCase().includes(query)
    )
  }

  return result
})

const activeCount = computed(() =>
  projects.value.filter(p => p.status === 'active').length
)

async function refresh() {
  await fetchProjects({
    sortBy: 'lastActivity',
    sortOrder: 'desc'
  })
}

function handleProjectCreated(project: Project) {
  // Project is already added to the list by the composable
  console.log('Project created:', project.id)
}

function handleSessionAssigned(session: ProjectSession, project: Project) {
  // Refresh to update counts
  refresh()
  console.log('Session assigned:', session.id, 'to', project.id)
}

onMounted(() => {
  refresh()
})
</script>
