import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite";

// The engine's local secret, so the dev deck can POST like the page the engine serves. Dev server only: a build must never carry it.
const secret = () => {
  try {
    return readFileSync(join(process.env.TRACON_STATE ?? join(homedir(), ".config", "tracon"), "secret"), "utf8").trim();
  } catch {
    return "";
  }
};

// `npm run dev` proxies to a running engine (`tracon start`) on :4040.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: "tracon-secret", apply: "serve", transformIndexHtml: () => [{ tag: "meta", attrs: { name: "tracon-secret", content: secret() }, injectTo: "head" }] },
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4040",
      "/ws": { target: "ws://127.0.0.1:4040", ws: true },
    },
  },
});
