<script setup lang="ts">
import {ref, computed, onMounted, onUnmounted} from 'vue';
import {ClipboardHistoryItem, ClipboardHistoryItemTag, queryInput, useBufferStore} from '../store/buffer';
import SearchPanel from './SearchPanel.vue';

const searchField = ref(null);
const searchPanelRef = ref<InstanceType<typeof SearchPanel>>();
const selectedIndex = ref(0);
const selectedTags = ref<ClipboardHistoryItemTag[]>([]);

const allTags = computed((): ClipboardHistoryItemTag[] => {
  const tags = new Set<string>();
  bufferStore.clipboardHistory.forEach(item => {
    item.params.tags?.forEach(tag => {
      tags.add(`${tag.code}:${tag.value}`);
    });
  });
  return Array.from(tags).map(tag => {
    const [code, value] = tag.split(':');
    return { code, value };
  });
});

const bufferStore = useBufferStore();

const filteredClipboardHistory = computed(() => {
  const query = queryInput.value.toLowerCase().trim();
  
  let clipboardHistory = bufferStore.clipboardHistory;
  
  return clipboardHistory.filter(item => {
    // Фильтрация по тексту (если есть запрос)
    const textMatches = !query || 
      (item.type === 'text' && item.data.toLowerCase().includes(query)) ||
      item.params.tags?.some(tag => tag.value.toLowerCase().includes(query));
    
    // Фильтрация по тегам (если есть выбранные теги)
    const tagsMatch = selectedTags.value.length === 0 || 
      selectedTags.value.every(selectedTag => 
        item.params.tags?.some(tag => 
          tag.code === selectedTag.code && 
          tag.value === selectedTag.value
        )
      );
    
    return textMatches && tagsMatch && !item.isDeleted;
  });
});

const showTagSuggestions = computed(() => {
  return queryInput.value.trim().length > 0;
});

const suggestedTags = computed(() => {
  console.log("queryInput", allTags.value);
  const query = queryInput.value.toLowerCase().trim();
  if (!query) return [];
  
  return allTags.value.filter(tag => 
    {
      return tag.value.toLowerCase().includes(query) ||
    tag.code.toLowerCase().includes(query)
    }
  );
});

const highlightTextAsHTML = (text: string) => {
  const query = queryInput.value.toLowerCase().trim();
  if (!query) return text;
  const regex = new RegExp(query, 'gi');
  return text.replace(regex, '<mark class="query-mark">$&</mark>');
}

const handleKeydown = (event: KeyboardEvent) => {
  // Check if the pressed key is a letter and not a special key
  if (event.key === 'Meta' || event.key === 'Control' || event.key === 'Shift') return;
  if (event.ctrlKey || event.altKey || event.metaKey) return;

  console.log("keyEvent", event);

  if (/^[a-zA-Zа-яА-Я0-9\s]$/.test(event.key)) {
    searchPanelRef.value?.searchField?.focus(); // Set autofocus on the search field
  }

  if (event.key === "ArrowDown") {
    selectedIndex.value = (selectedIndex.value + 1) % filteredClipboardHistory.value.length
    console.log("selectedIndex.value", selectedIndex.value)
  } else if (event.key === "ArrowUp") {
    selectedIndex.value =
        (selectedIndex.value - 1 + filteredClipboardHistory.value.length) %
        filteredClipboardHistory.value.length
  }

  if (event.key === "Enter") {
    const item = filteredClipboardHistory.value[selectedIndex.value]
    copyToClipboard(item)
  }

  if (event.key === "Delete") {
    const item = filteredClipboardHistory.value[selectedIndex.value]
    const historyIndex = bufferStore.clipboardHistory.indexOf(item)
    bufferStore.clipboardHistory[historyIndex].isDeleted = true
  }

};

const handleSelectedTagsUpdate = (tags: ClipboardHistoryItemTag[]) => {
  selectedTags.value = tags;
};

const handleTagClick = (tag: ClipboardHistoryItemTag) => {
  searchPanelRef.value?.addSelectedTag(tag);
};

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  bufferStore.loadClipboard();
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});


