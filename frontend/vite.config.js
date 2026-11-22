import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Expose REACT_APP_* (as used in .env / docker-compose) as well as Vite's own VITE_* vars.
  envPrefix: ["VITE_", "REACT_APP_"],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          d3: ["d3", "topojson-client"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
