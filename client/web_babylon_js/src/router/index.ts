import { createRouter, createWebHistory } from "vue-router";
import DefaultWorld from "../components/DefaultWorld.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/:pathMatch(.*)*",
      name: "main",
      component: DefaultWorld,
    },
  ],
});

export default router;
