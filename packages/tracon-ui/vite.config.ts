import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `npm run dev` proxies to a running engine (`tracon start`) on :4040.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4040",
      "/ws": { target: "ws://127.0.0.1:4040", ws: true },
    },
  },
});
