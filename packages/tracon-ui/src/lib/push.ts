import { api, post } from "./remote.ts";

export type PushStatus = "on" | "off" | "blocked" | "unsupported";

const supported = () => "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const sub = Notification.permission === "granted" && (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription());
  // re-send on every open: "on" must mean the engine has it, not just this device (the engine dedupes by endpoint)
  return sub && (await post("/api/push/subscribe", sub.toJSON()).then((r) => r.ok, () => false)) ? "on" : "off";
}

/** Asks for notification permission and registers this device for the engine's web push. On iOS it works only from the Home Screen app. */
export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return "unsupported";
  if ((await Notification.requestPermission()) !== "granted") return "blocked";
  const reg = await navigator.serviceWorker.ready;
  const { key } = (await (await api("/api/push/key")).json()) as { key: string };
  const applicationServerKey = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
  return (await post("/api/push/subscribe", sub.toJSON())).ok ? "on" : "off";
}
