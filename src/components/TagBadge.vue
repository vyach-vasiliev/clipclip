<script setup lang="ts">
import { computed } from 'vue'
import { mdiApplicationOutline, mdiFormatText, mdiRuler, mdiImageOutline, mdiCounter, mdiFileDocumentOutline, mdiLinkVariant, mdiFolderOutline, mdiPaletteOutline } from '@mdi/js'
import { TAG_LABELS, type ClipboardTag } from '../../shared/clipboard'
import { tagKind } from '../../shared/content'
import FilterBadge from './FilterBadge.vue'
const props = defineProps<{ tag: ClipboardTag; removable?: boolean }>()
const colors = {
  color: 'bg-pink-500/10 text-pink-800 dark:bg-pink-400/15 dark:text-pink-200',
  source: 'bg-sky-500/10 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200',
  text: 'bg-violet-500/10 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200',
  image: 'bg-emerald-500/10 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200',
  document: 'bg-orange-500/10 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200',
  file: 'bg-orange-500/10 text-orange-800 dark:bg-orange-400/15 dark:text-orange-200',
  link: 'bg-indigo-500/10 text-indigo-800 dark:bg-indigo-400/15 dark:text-indigo-200',
  length: 'bg-amber-500/10 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200',
  size: 'bg-rose-500/10 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200',
  other: 'bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-200',
}
const icons = { color: mdiPaletteOutline, source: mdiApplicationOutline, text: mdiFormatText, image: mdiImageOutline,
  document: mdiFileDocumentOutline, file: mdiFolderOutline, link: mdiLinkVariant, length: mdiCounter, size: mdiRuler, other: mdiFormatText }
const category = computed((): keyof typeof colors => props.tag.code === 'source' ? 'source'
  : props.tag.code === 'size' ? props.tag.value.toLocaleLowerCase().includes('симв') ? 'length' : 'size' : tagKind(props.tag) ?? 'other')
</script>

<template>
  <FilterBadge :icon="icons[category]" :label="tag.value" :removable="removable" :class="colors[category]" :title="TAG_LABELS[tag.code] + ': ' + tag.value" />
</template>
