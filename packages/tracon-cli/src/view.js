// Plain-text rendering of an airspace snapshot, shared by `tracon status` and the TUI.
export const SQ = { pro_20: "SQ-20", team_100: "SQ-100", api_usage: "SQ-API", gemini: "SQ-AGY" };
export const HEAD = ["SQUAWK", "CALLSIGN", "RUNTIME", "STATE", "CURRENT TOOL", "TOKENS (BURN/MIN)"];
const WIDTHS = [8, 16, 12, 15, 26];
const k = (n) => (n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export const row = (...c) => c.map((v, i) => String(v).padEnd(WIDTHS[i] ?? 0)).join(" ");
export const summary = (flights) => `TRACON ATC | FLIGHTS: ${flights.length} | HOLDING: ${flights.filter((f) => f.flightState === "holding").length}`;
export const flightRow = (f) =>
  row(SQ[f.accountTier], f.flightCallsign, f.runtime, f.flightState.toUpperCase(), f.activeTool?.name ?? "-", `${k(f.fuelMetrics.totalTokens)} (${k(f.fuelMetrics.burnRatePerMin)})`);

/** HOLDING and TCAS lines. Both flights of a collision carry the warning; each pair is printed once. */
export function alertLines(flights) {
  const out = flights.filter((f) => f.flightState === "holding").map((f) => `HOLDING: ${f.flightCallsign} in ${f.cwd} is waiting on you.`);
  const pairs = new Set();
  for (const f of flights.filter((f) => f.collisionWarning)) {
    const { conflictingFlight: other, sharedFile } = f.collisionWarning;
    const key = [f.flightCallsign, other].sort().join(" ") + " " + sharedFile;
    if (!pairs.has(key)) out.push(`TCAS: ${f.flightCallsign} and ${other} both wrote ${sharedFile} in the last 5 min.`);
    pairs.add(key);
  }
  return out;
}

/** One line per decision a hook is holding for an answer from a paired device. */
export function heldLines(decisions = [], now = Date.now()) {
  return decisions.map((d) => {
    const what = d.kind === "question" ? d.input.questions?.[0]?.question : d.kind === "plan" ? "plan approval" : `${d.tool} ${d.input.command ?? d.input.file_path ?? ""}`.trim();
    return `HELD: ${d.callsign} ${d.kind}: ${String(what ?? "").slice(0, 80)} (${Math.round((now - d.createdAt) / 60_000)}m)`;
  });
}

/** One line per trace node: turns flush left, their tools and subagents indented. */
export function traceLine(n) {
  const secs = n.end ? `${((n.end - n.start) / 1000).toFixed(1)}s` : "running";
  return `${n.kind === "turn" ? "" : "  "}${n.label}  ${secs}${n.tokens ? `  ${k(n.tokens)} tok` : ""}`;
}
