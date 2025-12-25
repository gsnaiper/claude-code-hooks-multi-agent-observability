<template>
  <div class="flex flex-col flex-1 overflow-hidden">
    <!-- Filters -->
    <FilterPanel
      v-if="showFilters"
      class="short:hidden"
      :filters="filters"
      @update:filters="$emit('update:filters', $event)"
    />

    <!-- Agent Swim Lane Container (below pulse chart, full width, hidden when empty) -->
    <div v-if="selectedAgentLanes.length > 0" class="w-full bg-[var(--theme-bg-secondary)] px-3 py-4 mobile:px-2 mobile:py-2 overflow-hidden">
      <AgentSwimLaneContainer
        :selected-agents="selectedAgentLanes"
        :events="events"
        :time-range="currentTimeRange"
        @update:selected-agents="$emit('update:selectedAgentLanes', $event)"
      />
    </div>

    <!-- Timeline -->
    <div class="flex flex-col flex-1 overflow-hidden">
      <EventTimeline
        :events="events"
        :filters="filters"
        :unique-app-names="uniqueAppNames"
        :all-app-names="allAppNames"
        v-model:stick-to-bottom="localStickToBottom"
        @select-agent="$emit('selectAgent', $event)"
      />
    </div>

    <!-- Stick to bottom button -->
    <StickScrollButton
      class="short:hidden"
      :stick-to-bottom="localStickToBottom"
      @toggle="localStickToBottom = !localStickToBottom"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, type Ref } from 'vue'
import type { EventSummary, EventTimeRange, TimeRange } from '../types'
import FilterPanel from '../components/FilterPanel.vue'
import EventTimeline from '../components/EventTimeline.vue'
import AgentSwimLaneContainer from '../components/AgentSwimLaneContainer.vue'
import StickScrollButton from '../components/StickScrollButton.vue'

// Inject shared state from App.vue
const events = inject<Ref<EventSummary[]>>('events')!
const filters = inject<Ref<{
  sourceApp: string
  sessionId: string
  eventType: string
  timeRange: EventTimeRange
}>>('filters')!
const showFilters = inject<Ref<boolean>>('showFilters')!
const uniqueAppNames = inject<Ref<string[]>>('uniqueAppNames')!
const allAppNames = inject<Ref<string[]>>('allAppNames')!
const selectedAgentLanes = inject<Ref<string[]>>('selectedAgentLanes')!
const currentTimeRange = inject<Ref<TimeRange>>('currentTimeRange')!
const stickToBottom = inject<Ref<boolean>>('stickToBottom')!

// Local copy of stickToBottom for v-model
const localStickToBottom = ref(stickToBottom.value)

// Sync with parent
watch(localStickToBottom, (val) => {
  stickToBottom.value = val
})
watch(stickToBottom, (val) => {
  localStickToBottom.value = val
})

defineEmits<{
  'update:filters': [filters: typeof filters.value]
  'update:selectedAgentLanes': [lanes: string[]]
  selectAgent: [agent: string]
}>()
</script>
