<template>
  <div class="flex-1 overflow-hidden bg-[var(--theme-bg-primary)]">
    <!-- Loading state -->
    <div v-if="isLoading" class="flex items-center justify-center h-full">
      <div class="animate-spin rounded-full h-8 w-8 border-2 border-[var(--theme-primary)] border-t-transparent"></div>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="flex flex-col items-center justify-center h-full gap-4">
      <p class="text-red-400">{{ error }}</p>
      <button
        @click="router.push('/projects')"
        class="px-4 py-2 bg-[var(--theme-primary)] text-white rounded-lg hover:bg-[var(--theme-primary-hover)]"
      >
        Back to Projects
      </button>
    </div>

    <!-- Project detail -->
    <ProjectDetail
      v-else-if="project"
      :project="project"
      @back="router.push('/projects')"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Project } from '../types'
import { useProjects } from '../composables/useProjects'
import ProjectDetail from '../components/ProjectDetail.vue'

const route = useRoute()
const router = useRouter()
const { fetchProject } = useProjects()

const project = ref<Project | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)

async function loadProject(id: string) {
  isLoading.value = true
  error.value = null

  try {
    const result = await fetchProject(id)
    if (result) {
      project.value = result
    } else {
      error.value = `Project "${id}" not found`
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load project'
  } finally {
    isLoading.value = false
  }
}

// Load project on mount
onMounted(() => {
  const id = route.params.id as string
  if (id) {
    loadProject(id)
  }
})

// Watch for route changes
watch(() => route.params.id, (newId) => {
  if (newId && typeof newId === 'string') {
    loadProject(newId)
  }
})
</script>