const copyTextToClipboard = async (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    console.log('Text copied:', text);
  }).catch((err) => {
    console.error('Failed to copy text:', err);
  });
}
const copyImageToClipboard = async (base64: string) => {
  try {
    // 1️⃣ Убираем `data:image/png;base64,` (или другой формат)
    const [headers, base64Data] = base64.split(',');
    // console.log(base64);
    const typeData = headers.split(';')[0].split(':')[1];

    if (['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml'].indexOf(typeData) === -1){
      console.log('Wrong image type:', typeData);
      throw new Error(`Wrong image type: ${typeData}`);
    }


    // 2️⃣ Преобразуем base64 → бинарные данные
    const binaryData = atob(base64Data);
    const arrayBuffer = new Uint8Array(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      arrayBuffer[i] = binaryData.charCodeAt(i);
    }

    // 3️⃣ Создаём Blob (изображение, тип PNG)
    const blob = new Blob([arrayBuffer], { type: 'image/png' });

    // 4️⃣ Копируем в буфер обмена через Clipboard API
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);

    console.log('Image copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy image:', err);
  }
};

const copyToClipboard = (item: ClipboardHistoryItem) => {
  // if (!text.data) return;
  if (item.type === 'text'){
    copyTextToClipboard(item.data);
  } else if (item.type === 'image') {
    copyImageToClipboard(item.data);
  }
};

const selectIndex = (index: number) => {
  selectedIndex.value = index;
};


</script>
<style>
body {
  background: #f3f4f6;
}

#clipboard-history {
  background-color: #e2e8f0;
  border-radius: 10px;
}

#clipboard-history .clipboard-item {
}

#clipboard-history .clipboard-item .card-body {
  width: 300px;
  min-height: 20px;
  max-height: 60px;
  font-size: .8em;
}

.query-mark {
  background-color: #bacce6;
}

.v-chip-group .v-chip {
  margin-right: 3px!important;
}
.v-chip-group .copy-chip {
  visibility: hidden!important;
}
.v-card:hover .v-chip-group .copy-chip {
  visibility: visible!important;
}
.v-card {
  border: 2px solid transparent!important;
}
.v-card.selected {
  border: 2px solid #42a5f5!important;
  background-color: #e3f2fd!important;
}
</style>

<template>
  <v-container class="ma-0">
    <SearchPanel 
      ref="searchPanelRef"
      v-model="queryInput"
      :all-tags="allTags"
      @update:selectedTags="handleSelectedTagsUpdate"
    />
    
    <div id="clipboard-history" class="d-flex flex-wrap flex-column justify-center pt-2 pb-4"
         style="min-height: 300px;">

      <!--    <v-infinite-scroll v-if="bufferStore.clipboardHistory.length" :items="bufferStore.clipboardHistory" @load="">-->
      <template v-for="(item, index) in filteredClipboardHistory" :key="item">
        <v-card class="clipboard-item ml-3 mt-2 mr-3" :class="{ selected: index === selectedIndex }" @click="selectIndex(index)">
          <v-card-text class="card-body pa-2">

            <template v-if="item.type === 'text'" v-show="!queryInput.trim() || item.data.includes(queryInput.trim())">
<!--              <p v-html="highlightTextAsHTML(item.data)"></p>-->
<!--              <p v-html="item.data"></p>-->
              <p v-text="item.data.trim() == '' ? '<spaces>' : item.data"></p>
            </template>
            <template v-else-if="item.type === 'image'">
              <img :src="item.data" alt="Clipboard Image" style="max-width: 200px;" aspect-ratio="16/9" cover/>
            </template>
            <!--        <template v-else-if="item.type === 'file'">-->
            <!--          📂 Файл: <a :href="item.data" target="_blank">{{ item.data }}</a>-->
            <!--        </template>-->

          </v-card-text>

          <div class="flex-wrap flex-column justify-space-between">

<!--            <v-chip-group selected-class="bg-deep-purple-lighten-2" class="ml-1 mb-0 pa-0">-->
            <v-chip-group class="ml-1 mb-0 pa-0 tags-group">
              <v-chip 
              v-for="(tag, index) in item.params.tags" :key="index" class="chip" size="x-small" label variant="outlined" style="background-color: #FFF;" @click="handleTagClick(tag)"
              >{{ tag.value }}</v-chip>

              <v-chip size="x-small" class="copy-chip ml-auto" label variant="flat"
                      @click="copyToClipboard(item)">Copy</v-chip>
            </v-chip-group>

          </div>
        </v-card>
      </template>

      <template v-if="filteredClipboardHistory.length === 0">
        <v-card class="clipboard-item ml-3 mt-2 mr-3">
          <v-card-text class="card-body pa-2">
            <p>Nothing found</p>
          </v-card-text>
        </v-card>
      </template>
    </div>
    <!--    </v-infinite-scroll>-->
  </v-container>
</template>