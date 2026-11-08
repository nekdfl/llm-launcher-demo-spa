import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

// Сборка функциональной копии SPA в reference/app/index.html: один файл,
// JS и CSS встроены, скрипт классический (не module) — file:// не грузит
// module-скрипты. Запуск: `npm run build:reference` из spa/.
const root = fileURLToPath(new URL(".", import.meta.url));

function inlineIntoHtml(): Plugin {
  return {
    name: "reference-inline",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") return;
      let source = String(html.source);
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === "chunk") {
          source = source.replace(new RegExp(`<script[^>]*src="[^"]*${item.fileName}"[^>]*></script>\\s*`), "");
          const code = item.code.replace(/<\/script/gi, "<\\/script");
          // Заменитель — функция: в коде бандла встречаются `$&`/`$'`,
          // которые строковый заменитель понял бы как шаблоны.
          source = source.replace("</body>", () => `<script>${code}</script>\n</body>`);
          delete bundle[name];
        } else if (item.fileName.endsWith(".css")) {
          source = source.replace(new RegExp(`<link[^>]*href="[^"]*${item.fileName}"[^>]*>`), () => `<style>${String(item.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = source;
    },
  };
}

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), inlineIntoHtml()],
  build: {
    outDir: fileURLToPath(new URL("../build/app", import.meta.url)),
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true },
    },
  },
});
