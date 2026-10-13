<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiMagnify, mdiClose, mdiApplicationOutline, mdiFormatText, mdiRuler, mdiImageOutline, mdiCounter } from '@mdi/js'
import { tagKey, TAG_LABELS, type ClipboardTag } from '../../shared/clipboard'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ allTags: ClipboardTag[]; modelValue: string; selectedTags: ClipboardTag[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedTags': [value: ClipboardTag[]]
}>()
const searchField = ref<HTMLInputElement>()
const query = computed({ get: () => props.modelValue, set: (value: string) => emit('update:modelValue', value ?? '') })
const suggestions = computed(() => {
  const text = props.modelValue.trim().toLocaleLowerCase().replace(/^#/, '')
  if (!props.modelValue.trim()) return []
  return props.allTags.filter(tag => !props.selectedTags.some(selected => tagKey(selected) === tagKey(tag))
    && (tag.value.toLocaleLowerCase().includes(text) || tag.code.includes(text) || TAG_LABELS[tag.code].toLocaleLowerCase().includes(text))).slice(0, 8)
})
const labels = TAG_LABELS
const badgeColors = {
  source: 'bg-sky-500/10 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
  text: 'bg-violet-500/10 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200',
  image: 'bg-emerald-500/10 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  length: 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  size: 'bg-rose-500/10 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200',
  other: 'bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200',
}
const badgeIcons = { source: mdiApplicationOutline, text: mdiFormatText, image: mdiImageOutline,
  length: mdiCounter, size: mdiRuler, other: mdiFormatText }
function badgeCategory(tag: ClipboardTag): keyof typeof badgeColors {
  if (tag.code === 'source') return 'source'
  const value = tag.value.toLocaleLowerCase()
  if (tag.code === 'size') return value.includes('симв') ? 'length' : 'size'
  if (value === 'изображение' || value === 'image') return 'image'
  if (value === 'текст' || value === 'text') return 'text'
  return 'other'
}
function addSelectedTag(tag: ClipboardTag) {
  if (!props.selectedTags.some(selected => tagKey(selected) === tagKey(tag))) emit('update:selectedTags', [...props.selectedTags, tag])
  emit('update:modelValue', '')
  focus()
}
function removeTag(tag: ClipboardTag) {
  emit('update:selectedTags', props.selectedTags.filter(selected => tagKey(selected) !== tagKey(tag)))
  focus()
}
function clearSearch() { query.value = ''; focus() }
function focus() { searchField.value?.focus() }
defineExpose({ focus, addSelectedTag })
</script>

<template>
  <section class="search-panel shrink-0" aria-label="Поиск и фильтры">
    <label for="history-search" class="sr-only">Поиск в истории</label>
    <div class="flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
      <AppIcon :path="mdiMagnify" class="text-muted" />
      <input id="history-search" ref="searchField" v-model="query" type="text" role="searchbox" autocomplete="off" spellcheck="false"
        placeholder="Текст, приложение или #метка" class="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/70" />
      <button v-if="query" type="button" class="icon-button -mr-1" aria-label="Очистить поиск" title="Очистить поиск" @click="clearSearch"><AppIcon :path="mdiClose" /></button>
    </div>
    <div v-if="selectedTags.length" class="filter-row mt-1 flex min-h-10 items-center gap-1 overflow-x-auto" aria-label="Выбранные фильтры">
      <button v-for="tag in selectedTags" :key="tagKey(tag)" type="button" class="tag-badge group inline-flex min-h-10 shrink-0 items-center rounded-lg"
        :aria-label="'Убрать фильтр. ' + labels[tag.code] + ': ' + tag.value" :title="labels[tag.code] + ': ' + tag.value" @click="removeTag(tag)">
        <span class="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs font-medium ring-1 ring-inset ring-current/30 group-hover:ring-current/50" :class="badgeColors[badgeCategory(tag)]">
          <AppIcon :path="badgeIcons[badgeCategory(tag)]" class="size-3.5" /><span class="truncate">{{ tag.value }}</span><AppIcon :path="mdiClose" class="size-3.5" />
        </span>
      </button>
      <button type="button" class="text-button shrink-0 text-xs" @click="emit('update:selectedTags', []); focus()">Сбросить</button>
    </div>
    <div v-if="suggestions.length" class="filter-row suggestions mt-1 flex min-h-10 items-center gap-1 overflow-x-auto" aria-label="Предлагаемые фильтры">
      <button v-for="tag in suggestions" :key="tagKey(tag)" type="button" class="tag-badge group inline-flex min-h-10 shrink-0 items-center rounded-lg"
        :aria-label="'Добавить фильтр. ' + labels[tag.code] + ': ' + tag.value" :title="labels[tag.code] + ': ' + tag.value" @click="addSelectedTag(tag)">
        <span class="inline-flex h-7 max-w-56 items-center gap-1.5 rounded-md px-2 text-xs font-medium ring-1 ring-inset ring-current/10 group-hover:ring-current/25" :class="badgeColors[badgeCategory(tag)]">
          <AppIcon :path="badgeIcons[badgeCategory(tag)]" class="size-3.5" /><span class="truncate">{{ tag.value }}</span>
        </span>
      </button>
    </div>
  </section>
</template>
