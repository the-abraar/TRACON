import { execFile } from "node:child_process";
import type { AwayMode } from "./types.ts";

export const AWAY_IDLE_SEC = 180;

/** Seconds since the last keyboard or mouse input (macOS IOHIDSystem HIDIdleTime); undefined on other systems. */
export function idleSeconds(): Promise<number | undefined> {
  if (process.platform !== "darwin") return Promise.resolve(undefined);
  return new Promise((ok) =>
    execFile("ioreg", ["-c", "IOHIDSystem", "-d", "4", "-r", "-k", "HIDIdleTime"], (err, out) => {
      const m = /"HIDIdleTime" = (\d+)/.exec(out);
      ok(err || !m ? undefined : Number(m[1]) / 1e9);
    }),
  );
}

// shortcut: idle is only measured on macOS; elsewhere "auto" never turns away, so use `tracon away on`
export const isAway = (mode: AwayMode, idleSec: number | undefined) => mode === "on" || (mode === "auto" && idleSec !== undefined && idleSec >= AWAY_IDLE_SEC);
