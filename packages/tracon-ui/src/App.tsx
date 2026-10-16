import { useEffect, useState } from "react";
import type { FlightPacket } from "../../avalokita-engine/src/types.ts";
import { useHoldingAlerts } from "./components/alerts/useHoldingAlerts.ts";
import { FleetBar } from "./components/fleet/FleetBar.tsx";
import { FlightCard } from "./components/fleet/FlightCard.tsx";
import { FlightDag } from "./components/radar/FlightDag.tsx";

/** Live airspace from the engine; each socket message is the full {flights} snapshot. */
function useAirspace() {
  const [flights, setFlights] = useState<FlightPacket[]>([]);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry: number | undefined;
    let stopped = false;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.onopen = () => setOnline(true);
      ws.onmessage = (m) => setFlights(JSON.parse(m.data).flights);
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
  return { flights, online };
}

export default function App() {
  const { flights, online } = useAirspace();
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
      <FleetBar flights={flights} online={online} alerts={alerts} />
      <main className="mx-auto max-w-7xl p-4">
        {tracedFlight && <FlightDag key={tracedFlight.flightCallsign} flight={tracedFlight} onClose={() => setTraced(undefined)} />}
        {flights.length === 0 ? (
          <p className="mt-24 text-center font-mono text-sm text-slate-500">
            {online ? "Airspace clear: no agent session active in the last 30 minutes." : "Connecting to the Avalokita Engine on :4040..."}
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
