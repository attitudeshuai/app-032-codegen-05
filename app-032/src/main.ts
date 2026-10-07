import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { loadStore } from './core/store'
import { loadHangingStore } from './core/hangingStore'

loadStore()
loadHangingStore()

createApp(App).use(router).mount('#app')
