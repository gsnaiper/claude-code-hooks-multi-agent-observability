<template>
  <button
    @click.stop="handleClick"
    class="inline-flex items-center transition-all duration-200 hover:ring-2 hover:ring-[var(--theme-primary)] hover:scale-105 cursor-pointer rounded-full"
    :class="customClass"
    :style="customStyle"
    :title="`Click to filter by ${field}: ${displayValue}`"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  field: string
  value: string
  customClass?: string
  customStyle?: Record<string, string>
}>()

const emit = defineEmits<{
  filter: [payload: { field: string; value: string }]
}>()

// Truncate long values for tooltip
const displayValue = computed(() => {
  if (props.value.length > 30) {
    return props.value.slice(0, 27) + '...'
  }
  return props.value
})

const handleClick = () => {
  emit('filter', { field: props.field, value: props.value })
}
</script>
