import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { AccountTier, FlightPacket, FlightState, ParsedEvent, ToolAction, ToolCall, TraceNode } from "./types.ts";

export const HOLD_AFTER_MS = 60_000;
const BURN_WINDOW_MS = 5 * 60_000;
// The DAG keeps only the latest turns and tools so memory stays flat on long sessions.
export const MAX_TURNS = 40;
export const MAX_TOOLS_PER_TURN = 100;
// Tools that always block on the human.
const HOLD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
// A Claude subagent ends by handing its report back; its transcript has no turn_end after that call's result.
const END_TOOLS = new Set(["SubagentHandback"]);

export interface FlightMeta {
  callsign: string;
  runtime: FlightPacket["runtime"];
  tier: AccountTier;
}

/** Live process info, when the runtime publishes it (Claude Code's sessions/<pid>.json). */
export interface LiveInfo {
  pid?: number;
  alive?: boolean;
  status?: string;
}

export function toolAction(name: string): ToolAction {
  if (END_TOOLS.has(name)) return "other"; // names "subagent" but spawns nothing
  if (/^(task|agent)$|subagent/i.test(name)) return "subagent";
  if (/bash|command|shell/i.test(name)) return "bash";
  if (/write|edit|replace/i.test(name)) return "write";
  if (/read|grep|glob|search|view|list|find|fetch|^ls$/i.test(name)) return "read";
  return "other";
}

