import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import { VApp } from 'vuetify/components/VApp'
import { VBtn } from 'vuetify/components/VBtn'
import { VChip } from 'vuetify/components/VChip'
import { VIcon } from 'vuetify/components/VIcon'
import { VTextField } from 'vuetify/components/VTextField'
import { VAlert } from 'vuetify/components/VAlert'
import { VProgressLinear } from 'vuetify/components/VProgressLinear'
import { Ripple } from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import App from './App.vue'
import router from './router'
import 'vuetify/styles'
import './style.css'

const vuetify = createVuetify({
  components: { VApp, VBtn, VChip, VIcon, VTextField, VAlert, VProgressLinear },
  directives: { Ripple },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: { defaultTheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'clipclipDark' : 'clipclipLight',
    themes: {
      clipclipLight: { dark: false, colors: { primary: '#235cc4', info: '#235cc4', background: '#f4f6fa', surface: '#ffffff' } },
      clipclipDark: { dark: true, colors: { primary: '#98bbff', info: '#98bbff', background: '#111723', surface: '#1b2433' } },
    },
  },
})
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
  vuetify.theme.change(event.matches ? 'clipclipDark' : 'clipclipLight')
})
createApp(App).use(createPinia()).use(vuetify).use(router).mount('#app')
