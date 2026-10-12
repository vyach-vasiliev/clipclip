<script setup lang="ts">
defineProps<{ path: string; size?: number }>()
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size ?? 20" :height="size ?? 20" class="shrink-0 fill-current" aria-hidden="true" focusable="false"><path :d="path" /></svg>
</template>