const redact = (s: string) => s.replace(/(api[_-]?key|token|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2***");

function describe(t: ToolCall): NonNullable<FlightPacket["activeTool"]> {
  const i = t.input;
  const str = (...keys: string[]) => keys.map((k) => i[k]).find((v): v is string => typeof v === "string");
  const details = str("command", "CommandLine", "description", "pattern", "query", "toolSummary", "Prompt");
  return {
    name: t.name,
    action: toolAction(t.name),
    targetFile: str("file_path", "notebook_path", "path", "TargetFile", "AbsolutePath"),
    details: details === undefined ? undefined : redact(details).slice(0, 160),
  };
}

interface Turn {
  node: TraceNode;
  tools: TraceNode[];
  /** ids of the latest tool_use batch; the next batch hangs off its last node */
  batch: string[];
}

/** Folds ParsedEvents for one session into the state a FlightPacket reports, plus a bounded execution DAG. */
export class Flight {
  meta: FlightMeta;
  cwd = "";
  firstTs = 0;
  lastTs = 0;
  last: ParsedEvent["kind"] | undefined;
  pending = new Map<string, ToolCall>();
  usage = new Map<string, { input: number; output: number; ts: number }>();
  turns: Turn[] = [];
  private turnCount = 0;

  constructor(meta: FlightMeta) {
    this.meta = meta;
  }

  apply(e: ParsedEvent): void {
    if (e.cwd) this.cwd = e.cwd;
    this.firstTs ||= e.ts;
    this.lastTs = Math.max(this.lastTs, e.ts);
    const cur = this.turns.at(-1);
    // agent work after a finished turn (or with no prompt seen) starts a new turn
    if (e.kind === "prompt" || ((e.kind === "tool_use" || e.kind === "thinking") && (cur === undefined || cur.node.end !== undefined))) this.openTurn(e.ts);
    const turn = this.turns.at(-1);
    if ("usage" in e && e.usage) {
      const prev = this.usage.get(e.usage.key);
      // one API response is repeated across entries; keep the largest count seen for it
      const next = {
        input: Math.max(prev?.input ?? 0, e.usage.input),
        output: Math.max(prev?.output ?? 0, e.usage.output),
        ts: prev?.ts ?? e.ts,
      };
      this.usage.set(e.usage.key, next);
      if (turn) turn.node.tokens = (turn.node.tokens ?? 0) + next.input + next.output - (prev ? prev.input + prev.output : 0);
    }
    if (e.kind === "tool_use" && turn) {
      const parent = turn.batch.at(-1) ?? turn.node.id;
      turn.batch = [];
      for (const t of e.tools) {
        this.pending.set(t.id, t);
        const d = describe(t);
        const node: TraceNode = { id: `tool-${t.id}`, kind: "tool", label: t.name, turn: turn.node.id, parent, start: e.ts, action: d.action };
        if (d.targetFile ?? d.details) node.detail = d.targetFile ?? d.details;
        turn.tools.push(node);
        turn.batch.push(node.id);
      }
      // drop the oldest calls, but keep the ones that spawned subagents so those still attach to their call
      const excess = turn.tools.length - MAX_TOOLS_PER_TURN;
      if (excess > 0) turn.tools = turn.tools.filter((n, i) => i >= excess || n.action === "subagent");
    }
    let handedBack = false;
    if (e.kind === "tool_result") {
      // agy results carry no id: they close the oldest pending call
      for (const id of e.toolUseIds.length ? e.toolUseIds : [...this.pending.keys()].slice(0, 1)) {
        handedBack ||= END_TOOLS.has(this.pending.get(id)?.name ?? "");
        this.pending.delete(id);
        for (let i = this.turns.length - 1; i >= 0; i--) {
          const node = this.turns[i]!.tools.find((n) => n.id === `tool-${id}`);
          if (node) {
            node.end ??= Math.max(e.ts, node.start);
            break;
          }
        }
      }
    }
    if (e.kind === "turn_end" || handedBack) this.closeTurn(e.ts);
    if (e.kind === "prompt" || e.kind === "turn_end" || handedBack) this.pending.clear();
    this.last = handedBack ? "turn_end" : e.kind;
  }

  /** Files this flight's write tools touched at or after `since`; relative paths resolve against the session cwd. */
  writes(since: number): { file: string; ts: number }[] {
    const out: { file: string; ts: number }[] = [];
    for (const t of this.turns) {
      for (const n of t.tools) {
        if (n.action !== "write" || !n.detail || n.start < since) continue;
        out.push({ file: isAbsolute(n.detail) || !this.cwd ? n.detail : resolve(this.cwd, n.detail), ts: n.start });
      }
    }
    return out;
  }

  private closeTurn(ts: number): void {
    const t = this.turns.at(-1);
    if (!t || t.node.end !== undefined) return;
    // transcripts sometimes append a line stamped earlier than the one before it; never show a negative duration
    t.node.end = Math.max(ts, t.node.start);
    for (const n of t.tools) n.end ??= Math.max(ts, n.start); // interrupted calls never get a result
  }

  private openTurn(ts: number): void {
    this.closeTurn(ts);
    const id = `turn-${++this.turnCount}`;
    const parent = this.turns.at(-1)?.node.id;
    this.turns.push({ node: { id, kind: "turn", label: `Turn ${this.turnCount}`, turn: id, ...(parent ? { parent } : {}), start: ts, tokens: 0 }, tools: [], batch: [] });
    if (this.turns.length > MAX_TURNS) this.turns.shift();
  }

  get totalTokens(): number {
    let n = 0;
    for (const u of this.usage.values()) n += u.input + u.output;
    return n;
  }

  /** Turns and tools, oldest first. Edges into trimmed nodes are re-pointed at the turn (or dropped for turns). */
  trace(): TraceNode[] {
    const nodes = this.turns.flatMap((t) => [t.node, ...t.tools]);
    const ids = new Set(nodes.map((n) => n.id));
    return nodes.map((n) => {
      if (n.parent === undefined || ids.has(n.parent)) return { ...n };
      const { parent: _, ...rest } = n;
      return n.kind === "turn" ? rest : { ...rest, parent: n.turn };
    });
  }

  state(now: number, live?: LiveInfo): FlightState {
    if (live?.alive === false) return "aborted";
    if (live?.status && /wait|input|permission|approv|action/i.test(live.status)) return "holding";
    if (live?.status === "idle") return "landed";
    if (this.last === "holding") return "holding";
    if (this.pending.size) {
      if ([...this.pending.values()].some((t) => HOLD_TOOLS.has(t.name))) return "holding";
      // shortcut: transcripts have no "awaiting approval" entry, so a tool call with no result and no new lines for 60s
      // counts as holding; a long build looks the same. Upgrade when the runtime exposes a permission-prompt signal.
      return now - this.lastTs > HOLD_AFTER_MS ? "holding" : "tool_executing";
    }
    if (this.last === "prompt") return "preflight";
    // Claude reports "busy" while background subagents run after the main turn ended
    if (this.last === "turn_end" || this.last === undefined) return live?.status === "busy" ? "cruising" : "landed";
    return "cruising";
  }

  packet(now: number, live?: LiveInfo, subagents: FlightPacket["subagents"] = []): FlightPacket {
    let input = 0, output = 0, recent = 0;
    for (const u of this.usage.values()) {
      input += u.input;
      output += u.output;
      if (now - u.ts <= BURN_WINDOW_MS) recent += u.input + u.output;
    }
    const tool = [...this.pending.values()].at(-1);
    return {
      id: randomUUID(),
      timestamp: new Date(this.lastTs).toISOString(),
      flightCallsign: this.meta.callsign,
      accountTier: this.meta.tier,
      runtime: this.meta.runtime,
      ...(live?.pid ? { pid: live.pid } : {}),
      cwd: this.cwd,
      flightState: this.state(now, live),
      ...(tool ? { activeTool: describe(tool) } : {}),
      subagents,
      fuelMetrics: {
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        burnRatePerMin: Math.round(recent / (BURN_WINDOW_MS / 60_000)),
      },
    };
  }
}
