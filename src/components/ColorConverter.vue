<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { mdiClose, mdiContentCopy } from '@mdi/js'
import { COLOR_FORMATS, COLOR_LABELS, colorSwatch, convertColor, parseColor, type ColorFormat } from '../../shared/colors'
import { useBufferStore } from '../store/buffer'
import type { ClipboardHistoryItem } from '../../shared/clipboard'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ id: string; text: string }>()
const emit = defineEmits<{ close: []; copied: [item: ClipboardHistoryItem] }>()
const buffer = useBufferStore()
const dialog = ref<HTMLDialogElement>()
const copying = ref<ColorFormat | null>(null)
const swatch = computed(() => colorSwatch(props.text))
const outsideSrgb = computed(() => !parseColor(props.text)?.inGamut('srgb'))
const variants = computed(() => COLOR_FORMATS.map(format => ({ format, label: COLOR_LABELS[format], value: convertColor(props.text, format) })))

async function copy(format: ColorFormat) {
  if (buffer.busy) return
  copying.value = format
  const copied = await buffer.copyColor(props.id, format)
  copying.value = null
  if (copied) emit('copied', copied)
}
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="color-dialog m-auto max-h-[calc(100dvh_-_24px)] w-[calc(100%_-_24px)] max-w-md overflow-hidden rounded-xl border border-line bg-surface p-3 text-ink shadow-xl open:flex open:flex-col open:gap-3"
    aria-labelledby="color-title" aria-describedby="color-help" @cancel.prevent="emit('close')" @keydown.stop @paste.stop
    @click="($event.target === $event.currentTarget) && emit('close')">
    <header class="flex shrink-0 items-center gap-2">
      <h2 id="color-title" class="mr-auto text-base font-semibold">Конвертация цвета</h2>
      <button type="button" class="close-color icon-button" aria-label="Закрыть конвертацию цвета" title="Закрыть (Esc)" @click="emit('close')"><AppIcon :path="mdiClose" /></button>
    </header>
    <div class="flex shrink-0 items-center gap-3">
      <span class="color-checker block size-10 shrink-0 overflow-hidden rounded-lg" aria-hidden="true"><span class="block size-full" :style="{ backgroundColor: swatch ?? undefined }" /></span>
      <code class="min-w-0 text-xs wrap-anywhere">{{ text.trim() }}</code>
    </div>
    <p id="color-help" class="shrink-0 text-xs text-muted">Нажмите на формат, чтобы скопировать значение.</p>
    <p v-if="outsideSrgb" class="shrink-0 text-xs leading-relaxed text-muted">Цвет вне sRGB. HEX, RGB, HSL, HWB и sRGB используют ближайший цвет в этом диапазоне.</p>
    <div class="color-variants min-h-0 overflow-y-auto rounded-lg border border-line">
      <button v-for="variant in variants" :key="variant.format" type="button" :data-color-format="variant.format"
        class="color-variant flex min-h-12 w-full items-center gap-2 border-b border-line px-2.5 py-2 text-left last:border-b-0 hover:bg-accent/8 disabled:cursor-wait"
        :disabled="buffer.busy" :aria-busy="copying === variant.format" :aria-label="'Скопировать ' + variant.label + ': ' + variant.value" @click="copy(variant.format)">
        <span class="w-[66px] shrink-0 text-[11px] font-semibold text-muted">{{ variant.label }}</span>
        <code class="min-w-0 flex-1 text-xs leading-relaxed wrap-anywhere tabular-nums">{{ variant.value }}</code>
        <AppIcon :path="mdiContentCopy" class="size-4 shrink-0 text-accent" />
      </button>
    </div>
    <p v-if="buffer.error" class="shrink-0 text-xs text-danger" role="alert">{{ buffer.error }}</p>
    <p class="shrink-0 text-xs text-muted" role="status" aria-live="polite">{{ copying ? 'Копируется…' : 'Копирование добавит цвет в историю и закроет панель.' }}</p>
  </dialog>
</template>
