import { FileText, PenLine, Terminal, TriangleAlert, Users, Workflow, Wrench, type LucideIcon } from "lucide-react";
import type { FlightPacket, FlightState, ToolAction } from "../../../../avalokita-engine/src/types.ts";

export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export const SQUAWK: Record<FlightPacket["accountTier"], string> = { pro_20: "SQ-20", team_100: "SQ-100", api_usage: "SQ-API", gemini: "SQ-AGY" };

const STATE: Record<FlightState, { label: string; tone: string }> = {
  preflight: { label: "PREFLIGHT", tone: "bg-sky-900/60 text-sky-200" },
  cruising: { label: "CRUISING", tone: "bg-emerald-900/60 text-emerald-200" },
  tool_executing: { label: "TOOL", tone: "bg-cyan-900/60 text-cyan-200" },
  holding: { label: "HOLDING", tone: "bg-amber-500 text-slate-950 animate-pulse" },
  landed: { label: "LANDED", tone: "bg-slate-800 text-slate-400" },
  aborted: { label: "ABORTED", tone: "bg-red-900/70 text-red-200" },
};

const ACTION_ICON: Record<ToolAction, LucideIcon> = { read: FileText, write: PenLine, bash: Terminal, subagent: Users, other: Wrench };

export const ago = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};

export function Gauge({ label, pct, text, danger = false }: { label: string; pct?: number; text: string; danger?: boolean }) {
  return (
    <div>
      <div className="flex justify-between text-[10px] tracking-widest text-slate-500">
        <span>{label}</span>
        <span className="font-mono text-slate-300">{text}</span>
      </div>
      <div className="mt-1 h-1.5 rounded bg-slate-800" role="meter" aria-label={label} aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
        {pct !== undefined && <div className={`h-full rounded ${danger && pct > 80 ? "bg-red-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, pct)}%` }} />}
      </div>
    </div>
  );
}

export function FlightCard({ f, maxBurn, selected, onTrace }: { f: FlightPacket; maxBurn: number; selected: boolean; onTrace: () => void }) {
  const st = STATE[f.flightState];
  const Icon = f.activeTool ? ACTION_ICON[f.activeTool.action] : null;
  const fuel = f.fuelMetrics;
  const tcas = f.collisionWarning;
  const ring = f.flightState === "holding" ? "border-amber-400 shadow-[0_0_24px_-6px] shadow-amber-400" : tcas ? "border-red-500" : f.flightState === "aborted" ? "border-red-800" : selected ? "border-emerald-500" : "border-slate-800";
  return (
    <article className={`min-w-0 rounded-lg border bg-slate-900/70 p-4 ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-slate-100">{f.flightCallsign}</span>
            <span className="rounded border border-emerald-800 px-1.5 font-mono text-[10px] text-emerald-300">{SQUAWK[f.accountTier]}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={f.cwd}>
            {f.runtime} · {f.cwd.split("/").slice(-2).join("/") || "unknown cwd"}
            {f.pid ? ` · pid ${f.pid}` : ""}
          </div>
        </div>
        <span className={`shrink-0 rounded px-2 py-0.5 font-mono text-[11px] font-semibold ${st.tone}`}>{st.label}</span>
      </div>

      <div className="mt-3 min-h-10 rounded bg-slate-950/60 px-2 py-1.5 font-mono text-xs">
        {f.activeTool && Icon ? (
          <div className="flex gap-2">
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-300" aria-label={f.activeTool.action} />
            <div className="min-w-0">
              <div className="text-cyan-200">{f.activeTool.name}</div>
              <div className="truncate text-slate-500" title={f.activeTool.targetFile ?? f.activeTool.details}>
                {f.activeTool.targetFile ?? f.activeTool.details ?? ""}
              </div>
            </div>
          </div>
        ) : (
          <span className="text-slate-600">no tool in flight</span>
        )}
      </div>

      {tcas && (
        <div role="alert" className="mt-2 flex gap-2 rounded border border-red-700/70 bg-red-950/40 px-2 py-1.5 font-mono text-xs text-red-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0">
            <div>
              <span className="font-semibold text-red-300">TCAS</span> · {tcas.conflictingFlight} also wrote this file in the last 5 min
            </div>
            <div className="truncate text-red-300/80" title={tcas.sharedFile}>
              {tcas.sharedFile}
            </div>
          </div>
        </div>
      )}

      {f.subagents.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="subagents">
          {f.subagents.map((s) => (
            <li key={s.id} className="max-w-full truncate rounded bg-indigo-950 px-1.5 py-0.5 font-mono text-[10px] text-indigo-200" title={s.id}>
              {s.role} · {s.state}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid gap-2">
        <Gauge
          label="BURN / MIN (5 MIN AVG)"
          pct={maxBurn > 0 ? (fuel.burnRatePerMin / maxBurn) * 100 : 0}
          text={tokens(fuel.burnRatePerMin)}
        />
        <Gauge
          label="QUOTA"
          danger
          pct={fuel.quotaPercentage}
          text={fuel.quotaPercentage === undefined ? "n/a" : `${Math.round(fuel.quotaPercentage)}%`}
        />
        <div className="flex justify-between font-mono text-[11px] text-slate-500">
          <span>
            in {tokens(fuel.inputTokens)} · out {tokens(fuel.outputTokens)}
          </span>
          <span>{ago(f.timestamp)}</span>
        </div>
        <button
          type="button"
          onClick={onTrace}
          aria-pressed={selected}
          className="flex items-center justify-center gap-1 rounded border border-slate-700 py-1 font-mono text-[11px] text-slate-300 hover:border-emerald-500 hover:text-emerald-200"
        >
          <Workflow className="h-3.5 w-3.5" aria-hidden />
          {selected ? "HIDE DAG" : "VIEW DAG"}
        </button>
      </div>
    </article>
  );
}
