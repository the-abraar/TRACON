import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { takePairToken } from "./lib/remote.ts";

takePairToken();
// push notifications only; the service worker caches nothing
if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
