// import {activeWindow} from 'get-windows';

import {Result} from "get-windows";
import {ClipboardHistoryItemParamSource} from "../store/buffer";

export const getImageSize = (url: string): Promise<{ width: number; height: number }> => {
    const image = new Image();
    image.src = url;
    return new Promise((resolve) => {
        image.onload = () => {
            resolve({ width: image.width, height: image.height });
        };
    });
};

export const getSource = async () => {
    const activeWinData: Result | undefined = await window.electron.getActiveWindowSync();
    console.warn("activeWinData", activeWinData);
    if (activeWinData) {
        return {
            title: activeWinData.title,
            path: activeWinData.owner && activeWinData.owner.path || '<unknown>',
            processId: activeWinData.owner && activeWinData.owner.processId.toString() || '<unknown>',
            name: activeWinData.owner && activeWinData.owner.name || '<unknown>',
        };
    } else {
        return new ClipboardHistoryItemParamSource(
            '<unknown>',
            '<unknown>',
            '<unknown>',
            '<unknown>',
        )
    }
    // return new Promise((resolve) => {
    // activeWindow(options).then(
    // activeWindow().then(
    //     (window) => {
    //         resolve(window.title);
    //     });
    // })
};