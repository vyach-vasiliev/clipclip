<script setup lang="ts">
import { mdiFileOutline, mdiFolderOutline, mdiFileQuestionOutline } from '@mdi/js'
import type { ClipboardHistoryItem } from '../../shared/clipboard'
import { filePathLabel } from '../../shared/files'
import { useBufferStore } from '../store/buffer'
import AppIcon from './AppIcon.vue'

defineProps<{ item: ClipboardHistoryItem }>()
const emit = defineEmits<{ open: [index: number] }>()
const buffer = useBufferStore()
</script>

<template>
  <div class="file-locations ml-1 flex max-h-36 w-10 shrink-0 flex-col overflow-y-auto" aria-label="Файлы и папки записи">
    <button v-for="(uri, index) in item.fileUris" :key="uri + index" type="button" class="file-location icon-button"
      :disabled="buffer.busy" :title="'Скопировать путь или открыть в Проводнике: ' + filePathLabel(uri)"
      :aria-label="(item.fileKinds?.[index] === 'folder' ? 'Папка. ' : item.fileKinds?.[index] === 'file' ? 'Файл. ' : '') + 'Действия: ' + filePathLabel(uri)"
      aria-haspopup="dialog" @click="emit('open', index)">
      <AppIcon :path="item.fileKinds?.[index] === 'folder' ? mdiFolderOutline : item.fileKinds?.[index] === 'file' ? mdiFileOutline : mdiFileQuestionOutline" class="size-5" />
    </button>
  </div>
</template>
