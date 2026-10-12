<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useBufferStore } from './store/buffer'
const buffer = useBufferStore()
onMounted(() => { void buffer.connect() })
onBeforeUnmount(buffer.disconnect)
</script>

<template>
  <v-app><router-view /></v-app>
</template>
