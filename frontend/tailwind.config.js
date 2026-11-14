/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#070b13", 900: "#0b111c", 850: "#0f1623", 800: "#141c2b", 700: "#1c2638", 600: "#2a364c", 500: "#3d4a63" },
        modis: "#2f8fd8", viirs: "#d4b030", harm: "#e0552f", fire: "#ff7a3d",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
