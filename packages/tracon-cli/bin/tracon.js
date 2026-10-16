#!/usr/bin/env node
// tracon start [--no-open] | tracon status   (needs Node >= 23.6: the engine is TypeScript run by Node's type stripping)
import { spawn } from "node:child_process";

const [cmd = "start", ...flags] = process.argv.slice(2);
const port = Number(process.env.TRACON_PORT ?? 4040);

if (cmd === "start") {
  const { startEngine } = await import("../../avalokita-engine/src/server.ts");
  const { url } = await startEngine({ port });
  console.log(`Avalokita Engine watching the airspace. Flight Deck: ${url}  (ws: ${url.replace("http", "ws")}/ws)`);
  if (!flags.includes("--no-open") && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
} else if (cmd === "status") {
  let flights;
  try {
    ({ flights } = await (await fetch(`http://127.0.0.1:${port}/api/flights`)).json());
  } catch {
    console.error(`No engine on :${port}. Run: tracon start`);
    process.exit(1);
  }
  const SQ = { pro_20: "SQ-20", team_100: "SQ-100", api_usage: "SQ-API", gemini: "SQ-AGY" };
  const k = (n) => (n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  const row = (...c) => console.log(c.map((v, i) => String(v).padEnd([8, 16, 12, 15, 26][i] ?? 0)).join(" "));
  const holding = flights.filter((f) => f.flightState === "holding");
  console.log(`TRACON ATC | FLIGHTS: ${flights.length} | HOLDING: ${holding.length}`);
  row("SQUAWK", "CALLSIGN", "RUNTIME", "STATE", "CURRENT TOOL", "TOKENS (BURN/MIN)");
  for (const f of flights)
    row(SQ[f.accountTier], f.flightCallsign, f.runtime, f.flightState.toUpperCase(), f.activeTool?.name ?? "-", `${k(f.fuelMetrics.totalTokens)} (${k(f.fuelMetrics.burnRatePerMin)})`);
  for (const f of holding) console.log(`HOLDING: ${f.flightCallsign} in ${f.cwd} is waiting on you.`);
  const pairs = new Set(); // both flights carry the warning; print each pair once
  for (const f of flights.filter((f) => f.collisionWarning)) {
    const { conflictingFlight: other, sharedFile } = f.collisionWarning;
    const key = [f.flightCallsign, other].sort().join(" ") + " " + sharedFile;
    if (!pairs.has(key)) console.log(`TCAS: ${f.flightCallsign} and ${other} both wrote ${sharedFile} in the last 5 min.`);
    pairs.add(key);
  }
} else {
  console.error("usage: tracon start [--no-open] | tracon status");
  process.exit(2);
}
