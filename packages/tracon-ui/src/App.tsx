import { useEffect, useState } from "react";
import type { Snapshot } from "../../avalokita-engine/src/types.ts";
import { useHoldingAlerts } from "./components/alerts/useHoldingAlerts.ts";
import { DecisionInbox } from "./components/decisions/DecisionInbox.tsx";
import { AccountsRail } from "./components/fleet/AccountsRail.tsx";
import { FleetBar } from "./components/fleet/FleetBar.tsx";
import { FlightCard } from "./components/fleet/FlightCard.tsx";
import { FlightDag } from "./components/radar/FlightDag.tsx";
import { isLocal, savePairToken, token, wsUrl } from "./lib/remote.ts";

/** Pairs this device from a pasted `tracon pair` link: the iOS Home Screen app cannot open the link itself. */
function PairForm() {
  const [bad, setBad] = useState(false);
  return (
    <form
      className="flex flex-col items-center gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (savePairToken(new FormData(e.currentTarget).get("link") as string)) location.reload();
        else setBad(true);
      }}
    >
      <span>This device is not paired. Run `tracon pair` on the Mac and paste its link here.</span>
      <input
        name="link"
        aria-label="Pair link"
        autoComplete="off"
        placeholder="https://…/#pair=…"
        className="w-full max-w-md rounded border border-slate-700 bg-slate-900 px-3 py-2 text-base text-slate-200"
      />
      {bad && <span className="text-amber-300">That doesn't contain a pair token.</span>}
      <button type="submit" className="min-h-10 rounded border border-slate-700 px-4 text-slate-200 hover:border-amber-400">
        PAIR
      </button>
    </form>
  );
}

/** Live airspace from the engine; each socket message is the full snapshot: flights, held decisions, away state. */
function useAirspace() {
  const [snap, setSnap] = useState<Snapshot>({ flights: [], accounts: [], decisions: [], away: { mode: "auto", away: false } });
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      ws = new WebSocket(wsUrl());
      ws.onopen = () => setOnline(true);
      ws.onmessage = (m) => setSnap(JSON.parse(m.data));
      ws.onclose = () => {
        setOnline(false);
        if (!stopped) retry = window.setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);
  return { ...snap, online };
}

/** The decision a push notification was tapped for: #d=<id> on open, or a message from the service worker. */
function useFocusedDecision() {
  const read = () => /^#d=(.+)$/.exec(location.hash)?.[1];
  const [id, setId] = useState(read);
  useEffect(() => {
    const onHash = () => setId(read());
    const onMsg = (e: MessageEvent) => typeof e.data?.decision === "string" && setId(e.data.decision);
    window.addEventListener("hashchange", onHash);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      window.removeEventListener("hashchange", onHash);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, []);
  return id;
}

export default function App() {
  const { flights, accounts, decisions, away, online } = useAirspace();
  const focus = useFocusedDecision();
  const alerts = useHoldingAlerts(flights);
  const [traced, setTraced] = useState<string>();
  const tracedFlight = flights.find((f) => f.flightCallsign === traced);
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000); // keeps "Ns ago" fresh
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-200">
      <AccountsRail accounts={accounts} />
      <div className="min-w-0 flex-1">
        <FleetBar flights={flights} online={online} alerts={alerts} away={away} />
        <main className="mx-auto max-w-7xl p-4">
          <DecisionInbox decisions={decisions} focus={focus} />
          {tracedFlight && <FlightDag key={tracedFlight.flightCallsign} flight={tracedFlight} onClose={() => setTraced(undefined)} />}
          {flights.length === 0 ? (
            <div className="mt-24 text-center font-mono text-sm text-slate-500">
              {online
                ? "Airspace clear: no agent session active in the last 30 minutes."
                : !isLocal() && !token()
                  ? <PairForm />
                  : "Connecting to the Avalokita Engine..."}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {flights.map((f) => (
                <FlightCard
                  key={f.flightCallsign}
                  f={f}
                  maxBurn={Math.max(...flights.map((x) => x.fuelMetrics.burnRatePerMin))}
                  selected={f.flightCallsign === traced}
                  onTrace={() => setTraced(f.flightCallsign === traced ? undefined : f.flightCallsign)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
