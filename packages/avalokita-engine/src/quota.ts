import { readFileSync } from "node:fs";

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

/**
 * The 5-hour used percentage from a usage mirror, or undefined when the file is missing or unreadable,
 * or the window it measured has reset (its "Resets" time has passed, or the reading is over 5 hours old).
 */
export function readQuota(path: string, now: number): number | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  const pct = /5-hour window: (\d+(?:\.\d+)?)% used\.\*\* Resets (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) ([+-]\d{2})(\d{2})?/.exec(text)
    ?? /5-hour window: (\d+(?:\.\d+)?)% used/.exec(text);
  const epoch = /\(epoch (\d+)\)/.exec(text);
  if (!pct || !epoch) return undefined;
  const resets = pct[2] ? Date.parse(`${pct[2]}T${pct[3]}:00${pct[4]}:${pct[5] ?? "00"}`) : NaN;
  if (!Number.isNaN(resets) ? now >= resets : now - Number(epoch[1]) * 1000 > FIVE_HOURS_MS) return undefined;
  return Number(pct[1]);
}
