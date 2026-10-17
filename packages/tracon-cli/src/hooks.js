// `tracon hooks install|uninstall`: the two Claude Code HTTP hooks that send held prompts to the engine, in every profile.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// Claude Code waits up to `timeout` seconds; the engine hands the prompt back to the terminal before that (HOLD_MAX_MS).
export const hookGroups = (port) => ({
  PreToolUse: [{ matcher: "AskUserQuestion|ExitPlanMode", hooks: [{ type: "http", url: `http://127.0.0.1:${port}/hook/pre-tool-use`, timeout: 3600 }] }],
  PermissionRequest: [{ matcher: "*", hooks: [{ type: "http", url: `http://127.0.0.1:${port}/hook/permission-request`, timeout: 3600 }] }],
});

const ours = (g) => (g.hooks ?? []).some((h) => h.type === "http" && /^http:\/\/127\.0\.0\.1:\d+\/hook\//.test(h.url ?? ""));

/** settings with TRACON's hook groups removed and, when a port is given, added back once. Everyone else's hooks stay. */
export function withHooks(settings, port) {
  const hooks = { ...settings.hooks };
  for (const e of Object.keys(hooks)) {
    hooks[e] = hooks[e].filter((g) => !ours(g));
    if (!hooks[e].length) delete hooks[e];
  }
  if (port !== undefined) for (const [e, groups] of Object.entries(hookGroups(port))) hooks[e] = [...(hooks[e] ?? []), ...groups];
  const out = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

/** Applies withHooks to each profile's settings.json, backing up a file before changing it. Returns one line per profile. */
export function applyHooks(profileDirs, port, backupDir, stamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  return profileDirs.map((dir) => {
    const file = join(dir, "settings.json");
    let settings = {};
    if (existsSync(file)) {
      try {
        settings = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return `${dir}: settings.json is not valid JSON, left alone`;
      }
    }
    const next = withHooks(settings, port);
    if (JSON.stringify(next) === JSON.stringify(settings)) return `${dir}: unchanged`;
    if (existsSync(file)) {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      copyFileSync(file, join(backupDir, `${basename(dir)}-settings-${stamp}.json`));
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n");
    return `${dir}: ${port === undefined ? "removed" : "installed"}`;
  });
}
