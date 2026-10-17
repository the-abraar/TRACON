import { useEffect, useState } from "react";
import type { Snapshot } from "../../avalokita-engine/src/types.ts";
import { useHoldingAlerts } from "./components/alerts/useHoldingAlerts.ts";
import { DecisionInbox } from "./components/decisions/DecisionInbox.tsx";
import { FleetBar } from "./components/fleet/FleetBar.tsx";
import { FlightCard } from "./components/fleet/FlightCard.tsx";
import { FlightDag } from "./components/radar/FlightDag.tsx";
import { isLocal, token, wsUrl } from "./lib/remote.ts";

/** Live airspace from the engine; each socket message is the full snapshot: flights, held decisions, away state. */
function useAirspace() {
  const [snap, setSnap] = useState<Snapshot>({ flights: [], decisions: [], away: { mode: "auto", away: false } });
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
  const { flights, decisions, away, online } = useAirspace();
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
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <FleetBar flights={flights} online={online} alerts={alerts} away={away} />
      <main className="mx-auto max-w-7xl p-4">
        <DecisionInbox decisions={decisions} focus={focus} />
        {tracedFlight && <FlightDag key={tracedFlight.flightCallsign} flight={tracedFlight} onClose={() => setTraced(undefined)} />}
        {flights.length === 0 ? (
          <p className="mt-24 text-center font-mono text-sm text-slate-500">
            {online
              ? "Airspace clear: no agent session active in the last 30 minutes."
              : !isLocal() && !token()
                ? "This device is not paired. Run `tracon pair` on the Mac and open its link here."
                : "Connecting to the Avalokita Engine..."}
          </p>
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
  );
}
