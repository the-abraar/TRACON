import { useEffect, useRef, useState } from "react";
import type { FlightPacket, FlightState } from "../../../../avalokita-engine/src/types.ts";
import { newlyHolding } from "./holding.ts";

const KEY = "tracon.alerts";
let audio: AudioContext | undefined;

// Browsers only start audio from a user gesture, so the toggle click (or the next click after a reload) unlocks it.
function unlockAudio() {
  audio ??= new AudioContext();
  void audio.resume();
}

/** Two-tone transponder chime. */
function chime() {
  if (audio?.state !== "running") return;
  const t = audio.currentTime;
  [880, 1320].forEach((hz, i) => {
    const o = audio!.createOscillator();
    const g = audio!.createGain();
    const at = t + i * 0.18;
    o.frequency.value = hz;
    o.connect(g).connect(audio!.destination);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    o.start(at);
    o.stop(at + 0.17);
  });
}

const canNotify = () => typeof Notification !== "undefined";

/** Chime + system notification when a flight enters holding; the tab title always shows the holding count. */
export function useHoldingAlerts(flights: FlightPacket[]) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "on";
    } catch {
      return false;
    }
  });
  const prev = useRef(new Map<string, FlightState>());
  const last = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, [enabled]);

  useEffect(() => {
    const now = Date.now();
    const fresh = newlyHolding(prev.current, flights, last.current, now);
    prev.current = new Map(flights.map((f) => [f.flightCallsign, f.flightState]));
    const n = flights.filter((f) => f.flightState === "holding").length;
    document.title = n ? `(${n}) HOLDING · TRACON ATC` : "TRACON ATC";
    if (!enabled || fresh.length === 0) return;
    for (const f of fresh) last.current.set(f.flightCallsign, now);
    chime();
    if (canNotify() && Notification.permission === "granted")
      for (const f of fresh)
        new Notification(`${f.flightCallsign} is holding`, {
          body: `${f.cwd || f.runtime}${f.activeTool ? ` · ${f.activeTool.name}` : ""} is waiting on you`,
          tag: f.flightCallsign,
        });
  }, [flights, enabled]);

  const toggle = () => {
    const on = !enabled;
    setEnabled(on);
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* private window: the setting lasts for this tab only */
    }
    if (!on) return;
    unlockAudio();
    if (canNotify() && Notification.permission === "default") void Notification.requestPermission();
  };
  const blocked = canNotify() && Notification.permission === "denied";
  return { enabled, toggle, blocked };
}
