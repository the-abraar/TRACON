import { Bell, BellOff, Radar } from "lucide-react";
import type { FlightPacket } from "../../../../avalokita-engine/src/types.ts";
import { tokens } from "./FlightCard.tsx";

interface Alerts {
  enabled: boolean;
  toggle: () => void;
  blocked: boolean;
}

export function FleetBar({ flights, online, alerts }: { flights: FlightPacket[]; online: boolean; alerts: Alerts }) {
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
        </div>
      </div>
    </header>
  );
}
