<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiMagnify, mdiClose, mdiStar, mdiStarOutline, mdiCalendarClockOutline } from '@mdi/js'
import { tagKey, TAG_LABELS, type ClipboardTag } from '../../shared/clipboard'
import AppIcon from './AppIcon.vue'
import { matchesTag } from '../../shared/content'
import TagBadge from './TagBadge.vue'
import FilterBadge from './FilterBadge.vue'
import DateTimeFilter from './DateTimeFilter.vue'
import { dateTimeFilterLabel, emptyDateTimeFilter, hasDateTimeFilter, type DateTimeFilter as DateTimeFilterValue } from '../utils/dateFilter'

const props = defineProps<{ allTags: ClipboardTag[]; modelValue: string; selectedTags: ClipboardTag[]; dateFilter: DateTimeFilterValue; resultCount: number; favoritesOnly: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedTags': [value: ClipboardTag[]]
  'update:dateFilter': [value: DateTimeFilterValue]
  'update:favoritesOnly': [value: boolean]
}>()
const hasFilters = computed(() => props.favoritesOnly || props.selectedTags.length > 0 || hasDateTimeFilter(props.dateFilter))
function resetFilters() {
  emit('update:favoritesOnly', false)
  emit('update:selectedTags', [])
  emit('update:dateFilter', emptyDateTimeFilter())
  focus()
}
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
      <div class="search-actions -mr-2 flex h-full shrink-0 items-stretch overflow-hidden rounded-r-[7px]">
        <button v-if="query" type="button" class="search-action-button" aria-label="Очистить поиск" title="Очистить поиск" @click="clearSearch"><AppIcon :path="mdiClose" /></button>
        <DateTimeFilter :model-value="dateFilter" :result-count="resultCount" @update:model-value="emit('update:dateFilter', $event)" />
        <button type="button" class="favorites-filter-toggle search-action-button" :class="favoritesOnly ? 'text-accent' : ''" :aria-pressed="favoritesOnly"
          aria-label="Фильтр избранного" title="Избранное" @click="emit('update:favoritesOnly', !favoritesOnly); focus()"><AppIcon :path="favoritesOnly ? mdiStar : mdiStarOutline" /></button>
      </div>
    </div>
    <div v-if="hasFilters" class="filter-row mt-1 flex min-h-10 items-center gap-1 overflow-x-auto" aria-label="Выбранные фильтры">
      <button v-if="favoritesOnly" type="button" class="favorites-filter-clear group inline-flex min-h-10 shrink-0 items-center rounded-lg" aria-label="Убрать фильтр избранного" title="Убрать фильтр избранного" @click="emit('update:favoritesOnly', false); focus()">
        <FilterBadge :icon="mdiStarOutline" label="Избранное" removable class="bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200" />
      </button>
      <button v-for="tag in selectedTags" :key="tagKey(tag)" type="button" class="tag-badge group inline-flex min-h-10 shrink-0 items-center rounded-lg"
        :aria-label="'Убрать фильтр. ' + labels[tag.code] + ': ' + tag.value" :title="labels[tag.code] + ': ' + tag.value" @click="removeTag(tag)">
        <TagBadge :tag="tag" removable />
      </button>
      <button v-if="hasDateTimeFilter(dateFilter)" type="button" class="active-date-filter date-filter-clear group inline-flex min-h-10 shrink-0 items-center rounded-lg" :title="'Убрать фильтр. ' + dateTimeFilterLabel(dateFilter)"
        aria-label="Сбросить дату и время" @click="emit('update:dateFilter', emptyDateTimeFilter()); focus()">
        <FilterBadge :icon="mdiCalendarClockOutline" :label="dateTimeFilterLabel(dateFilter)" removable class="bg-sky-500/10 text-sky-800 tabular-nums dark:bg-sky-400/15 dark:text-sky-200" />
      </button>
      <button type="button" class="reset-filters text-button shrink-0 text-xs" @click="resetFilters">Сбросить</button>
    </div>
    <div v-if="suggestions.length" class="filter-row suggestions mt-1 flex min-h-10 items-center gap-1 overflow-x-auto" aria-label="Предлагаемые фильтры">
      <button v-for="tag in suggestions" :key="tagKey(tag)" type="button" class="tag-badge group inline-flex min-h-10 shrink-0 items-center rounded-lg"
        :aria-label="'Добавить фильтр. ' + labels[tag.code] + ': ' + tag.value" :title="labels[tag.code] + ': ' + tag.value" @click="addSelectedTag(tag)">
        <TagBadge :tag="tag" />
      </button>
    </div>
  </section>
</template>
