import type { FlightPacket } from "./types.ts";

/** TCAS window: two flights writing the same file within this long of now get a collision warning. */
export const COLLISION_WINDOW_MS = 5 * 60_000;

export interface FileWrite {
  callsign: string;
  file: string;
  ts: number;
}

/**
 * Flags every flight that wrote a file another flight also wrote in the last COLLISION_WINDOW_MS.
 * Callers fold a subagent's writes into its parent's callsign, so a session never collides with its own subagents.
 * When a flight shares several files, the most recently written one is reported.
 */
export function findCollisions(writes: FileWrite[], now: number): Map<string, NonNullable<FlightPacket["collisionWarning"]>> {
  const byFile = new Map<string, Map<string, number>>(); // file -> callsign -> latest write
  for (const w of writes) {
    if (now - w.ts > COLLISION_WINDOW_MS || w.ts > now) continue;
    const flights = byFile.get(w.file) ?? new Map<string, number>();
    flights.set(w.callsign, Math.max(flights.get(w.callsign) ?? 0, w.ts));
    byFile.set(w.file, flights);
  }
  const best = new Map<string, { conflictingFlight: string; sharedFile: string; ts: number }>();
  for (const [file, flights] of byFile) {
    if (flights.size < 2) continue;
    for (const [callsign, ts] of flights) {
      // the other flight that touched this file most recently
      let other = "", otherTs = -1;
      for (const [c, t] of flights) if (c !== callsign && t > otherTs) [other, otherTs] = [c, t];
      const latest = Math.max(ts, otherTs);
      const cur = best.get(callsign);
      if (!cur || latest > cur.ts) best.set(callsign, { conflictingFlight: other, sharedFile: file, ts: latest });
    }
  }
  return new Map([...best].map(([c, { conflictingFlight, sharedFile }]) => [c, { conflictingFlight, sharedFile }]));
}
