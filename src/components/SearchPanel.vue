<script setup lang="ts">
import { computed, ref } from 'vue'
import type { VTextField } from 'vuetify/components/VTextField'
import { mdiMagnify, mdiClose } from '@mdi/js'
import { tagKey, TAG_LABELS, type ClipboardTag } from '../../shared/clipboard'

const props = defineProps<{ allTags: ClipboardTag[]; modelValue: string; selectedTags: ClipboardTag[] }>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedTags': [value: ClipboardTag[]]
}>()
const searchField = ref<InstanceType<typeof VTextField>>()
const query = computed({ get: () => props.modelValue, set: (value: string) => emit('update:modelValue', value ?? '') })
const suggestions = computed(() => {
  const text = props.modelValue.trim().toLocaleLowerCase().replace(/^#/, '')
  if (!props.modelValue.trim()) return []
  return props.allTags.filter(tag => !props.selectedTags.some(selected => tagKey(selected) === tagKey(tag))
    && (tag.value.toLocaleLowerCase().includes(text) || tag.code.includes(text) || TAG_LABELS[tag.code].toLocaleLowerCase().includes(text))).slice(0, 8)
})
const labels = TAG_LABELS
function addSelectedTag(tag: ClipboardTag) {
  if (!props.selectedTags.some(selected => tagKey(selected) === tagKey(tag))) emit('update:selectedTags', [...props.selectedTags, tag])
  emit('update:modelValue', '')
}
function focus() { searchField.value?.focus() }
defineExpose({ focus, addSelectedTag })
</script>

<template>
  <section class="search-panel" aria-label="Поиск и фильтры">
    <v-text-field ref="searchField" v-model="query" label="Поиск в истории" placeholder="Текст, приложение или #фильтр"
      variant="outlined" color="primary" hide-details clearable :prepend-inner-icon="mdiMagnify" :clear-icon="mdiClose" autocomplete="off" />
    <div v-if="selectedTags.length" class="filter-row" aria-label="Выбранные фильтры">
      <v-chip v-for="tag in selectedTags" :key="tagKey(tag)" closable :close-icon="mdiClose"
        :aria-label="labels[tag.code] + ': ' + tag.value"
        @click:close="emit('update:selectedTags', selectedTags.filter(selected => tagKey(selected) !== tagKey(tag)))">
        {{ labels[tag.code] }}: {{ tag.value }}
      </v-chip>
      <v-btn variant="text" @click="emit('update:selectedTags', [])">Сбросить фильтры</v-btn>
    </div>
    <div v-if="suggestions.length" class="filter-row suggestions" aria-label="Предлагаемые фильтры">
      <v-chip v-for="tag in suggestions" :key="tagKey(tag)" variant="outlined" @click="addSelectedTag(tag)">
        {{ labels[tag.code] }}: {{ tag.value }}
      </v-chip>
    </div>
  </section>
</template>
