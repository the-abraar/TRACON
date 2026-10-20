import { readFileSync } from "node:fs";
import type { Account, QuotaWindow } from "./types.ts";

const FIVE_HOURS_MS = 5 * 60 * 60_000;

/**
 * TRACON_QUOTA="HAT=/path/usage.md" maps a profile suffix ("" is ~/.claude) to a usage mirror that the profile's
 * status line command writes (the statusline-usage.py format). Claude transcripts carry no quota, so this is the only source.
 */
export function parseQuotaFiles(spec = ""): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of spec.split(",")) {
    const i = pair.indexOf("=");
    const path = i < 0 ? "" : pair.slice(i + 1).trim();
    if (path) m.set(pair.slice(0, i).trim().toUpperCase(), path);
  }
  return m;
}

/** One rate-limit window from a usage mirror; undefined when absent ("n/a") or already reset. */
function readWindow(text: string, label: string, spanMs: number, readAt: number, now: number): QuotaWindow | undefined {
  const pct = new RegExp(`${label} window: (\\d+(?:\\.\\d+)?)% used\\.\\*\\* Resets (\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}) ([+-]\\d{2})(\\d{2})?`).exec(text)
    ?? new RegExp(`${label} window: (\\d+(?:\\.\\d+)?)% used`).exec(text);
  if (!pct) return undefined;
  const resets = pct[2] ? Date.parse(`${pct[2]}T${pct[3]}:00${pct[4]}:${pct[5] ?? "00"}`) : NaN;
  if (!Number.isNaN(resets) ? now >= resets : now - readAt > spanMs) return undefined;
  return { pct: Number(pct[1]), resetsAt: Number.isNaN(resets) ? undefined : new Date(resets).toISOString() };
}

/**
 * The 5-hour and 7-day windows from a usage mirror, or undefined when the file is missing, unreadable or has no reading time.
 * A window is dropped once it has reset (its "Resets" time has passed, or, with no reset time, the reading is older than the window).
 */
export function readUsage(path: string, now: number): Pick<Account, "fiveHour" | "weekly" | "updatedAt"> | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const epoch = /\(epoch (\d+)\)/.exec(text);
  if (!epoch) return undefined;
  const readAt = Number(epoch[1]) * 1000;
  return {
    fiveHour: readWindow(text, "5-hour", FIVE_HOURS_MS, readAt, now),
    weekly: readWindow(text, "7-day", 7 * 24 * 60 * 60_000, readAt, now),
    updatedAt: new Date(readAt).toISOString(),
  };
}

/** The 5-hour used percentage from a usage mirror, or undefined when unknown or reset. */
export const readQuota = (path: string, now: number): number | undefined => readUsage(path, now)?.fiveHour?.pct;
