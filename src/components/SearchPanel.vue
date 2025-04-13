<template>
  <div>
    <v-row justify="start" class="mb-2">
      <v-col
        v-for="(tag, index) in selectedTags"
        :key="index"
        class="pa-0"
        cols="auto"
      >
        <v-chip
          class="chip ma-1" size="small"
          closable
          @click:close="removeTag(index)"
        >
          {{ tag.code }}: {{ tag.value }}
        </v-chip>
      </v-col>
    </v-row>
    
    <v-text-field 
      label="Start typing to search.." 
      variant="underlined" 
      v-model="searchQuery" 
      ref="searchField"
    ></v-text-field>
    
    <v-row justify="start" v-if="showTagSuggestions" class="mb-2">
      <v-chip
        v-for="(tag, index) in suggestedTags"
        :key="index"
        class="ma-1"
        @click="addSelectedTag(tag)"
      >
        {{ tag.code }}: {{ tag.value }}
      </v-chip>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ClipboardHistoryItemTag } from '../store/buffer';

const props = defineProps<{
  allTags: ClipboardHistoryItemTag[];
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'update:selectedTags', tags: ClipboardHistoryItemTag[]): void;
}>();

const searchField = ref(null);
const searchQuery = ref(props.modelValue);
const selectedTags = ref<ClipboardHistoryItemTag[]>([]);

watch(searchQuery, (newVal) => {
  emit('update:modelValue', newVal);
});

const showTagSuggestions = computed(() => {
  return searchQuery.value.trim().startsWith('#') || 
         searchQuery.value.trim().length > 0;
});

const suggestedTags = computed(() => {
  const query = searchQuery.value.toLowerCase().trim();
  if (!query) return [];
  
  return props.allTags.filter(tag => {
    const normalizedQuery = query.startsWith('#') ? query.slice(1) : query;
    const matchesValue = tag.value.toLowerCase().includes(normalizedQuery);
    
    return (query.startsWith('#') && matchesValue) ||
           (tag.showWithoutHash && matchesValue);
  });
});

const addSelectedTag = (tag: ClipboardHistoryItemTag) => {
  if (!selectedTags.value.some(t => t.value === tag.value)) {
    selectedTags.value.push(tag);
    emit('update:selectedTags', selectedTags.value);
  }
  searchQuery.value = '';
};

const removeTag = (index: number) => {
  selectedTags.value.splice(index, 1);
  emit('update:selectedTags', selectedTags.value);
};

defineExpose({
  searchField,
  addSelectedTag
});
</script>
