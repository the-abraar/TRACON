import assert from "node:assert/strict";
import { test } from "node:test";
import type { Account, FlightPacket, TraceNode } from "../../avalokita-engine/src/types.ts";
import { ALERT_COOLDOWN_MS, newlyHolding } from "../src/components/alerts/holding.ts";
import { COL_W, MIN_GROUP, ROW_H, duration, layoutTrace } from "../src/components/radar/layout.ts";
import { gap, sortAccounts } from "../src/components/fleet/sortAccounts.ts";

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

test("layoutTrace: runs of same-action calls fold into one group node that keeps their edges", () => {
  const tool = (id: string, label: string, action: TraceNode["action"], parent: string, end?: number): TraceNode => ({
    id, kind: "tool", label, turn: "turn-1", parent, start: Number(id.slice(1)), ...(end === undefined ? {} : { end }), action, detail: `/f/${id}`,
  });
  const trace: TraceNode[] = [
    { id: "turn-1", kind: "turn", label: "Turn 1", turn: "turn-1", start: 0 },
    tool("t1", "Read", "read", "turn-1", 2),
    tool("t2", "Read", "read", "turn-1", 3), // two reads: below MIN_GROUP, left alone
    tool("t3", "Edit", "write", "t2", 9),
    tool("t4", "Edit", "write", "t3", 8), // parallel with t5
    tool("t5", "Write", "write", "t3", 7),
    tool("t6", "Bash", "bash", "t5"),
    { id: "sub-x", kind: "subagent", label: "Explore", turn: "turn-1", parent: "t4", start: 5 },
  ];
  assert.equal(MIN_GROUP, 3);
  const { nodes, edges } = layoutTrace(trace);
  assert.deepEqual(nodes.map((n) => [n.id, n.position.y / ROW_H]), [["turn-1", 0], ["t1", 1], ["t2", 2], ["group-t3", 3], ["t6", 4], ["sub-x", 5]]);
  const g = nodes.find((n) => n.id === "group-t3")!.data;
  assert.deepEqual(g.node, { id: "group-t3", kind: "tool", label: "Edit, Write ×3", turn: "turn-1", parent: "t2", start: 3, end: 9, action: "write", detail: "3 files" });
  assert.deepEqual(g.members!.map((m) => m.id), ["t3", "t4", "t5"]);
  assert.deepEqual(edges.map((e) => `${e.source}->${e.target}`), ["turn-1->t1", "turn-1->t2", "t2->group-t3", "group-t3->t6", "group-t3->sub-x"]);
  assert.equal(layoutTrace([...trace.slice(0, 5), tool("t5", "Write", "write", "t3")]).nodes.at(-1)!.data.node.end, undefined, "a running member keeps the group running");
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
  const { questionAnswer, permissionTarget, permissionBody, permissionDiff } = await import("../src/components/decisions/answer.ts");
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
  const perm = { ...d, kind: "permission" as const };
  assert.equal(permissionBody({ ...perm, tool: "Write", input: { file_path: "/a", content: "hi\nthere" } }), "hi\nthere");
  assert.equal(permissionBody({ ...perm, tool: "Edit", input: { file_path: "/a", old_string: "a", new_string: "c" } }), undefined);
  const diff = (old_string: string, new_string: string) =>
    permissionDiff({ ...perm, tool: "Edit", input: { file_path: "/a", old_string, new_string } })?.map((l) => l.op + l.text);
  assert.deepEqual(diff("a\nb", "c"), ["-a", "-b", "+c"]);
  assert.deepEqual(diff("x\nold\ny\nz", "x\nnew\nmore\ny\nz"), [" x", "-old", "+new", "+more", " y", " z"], "shared lines are context");
  assert.deepEqual(diff("a\na", "a\na\na"), [" a", " a", "+a"], "head and tail never overlap");
  assert.equal(permissionDiff({ ...perm, tool: "Write", input: { file_path: "/a", content: "x" } }), undefined);
  const multi = (edits: unknown) => permissionDiff({ ...perm, tool: "MultiEdit", input: { file_path: "/a", edits } })?.map((l) => l.op + l.text);
  assert.deepEqual(multi([{ old_string: "a", new_string: "b" }, { old_string: "x\ny", new_string: "x\nz" }]), ["@@ edit 1 of 2", "-a", "+b", "@@ edit 2 of 2", " x", "-y", "+z"]);
  assert.equal(multi([{ old_string: "a" }]), undefined, "a malformed edit shows no diff");
  assert.equal(multi("nope"), undefined);
  assert.equal(permissionTarget({ ...perm, tool: "mcp__gh__create_issue", input: { path: "o/r", body: "b" } }), '{\n  "path": "o/r",\n  "body": "b"\n}', "MCP input shown whole");
  assert.equal(permissionBody({ ...perm, tool: "Bash", input: { command: "ls" } }), undefined);
  assert.equal(permissionTarget({ ...d, kind: "permission", tool: "X", input: { a: 1 } }), '{\n  "a": 1\n}');
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

test("sortAccounts: best or worst first, accounts without the data last", () => {
  const acc = (profile: string, five?: number, resetsAt?: string, tokens = 0): Account => ({
    profile, tier: "pro_20", tokens, ...(five === undefined ? {} : { fiveHour: { pct: five, resetsAt } }),
  });
  const list = [acc("A", 80, "2026-01-01T05:00:00Z", 10), acc("B"), acc("C", 20, "2026-01-01T01:00:00Z", 30), acc("D", 50, undefined, 20)];
  const names = (key: Parameters<typeof sortAccounts>[1], worst: boolean) => sortAccounts(list, key, worst).map((a) => a.profile).join("");
  assert.equal(names("fiveLeft", false), "CDAB", "most 5-hour quota left first");
  assert.equal(names("fiveLeft", true), "ADCB");
  assert.equal(names("fiveReset", false), "CABD", "soonest reset first; no reset time last");
  assert.equal(names("tokens", true), "CDAB", "most tokens first");
  assert.equal(names("profile", false), "ABCD");
  assert.equal(names("profile", true), "DCBA");
  assert.equal(gap("fiveReset", list[2], list[0]), 4 * 3600_000);
  assert.equal(gap("fiveLeft", list[0], list[2]), 60);
  assert.equal(gap("fiveLeft", list[0], list[1]), undefined, "no data, no gap");
  assert.equal(gap("profile", list[0], list[2]), undefined);
});

test("api: a 401 clears the stored token and reloads into the pair form", async () => {
  const store = new Map([["tracon.token", "a".repeat(64)]]);
  let reloaded = 0;
  const stub = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
    document: { querySelector: () => null },
    location: { reload: () => reloaded++ },
    fetch: async () => new Response("{}", { status: 401 }),
  };
  for (const [k, value] of Object.entries(stub)) Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  const { api, token } = await import("../src/lib/remote.ts");
  assert.equal((await api("/api/flights")).status, 401);
  assert.equal(token(), undefined);
  assert.equal(reloaded, 1);
});
