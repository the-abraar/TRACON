import type { FlightPacket, FlightState } from "../../../../avalokita-engine/src/types.ts";

/** A flight that flaps (the 60 s holding heuristic) is announced at most this often. */
export const ALERT_COOLDOWN_MS = 2 * 60_000;

/** Flights that entered holding since the previous snapshot and were not announced within the cooldown. */
export function newlyHolding(prev: Map<string, FlightState>, flights: FlightPacket[], lastAlert: Map<string, number>, now: number): FlightPacket[] {
  return flights.filter(
    (f) => f.flightState === "holding" && prev.get(f.flightCallsign) !== "holding" && now - (lastAlert.get(f.flightCallsign) ?? -Infinity) >= ALERT_COOLDOWN_MS,
  );
}
