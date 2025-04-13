import { createWebHistory, createWebHashHistory, createRouter } from "vue-router";
import HelloWorld from "../components/HelloWorld.vue";
import Second from "../components/Second.vue";

const routes = [
    {
        path: "/hello",
        name: "hello",
        component: HelloWorld,
    },
    {
        path: "/second",
        name: "Second",
        component: Second,
    },
];

const router = createRouter({
    history: createWebHistory(),
    routes,
});

export default router;