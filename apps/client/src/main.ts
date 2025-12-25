import { createApp } from 'vue'
import './styles/main.css'
import './styles/themes.css'
import App from './App.vue'
import router from './router'

createApp(App).use(router).mount('#app')
