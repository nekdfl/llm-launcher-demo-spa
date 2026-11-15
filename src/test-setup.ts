import "@testing-library/jest-dom/vitest";

// jsdom не реализует ResizeObserver; тесты, которым важен ресайз, вызывают
// колбэк через собственный мок.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
