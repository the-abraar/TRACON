import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Airspace, parseTiers } from "../src/airspace.ts";
import { COLLISION_WINDOW_MS, findCollisions } from "../src/collision.ts";
import { parseQuotaFiles, readQuota } from "../src/quota.ts";
import { Flight, HOLD_AFTER_MS, MAX_TOOLS_PER_TURN, MAX_TURNS, toolAction } from "../src/normalizer.ts";
import { parseAgyLine } from "../src/parsers/agy.ts";
import { parseClaudeLine } from "../src/parsers/claude.ts";
import { claudeProfiles } from "../src/scanners/claude.ts";
import { startEngine } from "../src/server.ts";
import { Tailer } from "../src/tailers/tailer.ts";
import type { ParsedEvent } from "../src/types.ts";
import { WebSocket } from "ws";

const FIX = join(import.meta.dirname, "fixtures");
const lines = (p: string) => readFileSync(join(FIX, p), "utf8").split("\n").filter(Boolean);
const T0 = Date.parse("2026-01-01T00:00:00Z");
const tmp = mkdtempSync(join(tmpdir(), "tracon-test-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const fold = (evs: (ParsedEvent | null)[], meta = { callsign: "CL-T", runtime: "claude-code" as const, tier: "pro_20" as const }) => {
  const f = new Flight(meta);
  for (const e of evs) if (e) f.apply(e);
  return f;
};

test("claude parser: keeps flight signals, drops meta, sidechain and junk lines", () => {
  const kinds = lines("claude/session.jsonl").map((l) => parseClaudeLine(l)?.kind ?? null);
  assert.deepEqual(kinds, [null, null, "prompt", "thinking", "tool_use", "tool_result", null, null, "tool_use", "tool_result", "turn_end", "turn_end"]);
  const sub = lines("claude/subagent.jsonl").map((l) => parseClaudeLine(l, true)?.kind);
  assert.deepEqual(sub, ["prompt", "tool_use"]);
  const use = parseClaudeLine(lines("claude/session.jsonl")[4]!);
  assert.equal(use?.kind, "tool_use");
  if (use?.kind === "tool_use") {
    assert.deepEqual(use.usage, { key: "msg_1", input: 150, output: 40 }); // cache reads excluded
    assert.equal(use.tools[0]!.name, "Read");
    assert.equal(use.cwd, "/work/demo");
  }
});

test("agy parser: maps steps and treats RUNNING as still executing", () => {
  const evs = lines("agy/transcript.jsonl").map(parseAgyLine);
  assert.deepEqual(evs.map((e) => e?.kind ?? null), ["prompt", null, "tool_use", "tool_result", "tool_use", null]);
  assert.equal(evs[2]?.cwd, "/work/agy-demo");
  assert.equal(parseAgyLine('{"type":"PLANNER_RESPONSE","status":"WAITING_FOR_USER","created_at":"2026-01-01T00:00:00Z"}')?.kind, "holding");
  assert.equal(parseAgyLine('{"type":"PLANNER_RESPONSE","status":"DONE","created_at":"2026-01-01T00:00:00Z","output_tokens":1}')?.kind, "turn_end");
});

test("normalizer: full claude session lands with de-duplicated fuel", () => {
  const f = fold(lines("claude/session.jsonl").map((l) => parseClaudeLine(l)));
  const p = f.packet(T0 + 12_000);
  assert.equal(p.flightState, "landed");
  assert.equal(p.cwd, "/work/demo");
  assert.equal(p.timestamp, "2026-01-01T00:00:11.000Z");
  // msg_1 appears twice (150/20 then 150/40): counted once at its largest; sidechain 999s ignored
  assert.deepEqual(p.fuelMetrics, { inputTokens: 150 + 10 + 5, outputTokens: 40 + 30 + 10, totalTokens: 245, burnRatePerMin: 49 });
  assert.equal(p.activeTool, undefined);
  assert.equal(f.packet(T0 + 10 * 60_000).fuelMetrics.burnRatePerMin, 0);
});

test("normalizer: state machine through a turn", () => {
  const all = lines("claude/session.jsonl").map((l) => parseClaudeLine(l));
  assert.equal(fold(all.slice(0, 3)).state(T0), "preflight");
  assert.equal(fold(all.slice(0, 4)).state(T0), "cruising");
  const bash = fold(all.slice(0, 9));
  const p = bash.packet(T0 + 6_000);
  assert.equal(p.flightState, "tool_executing");
  assert.deepEqual(p.activeTool, { name: "Bash", action: "bash", targetFile: undefined, details: "npm test TOKEN=***" });
  assert.equal(bash.state(T0 + 5_000 + HOLD_AFTER_MS + 1), "holding");
  assert.equal(fold(all.slice(0, 10)).state(T0), "cruising");
  const ask = fold([{ kind: "tool_use", ts: T0, tools: [{ id: "q", name: "AskUserQuestion", input: {} }] }]);
  assert.equal(ask.state(T0), "holding");
});

test("normalizer: live process info overrides the transcript", () => {
  const done = fold(lines("claude/session.jsonl").map((l) => parseClaudeLine(l)));
  assert.equal(done.state(T0, { pid: 1, alive: false }), "aborted");
  assert.equal(done.state(T0, { pid: 1, alive: true, status: "busy" }), "cruising");
  assert.equal(done.state(T0, { pid: 1, alive: true, status: "waiting_for_permission" }), "holding");
  assert.equal(done.packet(T0, { pid: 42, alive: true, status: "idle" }).pid, 42);
});

test("trace: turn and tool nodes with latency, tokens and batch edges", () => {
  const f = fold(lines("claude/session.jsonl").map((l) => parseClaudeLine(l)));
  assert.deepEqual(f.trace(), [
    { id: "turn-1", kind: "turn", label: "Turn 1", turn: "turn-1", start: T0 + 1000, end: T0 + 10_000, tokens: 245 },
    { id: "tool-toolu_read", kind: "tool", label: "Read", turn: "turn-1", parent: "turn-1", start: T0 + 3000, end: T0 + 4000, action: "read", detail: "/work/demo/README.md" },
    { id: "tool-toolu_bash", kind: "tool", label: "Bash", turn: "turn-1", parent: "tool-toolu_read", start: T0 + 5000, end: T0 + 9000, action: "bash", detail: "npm test TOKEN=***" },
  ]);
  // parallel calls in one message fan out from the same parent; work after a finished turn opens a new turn
  const g = fold([
    { kind: "prompt", ts: T0 },
    { kind: "tool_use", ts: T0 + 1, tools: [{ id: "a", name: "Read", input: {} }, { id: "b", name: "Grep", input: {} }] },
    { kind: "tool_result", ts: T0 + 2, toolUseIds: ["a", "b"] },
    { kind: "turn_end", ts: T0 + 3 },
    { kind: "turn_end", ts: T0 + 4 },
    { kind: "tool_use", ts: T0 + 5, tools: [{ id: "c", name: "Bash", input: {} }] },
  ]);
  g.apply({ kind: "turn_end", ts: T0 + 4 }); // stamped before turn-2 started
  const t = g.trace();
  assert.deepEqual(t.map((n) => [n.id, n.parent, n.end]), [
    ["turn-1", undefined, T0 + 3], ["tool-a", "turn-1", T0 + 2], ["tool-b", "turn-1", T0 + 2],
    ["turn-2", "turn-1", T0 + 5], ["tool-c", "turn-2", T0 + 5],
  ]);
});

test("trace stays bounded and re-points edges into trimmed nodes", () => {
  const evs: ParsedEvent[] = [];
  for (let i = 0; i < MAX_TURNS + 5; i++) evs.push({ kind: "prompt", ts: T0 + i * 1000 });
  for (let i = 0; i < MAX_TOOLS_PER_TURN + 5; i++) evs.push({ kind: "tool_use", ts: T0 + 99_000 + i, tools: [{ id: `x${i}`, name: i === 1 ? "Agent" : "Read", input: {} }] });
  const t = fold(evs).trace();
  const turns = t.filter((n) => n.kind === "turn");
  assert.equal(turns.length, MAX_TURNS);
  assert.equal(turns[0]!.parent, undefined);
  assert.equal(turns.at(-1)!.label, `Turn ${MAX_TURNS + 5}`);
  const tools = t.filter((n) => n.kind === "tool");
  assert.equal(tools.length, MAX_TOOLS_PER_TURN + 1, "the Agent call survives the trim");
  assert.deepEqual([tools[0]!.label, tools[0]!.parent], ["Agent", turns.at(-1)!.id]);
  assert.equal(tools[1]!.parent, turns.at(-1)!.id);
  assert.equal(tools[2]!.parent, tools[1]!.id);
});

test("normalizer: a subagent that hands back its report lands, and its turn gets an end", () => {
  const sub = fold([
    { kind: "tool_use", ts: T0, tools: [{ id: "r", name: "Read", input: { file_path: "/w/a.ts" } }] },
    { kind: "tool_result", ts: T0 + 1_000, toolUseIds: ["r"] },
    { kind: "tool_use", ts: T0 + 2_000, tools: [{ id: "h", name: "SubagentHandback", input: {} }] },
  ]);
  assert.equal(sub.state(T0 + 2_500), "tool_executing");
  sub.apply({ kind: "tool_result", ts: T0 + 3_000, toolUseIds: ["h"] });
  assert.equal(sub.state(T0 + 3_000 + 10 * HOLD_AFTER_MS), "landed", "no lines follow a handback; it must not read as cruising forever");
  assert.equal(sub.trace().find((n) => n.kind === "turn")!.end, T0 + 3_000);
});

test("TCAS: two flights writing one file within the window collide; old writes and a flight's own writes do not", () => {
  const now = T0 + 60 * 60_000;
  const w = (callsign: string, file: string, ago: number) => ({ callsign, file, ts: now - ago });
  const hits = findCollisions([
    w("CL-A", "/repo/a.ts", 60_000), w("CL-B", "/repo/a.ts", 30_000), // collide
    w("CL-A", "/repo/b.ts", 10_000), w("CL-A", "/repo/b.ts", 5_000), // same flight twice: not a collision
    w("CL-C", "/repo/c.ts", 1_000), w("CL-D", "/repo/c.ts", COLLISION_WINDOW_MS + 1), // CL-D's write is too old
  ], now);
  assert.deepEqual(Object.fromEntries(hits), {
    "CL-A": { conflictingFlight: "CL-B", sharedFile: "/repo/a.ts" },
    "CL-B": { conflictingFlight: "CL-A", sharedFile: "/repo/a.ts" },
  });
  const latest = findCollisions([w("CL-A", "/x", 200_000), w("CL-B", "/x", 190_000), w("CL-A", "/y", 2_000), w("CL-B", "/y", 1_000)], now);
  assert.equal(latest.get("CL-A")!.sharedFile, "/y", "reports the most recent shared file");
});

test("Flight.writes lists recent write targets, resolving relative paths against the cwd", () => {
  const f = fold([
    { kind: "tool_use", ts: T0, cwd: "/repo", tools: [{ id: "1", name: "Edit", input: { file_path: "src/a.ts" } }] },
    { kind: "tool_use", ts: T0 + 1_000, tools: [{ id: "2", name: "Read", input: { file_path: "/repo/b.ts" } }] },
    { kind: "tool_use", ts: T0 + 2_000, tools: [{ id: "3", name: "Write", input: { file_path: "/repo/c.ts" } }] },
  ]);
  assert.deepEqual(f.writes(T0), [{ file: "/repo/src/a.ts", ts: T0 }, { file: "/repo/c.ts", ts: T0 + 2_000 }]);
  assert.deepEqual(f.writes(T0 + 1_500), [{ file: "/repo/c.ts", ts: T0 + 2_000 }]);
});

test("toolAction classifies both runtimes' tool names", () => {
  const m = Object.fromEntries(["Read", "Grep", "view_file", "Write", "Edit", "replace_file_content", "Bash", "run_command", "Agent", "Task", "invoke_subagent", "manage_task", "TodoWrite", "SubagentHandback"].map((n) => [n, toolAction(n)]));
  assert.deepEqual(m, {
    Read: "read", Grep: "read", view_file: "read", Write: "write", Edit: "write", replace_file_content: "write",
    Bash: "bash", run_command: "bash", Agent: "subagent", Task: "subagent", invoke_subagent: "subagent", manage_task: "other", TodoWrite: "write", SubagentHandback: "other",
  });
});

test("tailer returns only whole new lines", () => {
  const f = join(tmp, "tail.jsonl");
  writeFileSync(f, '{"a":1}\n{"b":');
  const t = new Tailer();
  assert.deepEqual(t.read(f), ['{"a":1}']);
  assert.deepEqual(t.read(f), []);
  appendFileSync(f, '"é"}\n{"c":3}\n');
  assert.deepEqual(t.read(f), ['{"b":"é"}', '{"c":3}']);
  writeFileSync(f, '{"z":0}\n'); // truncated
  assert.deepEqual(t.read(f), ['{"z":0}']);
});

function fakeHome(): string {
  const home = mkdtempSync(join(tmp, "home-"));
  const proj = join(home, ".claude-biz", "projects", "-work-demo");
  const sid = "0000aaaa-1111-2222-3333-444455556666";
  mkdirSync(join(proj, sid, "subagents"), { recursive: true });
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  mkdirSync(join(home, ".claude-empty"), { recursive: true }); // no projects/: not a profile
  writeFileSync(join(proj, `${sid}.jsonl`), lines("claude/session.jsonl").slice(0, 9).join("\n") + "\n");
  copyFileSync(join(FIX, "claude/subagent.jsonl"), join(proj, sid, "subagents", "agent-x1.jsonl"));
  copyFileSync(join(FIX, "claude/subagent.meta.json"), join(proj, sid, "subagents", "agent-x1.meta.json"));
  const conv = join(home, ".gemini", "antigravity-cli", "brain", "abcd1234-conv", ".system_generated");
  mkdirSync(join(conv, "logs"), { recursive: true });
  mkdirSync(join(conv, "tasks"), { recursive: true });
  copyFileSync(join(FIX, "agy/transcript.jsonl"), join(conv, "logs", "transcript.jsonl"));
  writeFileSync(join(conv, "tasks", "task-7.log"), "running\n");
  return home;
}

test("scanner finds ~/.claude and ~/.claude-* profiles that have projects/", () => {
  const home = fakeHome();
  assert.deepEqual(claudeProfiles(home, {}).map((p) => p.name).sort(), ["", "BIZ"]);
  assert.deepEqual(parseTiers("biz=team_100, =api_usage,bad=nope"), new Map([["BIZ", "team_100"], ["", "api_usage"]]));
});

test("airspace: discovers, tails and normalizes both runtimes end to end", () => {
  const home = fakeHome();
  const air = new Airspace({ home, windowMs: Number.MAX_SAFE_INTEGER, tiers: "BIZ=team_100", env: {} });
  const now = T0 + 6_000;
  const flights = air.tick(now);
  assert.equal(flights.length, 2);
  const [agy, cl] = flights.sort((a, b) => a.flightCallsign.localeCompare(b.flightCallsign));
  assert.equal(cl!.flightCallsign, "CL-BIZ-0000");
  assert.equal(cl!.accountTier, "team_100");
  assert.equal(cl!.flightState, "tool_executing");
  assert.deepEqual(cl!.subagents, [{ id: "agent-x1", role: "Explore", state: "tool_executing" }]);
  assert.equal(agy!.flightCallsign, "AGY-ABCD");
  assert.equal(agy!.runtime, "antigravity");
  assert.equal(agy!.flightState, "tool_executing");
  assert.equal(agy!.activeTool?.targetFile, "/work/agy-demo/notes.md");
  assert.deepEqual(agy!.subagents, [{ id: "task-7", role: "task", state: "running" }]);

  const trace = air.trace("CL-BIZ-0000", now)!;
  assert.deepEqual(trace.at(-1), { id: "sub-agent-x1", kind: "subagent", label: "Explore", turn: "turn-1", parent: "turn-1", start: T0 + 6000, tokens: 10 });
  assert.equal(air.trace("CL-NOPE", now), undefined);

  const same = air.tick(now).find((p) => p.flightCallsign === cl!.flightCallsign);
  assert.equal(same!.id, cl!.id, "unchanged flight keeps its packet id");

  appendFileSync(join(home, ".claude-biz/projects/-work-demo/0000aaaa-1111-2222-3333-444455556666.jsonl"), lines("claude/session.jsonl").slice(9).join("\n") + "\n");
  const landed = air.tick(now).find((p) => p.flightCallsign === "CL-BIZ-0000")!;
  assert.equal(landed.flightState, "landed");
  assert.notEqual(landed.id, cl!.id);
});

test("airspace TCAS: sessions writing the same file collide; a session and its own subagent do not", () => {
  const home = mkdtempSync(join(tmp, "tcas-"));
  const proj = join(home, ".claude", "projects", "-repo");
  const edit = (ts: number, id: string, file: string, side = false) =>
    JSON.stringify({ type: "assistant", isSidechain: side, timestamp: new Date(ts).toISOString(), cwd: "/repo", message: { id, content: [{ type: "tool_use", id, name: "Edit", input: { file_path: file } }] } }) + "\n";
  const a = "aaaa0000-0000-0000-0000-000000000000", b = "bbbb0000-0000-0000-0000-000000000000";
  mkdirSync(join(proj, a, "subagents"), { recursive: true });
  writeFileSync(join(proj, `${a}.jsonl`), edit(T0, "a1", "/repo/own.ts"));
  writeFileSync(join(proj, a, "subagents", "agent-s1.jsonl"), edit(T0 + 1_000, "s1", "/repo/own.ts", true) + edit(T0 + 2_000, "s2", "/repo/shared.ts", true));
  writeFileSync(join(proj, `${b}.jsonl`), edit(T0 + 3_000, "b1", "/repo/shared.ts"));
  const air = new Airspace({ home, windowMs: Number.MAX_SAFE_INTEGER, env: {} });
  const byCs = Object.fromEntries(air.tick(T0 + 10_000).map((p) => [p.flightCallsign, p.collisionWarning]));
  assert.deepEqual(byCs, {
    "CL-AAAA": { conflictingFlight: "CL-BBBB", sharedFile: "/repo/shared.ts" }, // via its subagent; own.ts is not a collision
    "CL-BBBB": { conflictingFlight: "CL-AAAA", sharedFile: "/repo/shared.ts" },
  });
  assert.deepEqual(air.tick(T0 + 3_000 + COLLISION_WINDOW_MS + 1).map((p) => p.collisionWarning), [undefined, undefined], "clears after the window");
});

test("quota: reads the 5-hour percentage from a usage mirror until its window resets", () => {
  assert.deepEqual(parseQuotaFiles("hat=/u/a.md, =/u/b.md,bad"), new Map([["HAT", "/u/a.md"], ["", "/u/b.md"]]));
  const file = join(tmp, "usage.md");
  const at = Date.parse("2026-10-15T18:28:03+06:00");
  writeFileSync(file, `# Claude usage (mirror)\n\n**5-hour window: 37% used.** Resets 2026-10-15 21:40 +06 (in 3h11m).\n**7-day window: 12% used.** Resets 2026-10-22 08:00 +06 (in 157h31m).\n\nUpdated: 2026-10-15 18:28:03 +06 (epoch ${at / 1000})\n`);
  assert.equal(readQuota(file, at + 60_000), 37);
  assert.equal(readQuota(file, Date.parse("2026-10-15T21:40:00+06:00")), undefined, "window reset: stale");
  assert.equal(readQuota(join(tmp, "missing.md"), at), undefined);
  writeFileSync(file, `**5-hour window: 5% used.** Resets n/a.\nUpdated: x (epoch ${at / 1000})\n`);
  assert.equal(readQuota(file, at + 4 * 3600_000), 5, "no reset time: falls back to the reading's age");
  assert.equal(readQuota(file, at + 6 * 3600_000), undefined);

  const home = fakeHome();
  writeFileSync(file, `**5-hour window: 42% used.** Resets 2026-01-01 03:00 +00 (in 3h).\nUpdated: x (epoch ${T0 / 1000})\n`);
  const air = new Airspace({ home, windowMs: Number.MAX_SAFE_INTEGER, quota: `BIZ=${file}`, env: {} });
  const cl = air.tick(T0 + 6_000).find((p) => p.flightCallsign === "CL-BIZ-0000")!;
  assert.equal(cl.fuelMetrics.quotaPercentage, 42);
});

test("airspace drops sessions outside the activity window", () => {
  const air = new Airspace({ home: fakeHome(), windowMs: 60_000, env: {} });
  assert.equal(air.tick(T0 + 6_000).length, 2);
  assert.equal(air.tick(T0 + 10 * 60_000).length, 0);
});

test("server: /api/flights snapshot, live WebSocket push, foreign origins refused", async () => {
  const home = fakeHome();
  const eng = await startEngine({ port: 0, home, windowMs: Number.MAX_SAFE_INTEGER, uiDist: join(tmp, "no-ui"), env: {} });
  try {
    const snap = (await (await fetch(`${eng.url}/api/flights`)).json()) as { flights: unknown[] };
    assert.equal(snap.flights.length, 2);
    assert.equal((await fetch(`${eng.url}/`)).status, 503);
    const tr = (await (await fetch(`${eng.url}/api/trace?flight=CL-BIZ-0000`)).json()) as { nodes: { kind: string }[] };
    assert.deepEqual(tr.nodes.map((n) => n.kind), ["turn", "tool", "tool", "subagent"]);
    assert.equal((await fetch(`${eng.url}/api/trace?flight=nope`)).status, 404);

    const ws = new WebSocket(eng.url.replace("http", "ws") + "/ws");
    const msgs: any[] = [];
    const got = (n: number) =>
      new Promise<void>((ok, fail) => {
        const t = setTimeout(() => fail(new Error(`waited for ${n} messages, got ${msgs.length}`)), 5000);
        const check = () => msgs.length >= n && (clearTimeout(t), ok());
        ws.on("message", (m) => (msgs.push(JSON.parse(String(m))), check()));
        check();
      });
    await got(1);
    assert.equal(msgs[0].flights.length, 2);
    // a new session appears: the watcher/poll pushes a fresh snapshot
    const proj = join(home, ".claude", "projects", "-work-two");
    mkdirSync(proj, { recursive: true });
    writeFileSync(join(proj, "ffff0000-0000-0000-0000-000000000000.jsonl"), lines("claude/session.jsonl").slice(2, 3).join("\n") + "\n");
    await got(2);
    assert.ok(msgs[1].flights.some((p: any) => p.flightCallsign === "CL-FFFF" && p.flightState === "preflight"));
    ws.close();

    const evil = new WebSocket(eng.url.replace("http", "ws") + "/ws", { origin: "https://evil.example" });
    const outcome = await new Promise((ok) => evil.on("open", () => ok("open")).on("error", () => ok("refused")));
    assert.equal(outcome, "refused");
  } finally {
    eng.close();
  }
});
