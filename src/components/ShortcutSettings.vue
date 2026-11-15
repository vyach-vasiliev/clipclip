<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, shortcutError, shortcutFromEvent, shortcutLabel, type ShortcutAction } from '../../shared/shortcuts'
import { useBufferStore } from '../store/buffer'

const buffer = useBufferStore()
const emit = defineEmits<{ applied: [] }>()
const recording = ref<ShortcutAction | null>(null)
const error = ref('')
let generation = 0
async function cancel() {
  generation++
  recording.value = null
  try { await window.electronAPI?.setShortcutCapture(false) }
  catch { error.value = 'Не удалось восстановить вызов окна. Откройте ClipClip через значок приложения.' }
}
async function begin(action: ShortcutAction) {
  if (buffer.busy || buffer.loading) return
  await cancel()
  const current = ++generation
  error.value = ''
  try {
    await window.electronAPI!.setShortcutCapture(true)
    if (current === generation) recording.value = action
    else await window.electronAPI!.setShortcutCapture(false)
  } catch { error.value = 'Не удалось начать настройку сочетания.' }
}
async function capture(event: KeyboardEvent, action: ShortcutAction) {
  if (recording.value !== action) return
  if (event.key === 'Tab') { await cancel(); return }
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') { await cancel(); return }
  if (event.repeat || event.isComposing || event.getModifierState('AltGraph')) return
  const shortcut = shortcutFromEvent(event)
  if (!shortcut) return
  const next = { ...buffer.shortcuts, [action]: shortcut }
  error.value = shortcutError(next) ?? ''
  if (error.value) return
  if (await buffer.setShortcuts(next)) { emit('applied'); await cancel() }
}
async function reset() {
  await cancel()
  error.value = ''
  if (await buffer.setShortcuts({ ...DEFAULT_SHORTCUTS })) emit('applied')
}
onBeforeUnmount(() => { void cancel() })
</script>

<template>
  <div class="flex flex-col gap-3">
    <p id="shortcut-help" class="text-xs leading-relaxed text-muted">Нажмите на сочетание и введите новое клавишами. Esc отменяет ввод. Вызов окна работает во всех приложениях, остальные действия — в списке ClipClip.</p>
    <div v-for="(label, action) in SHORTCUT_LABELS" :key="action" class="flex items-center justify-between gap-3 border-b border-line pb-2">
      <span class="text-xs leading-relaxed">{{ label }}</span>
      <button type="button" class="shortcut-binding min-h-10 min-w-28 shrink-0 rounded-lg border px-2 text-xs tabular-nums"
        :class="recording === action ? 'border-accent bg-accent/12 text-accent' : 'border-line bg-canvas text-ink hover:border-accent'"
        :data-shortcut-action="action" :aria-label="'Изменить сочетание: ' + label" :aria-pressed="recording === action" aria-describedby="shortcut-help"
        :disabled="buffer.busy || buffer.loading" @click="begin(action)" @keydown="capture($event, action)" @blur="cancel">
        {{ recording === action ? 'Нажмите клавиши…' : shortcutLabel(buffer.shortcuts[action]) }}
      </button>
    </div>
    <p v-if="error" class="text-xs text-danger" role="alert">{{ error }}</p>
    <button type="button" class="text-button self-start" :disabled="buffer.busy || buffer.loading" @click="reset">Вернуть стандартные сочетания</button>
    <p class="text-xs leading-relaxed text-muted">Стрелки и Esc сохраняют навигацию по списку. При редактировании текста действуют обычные команды редактора.</p>
  </div>
</template>
