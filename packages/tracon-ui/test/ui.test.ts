import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlightPacket, TraceNode } from "../../avalokita-engine/src/types.ts";
import { ALERT_COOLDOWN_MS, newlyHolding } from "../src/components/alerts/holding.ts";
import { COL_W, ROW_H, duration, layoutTrace } from "../src/components/radar/layout.ts";

test("layoutTrace: a column per turn, children stacked, sideways turn edges", () => {
  const trace: TraceNode[] = [
    { id: "turn-1", kind: "turn", label: "Turn 1", turn: "turn-1", start: 0, end: 10 },
    { id: "tool-a", kind: "tool", label: "Read", turn: "turn-1", parent: "turn-1", start: 1, end: 2 },
    { id: "turn-2", kind: "turn", label: "Turn 2", turn: "turn-2", parent: "turn-1", start: 11 },
    { id: "tool-b", kind: "tool", label: "Bash", turn: "turn-2", parent: "turn-2", start: 12 },
    { id: "sub-x", kind: "subagent", label: "Explore", turn: "turn-1", parent: "tool-a", start: 3, end: 9 },
    { id: "tool-c", kind: "tool", label: "Edit", turn: "turn-2", parent: "gone", start: 13 },
  ];
  const { nodes, edges } = layoutTrace(trace);
  assert.deepEqual(
    nodes.map((n) => [n.id, n.position.x, n.position.y]),
    [["turn-1", 0, 0], ["tool-a", 0, ROW_H], ["turn-2", COL_W, 0], ["tool-b", COL_W, ROW_H], ["sub-x", 0, 2 * ROW_H], ["tool-c", COL_W, 2 * ROW_H]],
  );
  assert.deepEqual(
    edges.map((e) => [e.source, e.target, e.sourceHandle, e.targetHandle, e.animated]),
    [
      ["turn-1", "tool-a", "b", "t", false],
      ["turn-1", "turn-2", "r", "l", true],
      ["turn-2", "tool-b", "b", "t", true],
      ["tool-a", "sub-x", "b", "t", false],
    ],
    "edges to unknown parents are dropped",
  );
});

test("duration formats ms, seconds and minutes", () => {
  assert.deepEqual([duration(450), duration(4200), duration(125_000)], ["450ms", "4.2s", "2m05s"]);
});

const flight = (callsign: string, flightState: FlightPacket["flightState"]): FlightPacket => ({
  id: callsign,
  timestamp: "2026-01-01T00:00:00Z",
  flightCallsign: callsign,
  accountTier: "pro_20",
  runtime: "claude-code",
  cwd: "/w",
  flightState,
  subagents: [],
  fuelMetrics: { inputTokens: 0, outputTokens: 0, totalTokens: 0, burnRatePerMin: 0 },
});

test("newlyHolding: alerts on entry into holding, once per cooldown", () => {
  const last = new Map<string, number>();
  const prev = new Map([["A", "tool_executing" as const], ["B", "holding" as const]]);
  const flights = [flight("A", "holding"), flight("B", "holding"), flight("C", "holding"), flight("D", "cruising")];
  assert.deepEqual(newlyHolding(prev, flights, last, 1000).map((f) => f.flightCallsign), ["A", "C"], "B was already holding");
  last.set("A", 1000);
  const flapped = new Map([["A", "tool_executing" as const]]);
  assert.deepEqual(newlyHolding(flapped, [flight("A", "holding")], last, 1000 + ALERT_COOLDOWN_MS - 1), [], "inside the cooldown");
  assert.equal(newlyHolding(flapped, [flight("A", "holding")], last, 1000 + ALERT_COOLDOWN_MS).length, 1);
});

test("questionAnswer: picks and Other text joined like Claude Code's dialog; undefined until every question is answered", async () => {
  const { questionAnswer, permissionTarget } = await import("../src/components/decisions/answer.ts");
  const d = {
    id: "d1",
    callsign: "CL-T",
    kind: "question" as const,
    tool: "AskUserQuestion",
    cwd: "/w",
    createdAt: 0,
    input: {
      questions: [
        { question: "Color", options: [{ label: "Red" }, { label: "Blue" }] },
        { question: "Toppings", multiSelect: true, options: [{ label: "Cheese" }, { label: "Olives" }] },
      ],
    },
  };
  assert.equal(questionAnswer(d, { Color: ["Red"] }, {}), undefined);
  assert.deepEqual(questionAnswer(d, { Color: ["Red"], Toppings: ["Cheese", "Olives"] }, { Toppings: " basil " }), {
    id: "d1",
    kind: "question",
    answers: { Color: "Red", Toppings: "Cheese, Olives, basil" },
  });
  assert.deepEqual(questionAnswer(d, { Color: ["Red"], Toppings: [] }, { Color: "teal", Toppings: "none" }), { id: "d1", kind: "question", answers: { Color: "teal", Toppings: "none" } });
  assert.equal(permissionTarget({ ...d, kind: "permission", tool: "Bash", input: { command: "ls -la", description: "List" } }), "ls -la");
  assert.equal(permissionTarget({ ...d, kind: "permission", tool: "X", input: { a: 1 } }), '{\n "a": 1\n}');
});

test("savePairToken: takes the token from a pasted pair link or bare token, rejects anything else", async () => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { setItem: (k: string, v: string) => store.set(k, v), getItem: (k: string) => store.get(k) ?? null } });
  const { savePairToken, token } = await import("../src/lib/remote.ts");
  const t = "ab".repeat(32);
  assert.equal(savePairToken(` https://mac.tail0.ts.net/#pair=${t}\n`), true);
  assert.equal(token(), t);
  assert.equal(savePairToken("cd".repeat(32)), true);
  assert.equal(token(), "cd".repeat(32));
  for (const bad of ["", "https://mac.tail0.ts.net/", `#pair=${t}x`, "ab".repeat(31), `x${t}`]) assert.equal(savePairToken(bad), false, bad);
  assert.equal(token(), "cd".repeat(32));
});
