declare namespace NodeJS {
  interface ProcessEnv {
    VITE_DEV_SERVER_URL?: string
    VSCODE_DEBUG?: string
    CLIPCLIP_DEVTOOLS?: string
    CLIPCLIP_TEST_MODE?: string
    CLIPCLIP_TEST_USER_DATA?: string
  }
}
