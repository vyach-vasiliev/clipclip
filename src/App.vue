<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useBufferStore } from './store/buffer'
const buffer = useBufferStore()
onMounted(() => { void buffer.connect() })
onBeforeUnmount(buffer.disconnect)
</script>

<template>
  <div class="h-dvh min-h-0 bg-canvas text-ink"><router-view /></div>
</template>
