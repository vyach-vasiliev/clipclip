/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    VSCODE_DEBUG?: string
    CLIPCLIP_DEVTOOLS?: string
    CLIPCLIP_TEST_MODE?: string
    CLIPCLIP_TEST_USER_DATA?: string
  }
}
