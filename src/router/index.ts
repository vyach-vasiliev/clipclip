import { createWebHashHistory, createRouter } from 'vue-router'
import Second from '../components/Second.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/history' },
    { path: '/history', alias: '/second', component: Second },
    { path: '/:pathMatch(.*)*', redirect: '/history' },
  ],
})
