import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { LiveInfo } from "../normalizer.ts";

export interface ClaudeProfile {
  /** "" for ~/.claude, else the suffix: ~/.claude-biz -> "BIZ" */
  name: string;
  dir: string;
}

const ls = (d: string): string[] => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

/** ~/.claude, every ~/.claude-*, and $CLAUDE_CONFIG_DIR, if they hold a projects/ dir. */
export function claudeProfiles(home: string, env: NodeJS.ProcessEnv = process.env): ClaudeProfile[] {
  const dirs = ls(home)
    .filter((n) => /^\.claude(-[\w.-]+)?$/.test(n))
    .map((n) => join(home, n));
  if (env.CLAUDE_CONFIG_DIR) dirs.push(env.CLAUDE_CONFIG_DIR);
  return [...new Set(dirs)]
    .filter((d) => existsSync(join(d, "projects")))
    .map((dir) => ({ dir, name: basename(dir).replace(/^\.?claude-?/, "").toUpperCase() }));
}

export interface Transcript {
  path: string;
  sessionId: string;
  /** set for subagent transcripts: <project>/<sessionId>/subagents/agent-*.jsonl */
  parentPath?: string;
}

/** Session transcripts and their subagent transcripts under <profile>/projects/. */
export function claudeTranscripts(profileDir: string): Transcript[] {
  const out: Transcript[] = [];
  const projects = join(profileDir, "projects");
  for (const proj of ls(projects)) {
    const pdir = join(projects, proj);
    for (const f of ls(pdir)) {
      if (!f.endsWith(".jsonl")) continue;
      const sessionId = f.slice(0, -6);
      const path = join(pdir, f);
      out.push({ path, sessionId });
      const subs = join(pdir, sessionId, "subagents");
      for (const s of ls(subs)) if (s.endsWith(".jsonl")) out.push({ path: join(subs, s), sessionId: s.slice(0, -6), parentPath: path });
    }
  }
  return out;
}

/** Subagent role from agent-*.meta.json (agentType only). */
export function subagentRole(transcriptPath: string): string {
  try {
    return String(JSON.parse(readFileSync(transcriptPath.replace(/\.jsonl$/, ".meta.json"), "utf8")).agentType ?? "subagent");
  } catch {
    return "subagent";
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === "EPERM";
  }
};

/**
 * Claude Code keeps <profile>/sessions/<pid>.json for running sessions. Only pid, sessionId and status are read;
 * the sibling *.key files and socket paths are never touched.
 */
export function claudeLiveSessions(profileDir: string): Map<string, LiveInfo> {
  const live = new Map<string, LiveInfo>();
  const dir = join(profileDir, "sessions");
  for (const f of ls(dir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    try {
      const { pid, sessionId, status } = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (typeof sessionId === "string" && typeof pid === "number") live.set(sessionId, { pid, alive: alive(pid), status: String(status ?? "") });
    } catch {
      /* half-written; next tick */
    }
  }
  return live;
}
