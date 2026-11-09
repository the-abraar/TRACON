// `tracon hooks install|uninstall`: the two Claude Code command hooks that send held prompts to the engine, in every
// profile, and `tracon hook`, the command they run.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { basename, join } from "node:path";

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The shell command that runs `tracon`: `program` is its absolute argv, `env` variables to pin (TRACON_STATE). */
export const hookCommand = (program, env = {}) => [...Object.entries(env).map(([k, v]) => `${k}=${q(v)}`), ...program.map(q)].join(" ");

// `tracon hook` reads the local secret from the state dir and talks to the engine's Unix socket, so settings.json holds
// no secret and no port. Claude Code waits up to `timeout` seconds; the engine hands the prompt back to the terminal
// before that (HOLD_MAX_MS), and `tracon hook` gives up by itself once the engine stops sending (IDLE_MS).
export const hookGroups = (cmd) => {
  const hook = (path) => ({ type: "command", command: `${cmd} hook ${path}`, timeout: 3600 });
  return {
    PreToolUse: [{ matcher: "AskUserQuestion|ExitPlanMode", hooks: [hook("pre-tool-use")] }],
    PermissionRequest: [{ matcher: "*", hooks: [hook("permission-request")] }],
  };
};

// the command hooks, and the HTTP hooks to 127.0.0.1:<port>/hook/* that installs before 2026-11 wrote
const ours = (g) =>
  (g.hooks ?? []).some(
    (h) =>
      (h.type === "http" && /^http:\/\/127\.0\.0\.1:\d+\/hook\//.test(h.url ?? "")) ||
      (h.type === "command" && /tracon/.test(h.command ?? "") && / hook (pre-tool-use|permission-request)$/.test(h.command ?? "")),
  );

/** settings with TRACON's hook groups removed and, when a command is given, added back once. Everyone else's hooks stay. */
export function withHooks(settings, cmd) {
  const hooks = { ...settings.hooks };
  for (const e of Object.keys(hooks)) {
    hooks[e] = hooks[e].filter((g) => !ours(g));
    if (!hooks[e].length) delete hooks[e];
  }
  if (cmd !== undefined) for (const [e, groups] of Object.entries(hookGroups(cmd))) hooks[e] = [...(hooks[e] ?? []), ...groups];
  const out = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

/** Applies withHooks to each profile's settings.json, backing up a file before changing it. Returns one line per profile. */
export function applyHooks(profileDirs, cmd, backupDir, stamp = new Date().toISOString().replace(/[:.]/g, "-")) {
  return profileDirs.map((dir) => {
    const file = join(dir, "settings.json");
    let settings = {};
    if (existsSync(file)) {
      try {
        settings = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return `${dir}: settings.json is not valid JSON, left alone`;
      }
      // older installs wrote the local secret here, and settings can hold other tokens: tighten it before writing, and on re-install of an unchanged file too
      chmodSync(file, 0o600);
    }
    const next = withHooks(settings, cmd);
    if (JSON.stringify(next) === JSON.stringify(settings)) return `${dir}: unchanged`;
    if (existsSync(file)) {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      copyFileSync(file, join(backupDir, `${basename(dir)}-settings-${stamp}.json`));
    }
    writeFileSync(file, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
    return `${dir}: ${cmd === undefined ? "removed" : "installed"}`;
  });
}

const CONNECT_MS = 1000;
/** While it holds a prompt the engine sends a space every 5 s; this much silence means it is stopped or wedged. */
export const IDLE_MS = 15_000;

/**
 * POSTs one hook body to the engine's socket and resolves to what `tracon hook` prints: the engine's reply, or "" when
 * there is no engine, it refuses, or it goes silent. Never rejects: an empty reply (exit 0, no output) makes Claude Code
 * ask at the terminal as if TRACON weren't installed.
 */
export async function sendHook(sock, secret, path, body, idleMs = IDLE_MS) {
  const r = await postSocket(sock, secret, `/hook/${path}`, body, idleMs);
  return r?.status === 200 ? r.text.trim() : "";
}

/** POSTs to the engine's Unix socket with the local secret; resolves { status, text }, or undefined if no whole reply came. */
export function postSocket(sock, secret, path, body, idleMs = IDLE_MS) {
  return new Promise((done) => {
    const req = request({ socketPath: sock, path, method: "POST", headers: { "content-type": "application/json", "x-tracon-secret": secret } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("close", () => done(res.complete ? { status: res.statusCode, text } : undefined));
    });
    const connect = setTimeout(() => req.destroy(), CONNECT_MS);
    req.on("socket", (s) => s.once("connect", () => clearTimeout(connect)));
    req.on("close", () => clearTimeout(connect));
    req.setTimeout(idleMs, () => req.destroy()); // socket idle: reset by every byte, heartbeats included
    req.on("error", () => done(undefined));
    req.end(body);
  });
}
