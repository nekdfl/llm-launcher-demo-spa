/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In production nginx puts the SPA and DRF on one origin (DESIGN §2.2) so
// relative fetches like "/auth/token/" just work. The dev server needs its
// own proxy to the same effect — DRF's runserver port, overridable via
// DJANGO_DEV_SERVER (used by CI/dev scripts that pick a different port).
const djangoTarget = process.env.DJANGO_DEV_SERVER ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": djangoTarget,
      "/accounts": djangoTarget,
      "/orchestrator": { target: djangoTarget, ws: false },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    // Прогон ограничен по ресурсам: стенд — рабочая машина с работающими
    // моделями, и тесты не должны занимать её целиком. 4 воркера — это около
    // 25 % CPU на 24-ядерной машине и меньше гигабайта RAM на jsdom-окружения
    // (замерено). Без ограничения vitest берёт все ядра и заметно грузит стенд.
    maxWorkers: 4,
    minWorkers: 2,
  },
});
