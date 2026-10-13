<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiMagnify, mdiClose } from '@mdi/js'
import { tagKey, TAG_LABELS, type ClipboardTag } from '../../shared/clipboard'
import AppIcon from './AppIcon.vue'
import { matchesTag } from '../../shared/content'
import TagBadge from './TagBadge.vue'

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
    && matchesTag(tag, text)).slice(0, 8)
})
const labels = TAG_LABELS
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
function insertText(text: string) {
  const field = searchField.value
  if (!field) return
  focus()
  field.setRangeText(text, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, 'end')
  query.value = field.value
}
defineExpose({ focus, insertText, addSelectedTag })
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
        <TagBadge :tag="tag" removable />
      </button>
      <button type="button" class="text-button shrink-0 text-xs" @click="emit('update:selectedTags', []); focus()">Сбросить</button>
    </div>
    <div v-if="suggestions.length" class="filter-row suggestions mt-1 flex min-h-10 items-center gap-1 overflow-x-auto" aria-label="Предлагаемые фильтры">
      <button v-for="tag in suggestions" :key="tagKey(tag)" type="button" class="tag-badge group inline-flex min-h-10 shrink-0 items-center rounded-lg"
        :aria-label="'Добавить фильтр. ' + labels[tag.code] + ': ' + tag.value" :title="labels[tag.code] + ': ' + tag.value" @click="addSelectedTag(tag)">
        <TagBadge :tag="tag" />
      </button>
    </div>
  </section>
</template>
