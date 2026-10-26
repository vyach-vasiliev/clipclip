/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
declare module 'virtual:clipclip-licenses' {
  const about: {
    version: string
    author: string
    license: string
    appLicense: string
    components: { name: string; version: string; license: string; text: string }[]
  }
  export const electronNoticesUrl: string
  export default about
}
