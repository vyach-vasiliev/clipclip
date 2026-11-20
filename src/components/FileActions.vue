<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { mdiClose, mdiContentCopy, mdiFileSearchOutline, mdiFolderOpenOutline } from '@mdi/js'
import type { ClipboardHistoryItem, FileCheckResult } from '../../shared/clipboard'
import { filePathLabel } from '../../shared/files'
import { useBufferStore } from '../store/buffer'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ item: ClipboardHistoryItem; index: number }>()
const emit = defineEmits<{ close: []; copied: [item: ClipboardHistoryItem]; checked: [id: string, result: FileCheckResult, index: number] }>()
const buffer = useBufferStore()
const dialog = ref<HTMLDialogElement>()
const path = computed(() => filePathLabel(props.item.fileUris![props.index]))
const label = computed(() => {
  const kind = props.item.fileKinds?.[props.index]
  return kind === 'folder' ? 'Папка' : kind === 'file' ? 'Файл' : 'Файл или папка'
})
const checking = ref(false)
const availability = ref<FileCheckResult>()
let pointerStartedOutside = false
function outside(event: MouseEvent) {
  if (!dialog.value || event.target !== dialog.value) return false
  const bounds = dialog.value.getBoundingClientRect()
  return event.clientX < bounds.left || event.clientX >= bounds.right || event.clientY < bounds.top || event.clientY >= bounds.bottom
}
function dismissOutside(event: MouseEvent) {
  if (pointerStartedOutside && outside(event)) emit('close')
  pointerStartedOutside = false
}
async function copyPath() {
  const item = await buffer.copyFilePath(props.item.id, props.index)
  if (item) emit('copied', item)
}
async function reveal() {
  if (await buffer.revealFile(props.item.id, props.index)) emit('close')
}
async function checkAvailability() {
  if (checking.value || buffer.busy) return
  const { id } = props.item
  const { index } = props
  checking.value = true
  availability.value = undefined
  try {
    availability.value = await window.electronAPI!.checkFile(id, index)
  } catch {
    availability.value = { status: 'unavailable', message: 'Не удалось проверить выбранный путь.' }
  } finally {
    checking.value = false
  }
  emit('checked', id, availability.value, index)
}
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="file-actions m-auto w-[calc(100%_-_24px)] max-w-sm max-h-[calc(100dvh_-_24px)] overflow-y-auto rounded-xl border border-line bg-surface p-3 text-ink shadow-xl"
    aria-labelledby="file-actions-title" aria-describedby="file-actions-path" @cancel.prevent="emit('close')" @keydown.stop @paste.stop
    @pointerdown="pointerStartedOutside = outside($event)" @pointercancel="pointerStartedOutside = false" @click="dismissOutside">
    <header class="mb-2 flex items-center justify-between gap-2">
      <h2 id="file-actions-title" class="text-base font-semibold">{{ label }}</h2>
      <button type="button" class="close-file-actions icon-button" aria-label="Закрыть действия с файлом или папкой" title="Закрыть (Esc)" @click="emit('close')"><AppIcon :path="mdiClose" /></button>
    </header>
    <p id="file-actions-path" class="mb-3 select-text text-xs leading-relaxed text-muted wrap-anywhere">{{ path }}</p>
    <div class="flex flex-col gap-1">
      <button type="button" autofocus class="copy-file-path flex min-h-11 items-center gap-2 rounded-lg px-3 text-left hover:bg-accent/8" :disabled="buffer.busy || checking" @click="copyPath">
        <AppIcon :path="mdiContentCopy" class="size-5 text-accent" />Скопировать путь
      </button>
      <button type="button" class="reveal-file flex min-h-11 items-center gap-2 rounded-lg px-3 text-left hover:bg-accent/8" :disabled="buffer.busy || checking" @click="reveal">
        <AppIcon :path="mdiFolderOpenOutline" class="size-5 text-accent" />Открыть в Проводнике
      </button>
      <button type="button" class="check-file-availability flex min-h-11 items-center gap-2 rounded-lg px-3 text-left hover:bg-accent/8"
        :disabled="buffer.busy || checking" @click="checkAvailability">
        <AppIcon :path="mdiFileSearchOutline" class="size-5 text-accent" />Проверить доступность
      </button>
    </div>
    <p v-if="checking || availability" class="mt-3 text-xs" :class="checking || availability?.status === 'available' ? 'text-muted' : 'text-danger'"
      role="status">{{ checking ? 'Проверка выбранного пути…' : availability?.message }}</p>
    <p v-if="buffer.error" class="mt-3 text-xs text-danger" role="alert">{{ buffer.error }}</p>
  </dialog>
</template>
