// macOS LaunchAgent that starts the engine at login and restarts it if it dies (`tracon service install`).
import { existsSync } from "node:fs";
import { join } from "node:path";

// The label the hand-copied plist used before `tracon service` existed, so an install replaces that one instead of racing it for the port.
export const LABEL = "com.blackbird.tracon";

export const plistPath = (home) => join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
export const logPath = (home) => join(home, "Library", "Logs", "tracon.log");

/** `name` as the shell finds it on PATH (Homebrew's stable symlink, not the versioned Cellar path that an upgrade deletes), else `fallback`. */
export const onPath = (name, PATH, fallback) =>
  (PATH ?? "").split(":").filter((d) => d.startsWith("/")).map((d) => join(d, name)).find((f) => existsSync(f)) ?? fallback;

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The plist for `program` (absolute argv), with KeepAlive, RunAtLoad and stdout/stderr to `log`. */
export function plist(program, log) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by tracon service install. Remove with: tracon service uninstall -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((a) => `    <string>${xml(a)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(log)}</string>
</dict>
</plist>
`;
}

/** "running, pid 709" from `launchctl print` output; undefined if launchd doesn't know the label. */
export function serviceState(printed) {
  if (!printed) return undefined;
  const state = printed.match(/^\s*state = (.+)$/m)?.[1] ?? "unknown";
  const pid = printed.match(/^\s*pid = (\d+)$/m)?.[1];
  return pid ? `${state}, pid ${pid}` : state;
}
