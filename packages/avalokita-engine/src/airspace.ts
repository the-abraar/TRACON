import { statSync } from "node:fs";
import { join } from "node:path";
import { Flight, type LiveInfo } from "./normalizer.ts";
import { parseAgyLine } from "./parsers/agy.ts";
import { parseClaudeLine } from "./parsers/claude.ts";
import { agyBrainDir, agyTasks, agyTranscripts } from "./scanners/agy.ts";
import { claudeLiveSessions, claudeProfiles, claudeTranscripts, subagentRole, type Transcript } from "./scanners/claude.ts";
import { Tailer } from "./tailers/tailer.ts";
import type { AccountTier, FlightPacket, ParsedEvent, TraceNode } from "./types.ts";

const TIERS = new Set<AccountTier>(["pro_20", "team_100", "api_usage", "gemini"]);

/** TRACON_TIERS="BIZ=team_100,WORK=api_usage" maps a profile suffix to its plan; "" is ~/.claude. Unlisted profiles are pro_20. */
export function parseTiers(spec = ""): Map<string, AccountTier> {
  const m = new Map<string, AccountTier>();
  for (const pair of spec.split(",")) {
    const [k, v] = pair.split("=").map((s) => s.trim());
    if (v && TIERS.has(v as AccountTier)) m.set((k ?? "").toUpperCase(), v as AccountTier);
  }
  return m;
}

interface Tracked {
  t: Transcript;
  flight: Flight;
  parse: (line: string) => ParsedEvent | null;
  role: string;
  live?: LiveInfo;
  conv?: string;
}

/** Scans every runtime's transcripts, tails the recent ones and turns each session into a FlightPacket. */
export class Airspace {
  private tracked = new Map<string, Tracked>();
  private tailer = new Tailer();
  private prev = new Map<string, FlightPacket>();
  /** callsign -> transcript path, for trace lookups */
  private paths = new Map<string, string>();
  private home: string;
  private windowMs: number;
  private tiers: Map<string, AccountTier>;
  private env: NodeJS.ProcessEnv;

  constructor(opts: { home: string; windowMs: number; tiers?: string; env?: NodeJS.ProcessEnv }) {
    this.home = opts.home;
    this.env = opts.env ?? process.env;
    this.windowMs = opts.windowMs;
    this.tiers = parseTiers(opts.tiers);
  }

  /** Directories worth an fs.watch. */
  roots(): string[] {
    return [...claudeProfiles(this.home, this.env).flatMap((p) => [join(p.dir, "projects"), join(p.dir, "sessions")]), agyBrainDir(this.home)];
  }

  tick(now = Date.now()): FlightPacket[] {
    for (const p of claudeProfiles(this.home, this.env)) {
      const live = claudeLiveSessions(p.dir);
      const tier = this.tiers.get(p.name) ?? "pro_20";
      for (const t of claudeTranscripts(p.dir)) {
        const callsign = `CL-${p.name ? p.name + "-" : ""}${t.sessionId.slice(0, 4).toUpperCase()}`;
        this.consider(t, now, t.parentPath ? undefined : live.get(t.sessionId), () => ({
          t,
          flight: new Flight({ callsign, runtime: "claude-code", tier }),
          parse: (line) => parseClaudeLine(line, !!t.parentPath),
          role: t.parentPath ? subagentRole(t.path) : "main",
        }));
      }
    }
    const brain = agyBrainDir(this.home);
    for (const t of agyTranscripts(brain)) {
      this.consider(t, now, undefined, () => ({
        t,
        flight: new Flight({ callsign: `AGY-${t.sessionId.slice(0, 4).toUpperCase()}`, runtime: "antigravity", tier: "gemini" }),
        parse: parseAgyLine,
        role: "main",
        conv: t.sessionId,
      }));
    }

    const packets: FlightPacket[] = [];
    for (const [path, e] of this.tracked) {
      if (e.t.parentPath || !this.inWindow(e, now)) continue;
      const subagents = e.conv
        ? agyTasks(brain, e.conv, now)
        : [...this.tracked.values()]
            .filter((c) => c.t.parentPath === path && this.inWindow(c, now))
            .map((c) => ({ id: c.t.sessionId, role: c.role, state: c.flight.state(now) }));
      let p = e.flight.packet(now, e.live, subagents);
      const old = this.prev.get(p.flightCallsign);
      if (old && JSON.stringify({ ...old, id: "" }) === JSON.stringify({ ...p, id: "" })) p = old; // unchanged: keep its event id
      this.prev.set(p.flightCallsign, p);
      this.paths.set(p.flightCallsign, path);
      packets.push(p);
    }
    return packets.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /** Execution DAG for one flight: its turns and tools, plus Claude subagents hung off the call that spawned them. */
  trace(callsign: string, now = Date.now()): TraceNode[] | undefined {
    const path = this.paths.get(callsign);
    const e = path === undefined ? undefined : this.tracked.get(path);
    if (!e) return undefined;
    const nodes = e.flight.trace();
    for (const c of this.tracked.values()) {
      if (c.t.parentPath !== path || !c.flight.firstTs) continue;
      // shortcut: subagents are matched to the latest Agent/Task call before their first line, not by id; upgrade if a transcript links them
      const before = nodes.filter((n) => n.start <= c.flight.firstTs);
      const turn = before.findLast((n) => n.kind === "turn");
      if (!turn) continue; // spawned in a turn trimmed from the DAG
      const spawn = before.findLast((n) => n.turn === turn.id && n.action === "subagent") ?? turn;
      const state = c.flight.state(now);
      nodes.push({
        id: `sub-${c.t.sessionId}`,
        kind: "subagent",
        label: c.role,
        turn: turn.id,
        parent: spawn.id,
        start: c.flight.firstTs,
        ...(state === "landed" || state === "aborted" ? { end: c.flight.lastTs } : {}),
        tokens: c.flight.totalTokens,
      });
    }
    return nodes;
  }

  private inWindow(e: Tracked, now: number): boolean {
    return now - e.flight.lastTs <= this.windowMs || e.live?.alive === true;
  }

  private consider(t: Transcript, now: number, live: LiveInfo | undefined, make: () => Tracked): void {
    let e = this.tracked.get(t.path);
    if (!e) {
      let mtime: number;
      try {
        mtime = statSync(t.path).mtimeMs;
      } catch {
        return;
      }
      if (now - mtime > this.windowMs && !live?.alive) return;
      e = make();
      this.tracked.set(t.path, e);
    }
    e.live = live;
    for (const line of this.tailer.read(t.path)) {
      const ev = e.parse(line);
      if (ev) e.flight.apply(ev);
    }
  }
}
