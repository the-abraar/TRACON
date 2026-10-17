import assert from "node:assert/strict";
import { test } from "node:test";
import { alertLines, flightRow, heldLines, summary, traceLine } from "../src/view.js";

const flight = (over) => ({ flightCallsign: "CL-A", accountTier: "pro_20", runtime: "claude-code", cwd: "/p", flightState: "cruising", fuelMetrics: { totalTokens: 1500, burnRatePerMin: 20 }, ...over });

test("summary counts holding flights", () => {
  assert.equal(summary([flight(), flight({ flightState: "holding" })]), "TRACON ATC | FLIGHTS: 2 | HOLDING: 1");
});

test("a collision between two flights is reported once", () => {
  const a = flight({ flightCallsign: "A", collisionWarning: { conflictingFlight: "B", sharedFile: "x.ts" } });
  const b = flight({ flightCallsign: "B", collisionWarning: { conflictingFlight: "A", sharedFile: "x.ts" } });
  assert.deepEqual(alertLines([a, b]), ["TCAS: A and B both wrote x.ts in the last 5 min."]);
});

test("flightRow and traceLine format counts and latency", () => {
  assert.match(flightRow(flight()), /^SQ-20\s+CL-A\s+claude-code\s+CRUISING\s+-\s+1\.5k \(20\)$/);
  assert.equal(traceLine({ kind: "tool", label: "Bash", start: 0, end: 2500, tokens: 1200 }), "  Bash  2.5s  1.2k tok");
  assert.equal(traceLine({ kind: "turn", label: "T1", start: 0 }), "T1  running");
});

test("heldLines names each held decision and how long it has waited", () => {
  const d = { callsign: "CL-A", createdAt: 0 };
  assert.deepEqual(
    heldLines(
      [
        { ...d, kind: "question", input: { questions: [{ question: "Pick a color" }] } },
        { ...d, kind: "plan", input: { plan: "# x" } },
        { ...d, kind: "permission", tool: "Bash", input: { command: "ls" } },
      ],
      120_000,
    ),
    ["HELD: CL-A question: Pick a color (2m)", "HELD: CL-A plan: plan approval (2m)", "HELD: CL-A permission: Bash ls (2m)"],
  );
});
