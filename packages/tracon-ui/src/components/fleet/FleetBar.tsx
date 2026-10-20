import { Bell, BellOff, Moon, Radar, Smartphone, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import type { AwayMode, FlightPacket, Snapshot } from "../../../../avalokita-engine/src/types.ts";
import { enablePush, pushStatus, type PushStatus } from "../../lib/push.ts";
import type { Theme } from "../../lib/theme.ts";
import { post } from "../../lib/remote.ts";
import { tokens } from "./FlightCard.tsx";

const MODES: { mode: AwayMode; label: string; hint: string }[] = [
  { mode: "auto", label: "AUTO", hint: "Away after 3 idle minutes at the Mac; back when you touch it" },
  { mode: "on", label: "AWAY", hint: "Hold questions and plans for your devices until set back" },
  { mode: "off", label: "AT DESK", hint: "The terminal asks; only permission prompts also show here" },
];

const PUSH_TEXT: Record<PushStatus, string> = { on: "PUSH ON", off: "ENABLE PUSH", blocked: "PUSH BLOCKED", unsupported: "NO PUSH" };

/** Who answers held prompts (the terminal or your devices), and web push for this device. */
function RemoteControls({ away }: { away: Snapshot["away"] }) {
  const [push, setPush] = useState<PushStatus>("off");
  useEffect(() => {
    pushStatus().then(setPush, () => setPush("unsupported"));
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] tracking-widest">
      <span className={`flex items-center gap-1 ${away.away ? "text-amber-300" : "text-slate-400"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${away.away ? "bg-amber-400" : "bg-slate-500"}`} />
        {away.away ? "YOU'RE AWAY" : "AT THE MAC"}
      </span>
      <div role="group" aria-label="Who answers held prompts" className="flex overflow-hidden rounded border border-slate-700">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            title={m.hint}
            aria-pressed={away.mode === m.mode}
            onClick={() => void post("/api/away", { mode: m.mode })}
            className={`min-h-8 px-2 ${away.mode === m.mode ? "bg-slate-700 text-slate-100" : "text-slate-400 hover:text-slate-200"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={push === "on" || push === "unsupported"}
        onClick={() => enablePush().then(setPush, () => setPush("off"))}
        title={push === "unsupported" ? "This browser has no web push (on iPhone: Share > Add to Home Screen, then open TRACON from there)" : "Notify this device when a session needs you"}
        className={`flex min-h-8 items-center gap-1 rounded border px-2 ${push === "on" ? "border-emerald-700 text-emerald-300" : "border-slate-700 text-slate-400 hover:border-amber-400"}`}
      >
        <Smartphone className="h-3.5 w-3.5" aria-hidden />
        {PUSH_TEXT[push]}
      </button>
    </div>
  );
}

interface Alerts {
  enabled: boolean;
  toggle: () => void;
  blocked: boolean;
}

export function FleetBar({ flights, online, alerts, away, theme }: { flights: FlightPacket[]; online: boolean; alerts: Alerts; away: Snapshot["away"]; theme: { theme: Theme; toggle: () => void } }) {
  const ThemeIcon = theme.theme === "dark" ? Sun : Moon;
  const BellIcon = alerts.enabled ? Bell : BellOff;
  const airborne = flights.filter((f) => f.flightState !== "landed" && f.flightState !== "aborted").length;
  const holding = flights.filter((f) => f.flightState === "holding").length;
  const burn = flights.reduce((s, f) => s + f.fuelMetrics.burnRatePerMin, 0);
  const stat = (label: string, value: string | number, tone = "text-slate-100") => (
    <div className="text-right">
      <div className="text-[10px] tracking-widest text-slate-500">{label}</div>
      <div className={`font-mono text-lg ${tone}`}>{value}</div>
    </div>
  );
  return (
    <header className="sticky top-0 z-10 border-b border-emerald-900/60 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radar className="h-6 w-6 text-emerald-400" aria-hidden />
          <h1 className="font-mono text-lg font-bold tracking-widest text-emerald-300">TRACON ATC</h1>
          <span
            className={`ml-2 inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] ${online ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"}`} />
            {online ? "ENGINE LIVE" : "ENGINE OFFLINE"}
          </span>
        </div>
        <div className="flex flex-wrap gap-4 sm:ml-auto sm:gap-6">
          {stat("FLIGHTS", flights.length)}
          {stat("AIRBORNE", airborne, "text-cyan-300")}
          {stat("HOLDING", holding, holding ? "text-amber-300" : "text-slate-100")}
          {stat("BURN / MIN", tokens(burn))}
          <button
            type="button"
            onClick={alerts.toggle}
            aria-pressed={alerts.enabled}
            title={alerts.blocked ? "Notifications are blocked for this site; only the chime will sound" : "Chime and notify when a flight enters holding"}
            className={`flex items-center gap-1 self-center rounded border px-2 py-1 font-mono text-[10px] tracking-widest ${alerts.enabled ? "border-amber-500 text-amber-300" : "border-slate-700 text-slate-400"} hover:border-amber-400`}
          >
            <BellIcon className="h-3.5 w-3.5" aria-hidden />
            ALERTS {alerts.enabled ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={theme.toggle}
            title={`Switch to ${theme.theme === "dark" ? "light" : "dark"} mode`}
            className="flex items-center gap-1 self-center rounded border border-slate-700 px-2 py-1 font-mono text-[10px] tracking-widest text-slate-400 hover:border-amber-400"
          >
            <ThemeIcon className="h-3.5 w-3.5" aria-hidden />
            {theme.theme === "dark" ? "LIGHT" : "DARK"}
          </button>
        </div>
        <div className="w-full">
          <RemoteControls away={away} />
        </div>
      </div>
    </header>
  );
}
