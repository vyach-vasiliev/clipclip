<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { mdiClose, mdiContentCopy, mdiFolderOpenOutline } from '@mdi/js'
import type { ClipboardHistoryItem } from '../../shared/clipboard'
import { filePathLabel } from '../../shared/files'
import { useBufferStore } from '../store/buffer'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ item: ClipboardHistoryItem; index: number }>()
const emit = defineEmits<{ close: []; copied: [item: ClipboardHistoryItem] }>()
const buffer = useBufferStore()
const dialog = ref<HTMLDialogElement>()
const path = computed(() => filePathLabel(props.item.fileUris![props.index]))
const label = computed(() => props.item.fileKinds?.[props.index] === 'folder' ? 'Папка' : 'Файл')
async function copyPath() {
  const item = await buffer.copyFilePath(props.item.id, props.index)
  if (item) emit('copied', item)
}
async function reveal() {
  if (await buffer.revealFile(props.item.id, props.index)) emit('close')
}
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="file-actions m-auto w-[calc(100%_-_24px)] max-w-sm max-h-[calc(100dvh_-_24px)] overflow-y-auto rounded-xl border border-line bg-surface p-3 text-ink shadow-xl"
    aria-labelledby="file-actions-title" aria-describedby="file-actions-path" @cancel.prevent="emit('close')" @keydown.stop @paste.stop>
    <header class="mb-2 flex items-center justify-between gap-2">
      <h2 id="file-actions-title" class="text-base font-semibold">{{ label }}</h2>
      <button type="button" class="close-file-actions icon-button" aria-label="Закрыть действия с файлом или папкой" title="Закрыть (Esc)" @click="emit('close')"><AppIcon :path="mdiClose" /></button>
    </header>
    <p id="file-actions-path" class="mb-3 select-text text-xs leading-relaxed text-muted wrap-anywhere">{{ path }}</p>
    <div class="flex flex-col gap-1">
      <button type="button" autofocus class="copy-file-path flex min-h-11 items-center gap-2 rounded-lg px-3 text-left hover:bg-accent/8" :disabled="buffer.busy" @click="copyPath">
        <AppIcon :path="mdiContentCopy" class="size-5 text-accent" />Скопировать путь
      </button>
      <button type="button" class="reveal-file flex min-h-11 items-center gap-2 rounded-lg px-3 text-left hover:bg-accent/8" :disabled="buffer.busy" @click="reveal">
        <AppIcon :path="mdiFolderOpenOutline" class="size-5 text-accent" />Открыть в Проводнике
      </button>
    </div>
    <p v-if="buffer.error" class="mt-3 text-xs text-danger" role="alert">{{ buffer.error }}</p>
  </dialog>
</template>
