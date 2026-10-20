import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState } from "react";
import type { Account, QuotaWindow } from "../../../../avalokita-engine/src/types.ts";
import { Gauge, SQUAWK, ago } from "./FlightCard.tsx";

const until = (iso: string) => {
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h${m % 60}m` : `${Math.floor(m / 1440)}d${Math.floor((m % 1440) / 60)}h`;
};

function Window({ label, w }: { label: string; w?: QuotaWindow }) {
  return (
    <div>
      <Gauge label={label} pct={w?.pct} text={w ? `${Math.round(w.pct)}%` : "n/a"} danger />
      {w?.resetsAt && <div className="mt-0.5 text-right font-mono text-[10px] text-slate-500">resets in {until(w.resetsAt)}</div>}
    </div>
  );
}

/** Collapsible left rail: every Claude profile with its 5-hour and weekly quota from its usage mirror. */
export function AccountsRail({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? PanelLeftClose : PanelLeftOpen;
  return (
    <aside aria-label="Accounts" className="sticky top-0 z-20 flex h-screen shrink-0 border-r border-slate-800 bg-slate-950">
      <div className="flex w-10 flex-col items-center py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="accounts-panel"
          aria-label={open ? "Hide accounts" : "Show accounts and quotas"}
          title={open ? "Hide accounts" : "Accounts and quotas"}
          className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      </div>
      {open && (
        // phones: overlay beside the rail; sm and up: in the layout, pushing the deck right
        <div id="accounts-panel" className="fixed inset-y-0 left-10 w-64 overflow-y-auto border-r border-slate-800 bg-slate-950 p-3 sm:static sm:border-r-0 sm:pl-0">
          <h2 className="mb-3 font-mono text-[10px] tracking-widest text-slate-500">ACCOUNTS</h2>
          {accounts.length === 0 && <p className="font-mono text-xs text-slate-500">No Claude profiles found.</p>}
          <ul className="flex flex-col gap-3">
            {accounts.map((a) => (
              <li key={a.profile} className="rounded border border-slate-800 bg-slate-900/60 p-2">
                <div className="mb-2 flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-200">{a.profile ? `~/.claude-${a.profile.toLowerCase()}` : "~/.claude"}</span>
                  <span className="text-[10px] text-slate-500">{SQUAWK[a.tier]}</span>
                </div>
                <div className="flex flex-col gap-2">
                  <Window label="5-HOUR" w={a.fiveHour} />
                  <Window label="WEEKLY" w={a.weekly} />
                </div>
                <div className="mt-2 font-mono text-[10px] text-slate-500">{a.updatedAt ? `read ${ago(a.updatedAt)}` : "no usage mirror (TRACON_QUOTA)"}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
