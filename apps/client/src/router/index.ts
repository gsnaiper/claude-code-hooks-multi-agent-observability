import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/events'
  },
  {
    path: '/events',
    name: 'events',
    component: () => import('../views/EventsView.vue')
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('../views/ProjectsView.vue')
  },
  {
    path: '/projects/:id',
    name: 'project-detail',
    component: () => import('../views/ProjectDetailView.vue'),
    props: true
  },
  {
    path: '/preview-variants',
    name: 'preview-variants',
    component: () => import('../views/PreviewVariants.vue')
  }
]

export default createRouter({
  history: createWebHistory(),
  routes
})
