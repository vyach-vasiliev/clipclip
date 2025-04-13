import { defineStore } from 'pinia';
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import {getImageSize, getSource} from "../utils/image"


export class ClipboardHistoryItemParamSource{
    title: string;
    path: string;
    processId: string;
    name: string;

    constructor(
        title: string,
        path: string,
        processId: string,
        name: string
    ) {
        this.title = title;
        this.path = path;
        this.processId = processId;
        this.name = name;
    }
}

export class ClipboardHistoryItemParams{
    size: string;
    type: string;
    source: ClipboardHistoryItemParamSource;

    constructor(
        size: string,
        type: string,
        source: ClipboardHistoryItemParamSource
    ) {
        this.size = size;
        this.type = type;
        this.source = source;
    }
}

export class ClipboardHistoryItem{
    type: string;
    data: string;
    params: ClipboardHistoryItemParams;
    isDeleted: boolean = false;

    constructor(
        type: string,
        data: string,
        params: ClipboardHistoryItemParams,
    ) {
        this.type = type;
        this.data = data;
        this.params = params;
    }
}

export const queryInput = ref('');


export const useBufferStore = defineStore('buffer', () => {
    const clipboardHistory = ref<ClipboardHistoryItem[]>([]);
    let interval: NodeJS.Timeout | null = null;

    const loadClipboard = async () => {
        if (!window.electron) return;
        const clipboard = window.electron.clipboard;

        const lastItem = clipboardHistory.value.at(0) || {"data": undefined};
        console.log("lastItem.data", lastItem.data)

        // 1️⃣ Читаем текст
        const text = await clipboard.readText();
        if (text && lastItem.data !== text) {
            console.warn("text", text)
            console.warn("lastItem.data", lastItem.data)
            const params = new ClipboardHistoryItemParams(
                `${text.length} length`,
                    'text',
                    await getSource()
            )
            clipboardHistory.value.unshift(new ClipboardHistoryItem( 'text', text, params));
        }

        // 2️⃣ Читаем изображения
        const image: string = await clipboard.readImage();
        if (image && lastItem.data !== image) {
            // image like as "data:image/png;base64,iVBOR..."
            const imageSizes = await getImageSize(image);
            const params = new ClipboardHistoryItemParams(
                `${imageSizes.width}x${imageSizes.height}`,
                'image',
                await getSource(),
            )
            clipboardHistory.value.unshift(new ClipboardHistoryItem( 'image', image, params));
        }

        // 3️⃣ Читаем файлы
        // const files = clipboard.readFiles();
        // files.forEach(file => {
        //     if (!clipboardHistory.value.some(item => item.data === file)) {
        //         clipboardHistory.value.unshift({ type: 'file', data: file });
        //     }
        // });

        // Ограничиваем историю до 10 элементов
        clipboardHistory.value = clipboardHistory.value.slice(0, 10);
    };

    // 4️⃣ Авто-обновление буфера каждые -N сек.
    const startWatchingClipboard = () => {
        // loadClipboard(); // Загружаем сразу
        interval = setInterval(loadClipboard, 700);
    };

    // 5️⃣ Останавливаем проверку при закрытии
    const stopWatchingClipboard = () => {
        if (interval) clearInterval(interval);
    };

    // 6️⃣ Авто-запуск отслеживания в компонентах Vue
    onMounted(startWatchingClipboard);
    onUnmounted(stopWatchingClipboard);

    return { clipboardHistory, loadClipboard, startWatchingClipboard, stopWatchingClipboard };
});
