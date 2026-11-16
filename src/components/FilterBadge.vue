<script setup lang="ts">
import { mdiClose } from '@mdi/js'
import AppIcon from './AppIcon.vue'
defineProps<{ icon: string; label: string; removable?: boolean }>()
</script>

<template>
  <span class="inline-flex h-7 max-w-56 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium ring-1 ring-inset"
    :class="removable ? 'ring-current/30 group-hover:ring-current/50' : 'ring-current/10 group-hover:ring-current/25'">
    <AppIcon :path="icon" class="size-3.5" /><span class="truncate">{{ label }}</span>
    <AppIcon v-if="removable" :path="mdiClose" class="size-3.5" />
  </span>
</template>
