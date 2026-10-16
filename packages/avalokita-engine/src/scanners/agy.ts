import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Transcript } from "./claude.ts";

export const agyBrainDir = (home: string) => join(home, ".gemini", "antigravity-cli", "brain");

const ls = (d: string): string[] => {
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
};

/**
 * One transcript per conversation. The local CLI writes <conv>/.system_generated/logs/transcript.jsonl;
 * PLAN.md documents <conv>/transcript.jsonl, so that path is the fallback.
 */
export function agyTranscripts(brain: string): Transcript[] {
  const out: Transcript[] = [];
  for (const conv of ls(brain)) {
    const path = [join(brain, conv, ".system_generated", "logs", "transcript.jsonl"), join(brain, conv, "transcript.jsonl")].find((p) => existsSync(p));
    if (path) out.push({ path, sessionId: conv });
  }
  return out;
}

/** Running background tasks (.system_generated/tasks/task-*.log written in the last minute) become sub-flights. */
export function agyTasks(brain: string, conv: string, now: number): { id: string; role: string; state: string }[] {
  const dir = join(brain, conv, ".system_generated", "tasks");
  return ls(dir)
    .filter((f) => /^task-.*\.log$/.test(f))
    .flatMap((f) => {
      try {
        return now - statSync(join(dir, f)).mtimeMs < 60_000 ? [{ id: f.slice(0, -4), role: "task", state: "running" }] : [];
      } catch {
        return [];
      }
    });
}
