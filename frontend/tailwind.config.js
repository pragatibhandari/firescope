/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#03112b", 900: "#06183b", 850: "#08204c", 800: "#0a275c", 700: "#0b3d91", 600: "#2a55a8", 500: "#4a70bf" },
        modis: "#2f8fd8", viirs: "#d4b030", harm: "#e0552f", fire: "#ff7a3d",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
