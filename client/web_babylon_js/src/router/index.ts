import { createRouter, createWebHistory } from "vue-router";
import MainScene from "../components/MainScene.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/:pathMatch(.*)*",
      name: "main",
      component: MainScene,
    },
  ],
});

export default router;
