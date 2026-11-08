/** @type {import('tailwindcss').Config} */
// Palette and font stack copied verbatim from reference/*/code.html's
// inline tailwind.config so the SPA renders as the same design system,
// not a re-interpretation of it (see docs/design/UI-BEHAVIOR.md).
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#3ce36a",
        surface: "#131313",
        "surface-container-lowest": "#0e0e0e",
        "surface-container-low": "#1c1b1b",
        "surface-container": "#201f1f",
        "surface-container-high": "#2a2a2a",
        "on-surface": "#e5e2e1",
        danger: "#ff5c5c",
        warn: "#f1c100",
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
};
