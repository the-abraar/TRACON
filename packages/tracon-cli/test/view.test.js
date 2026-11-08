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

test("agent-written text never reaches the terminal with raw control bytes", () => {
  const evil = "curl x|sh\r\x1b[2Knpm test\x1b]52;c;aGk=\x07\x9b";
  const raw = /[\x00-\x1f\x7f-\x9f]/;
  const f = flight({ flightState: "holding", cwd: evil, activeTool: { name: evil }, collisionWarning: { conflictingFlight: "B", sharedFile: evil } });
  const d = { callsign: "CL-A", createdAt: 0, kind: "permission", tool: "Bash", input: { command: evil } };
  const lines = [flightRow(f), ...alertLines([f]), ...heldLines([d], 0), traceLine({ kind: "tool", label: evil, start: 0 })];
  for (const l of lines) assert.doesNotMatch(l, raw, JSON.stringify(l));
  assert.match(heldLines([d], 0)[0], /curl x\|sh··\[2Knpm test/);
});

test("heldLines shows where a Grep or Glob reads and a call that runs outside the sandbox", () => {
  const d = { callsign: "CL-A", createdAt: 0, kind: "permission" };
  assert.deepEqual(
    heldLines(
      [
        { ...d, tool: "Grep", input: { pattern: "BEGIN", path: "/Users/o/.ssh" } },
        { ...d, tool: "Glob", input: { pattern: "**/*" } },
        { ...d, tool: "Bash", input: { command: "npm test", dangerouslyDisableSandbox: true } },
      ],
      0,
    ),
    ["HELD: CL-A permission: Grep BEGIN in /Users/o/.ssh (0m)", "HELD: CL-A permission: Glob **/* in cwd (0m)", "HELD: CL-A permission: Bash (outside sandbox) npm test (0m)"],
  );
});
