// `tracon doctor`: one pass/fail line per thing that keeps the inbox and the phone working. Read-only: it reads files,
// asks the engine's ports, git, launchctl, plutil and tailscale, and never prints a secret, token or push endpoint.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseTiers, TIERS } from "../../avalokita-engine/src/airspace.ts";
import { parseQuotaFiles, readUsage } from "../../avalokita-engine/src/quota.ts";
import { claudeProfiles } from "../../avalokita-engine/src/scanners/claude.ts";
import { LABEL, plistPath, serviceState } from "./service.js";

const USAGE_STALE_MS = 60 * 60_000;
const EVENTS = { PreToolUse: "pre-tool-use", PermissionRequest: "permission-request" };
const show = (name) => (name ? `~/.claude-${name.toLowerCase()}` : "~/.claude");

/** Any HTTP answer from 127.0.0.1:<port><path>, or the error. */
async function ask(port, path) {
  try {
    return (await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })).status;
  } catch (e) {
    return e.cause?.code ?? e.name;
  }
}

/** The settings.json hooks problem for one profile, or undefined when both TRACON command hooks are there and runnable. */
function hookProblem(dir) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  } catch (e) {
    return e.code === "ENOENT" ? "no settings.json: run tracon hooks install" : "settings.json is not valid JSON";
  }
  for (const [ev, path] of Object.entries(EVENTS)) {
    const hooks = (settings.hooks?.[ev] ?? []).flatMap((g) => g.hooks ?? []);
    const cmd = hooks.find((h) => h.type === "command" && /tracon/.test(h.command ?? "") && (h.command ?? "").endsWith(` hook ${path}`));
    if (!cmd) {
      const http = hooks.some((h) => h.type === "http" && /\/hook\//.test(h.url ?? ""));
      return `${ev}: ${http ? "old HTTP hook, which the engine no longer serves" : "no TRACON hook"}: run tracon hooks install`;
    }
    // hookCommand quotes each argv word; a moved checkout or an uninstalled binary breaks every prompt silently
    const missing = [...cmd.command.matchAll(/(?:^|\s)'(\/[^']*)'/g)].map((m) => m[1]).find((p) => !existsSync(p));
    if (missing) return `${ev}: the hook runs ${missing}, which does not exist: run tracon hooks install`;
  }
  return undefined;
}

/**
 * The doctor's lines ("ok   <check>: ...", "warn ...", "FAIL ...").
 * run(bin, ...args) returns stdout or undefined; tailscale(...args) the same for the tailscale CLI.
 * The engine's settings come from the LaunchAgent's EnvironmentVariables when it has one (that is what the engine runs with), else `env`.
 */
export async function doctor({ home, env, uid, run, tailscale, here, now = Date.now() }) {
  const out = [];
  const say = (level, check, msg) => out.push(`${level.padEnd(4)} ${check}: ${msg}`);

  // launchd agent and the environment it gives the engine
  const file = plistPath(home);
  let plist;
  if (existsSync(file)) {
    try {
      plist = JSON.parse(run("plutil", "-convert", "json", "-o", "-", file) ?? "");
    } catch {
      say("FAIL", "service", `${file} is not a readable plist`);
    }
  }
  const state = serviceState(run("launchctl", "print", `gui/${uid}/${LABEL}`));
  if (!plist) say("warn", "service", `no LaunchAgent (${file}): the engine stops at logout. Install with: tracon service install`);
  else say(state?.startsWith("running") ? "ok" : "FAIL", "service", state ? `${LABEL} ${state}` : `${LABEL} not loaded: launchctl bootstrap gui/${uid} ${file}`);
  const shellVars = Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("TRACON_")));
  const cfg = plist ? (plist.EnvironmentVariables ?? {}) : shellVars;
  if (plist) {
    // names only: values are paths and specs, but a doctor that prints nothing it reads can be pasted anywhere
    const differ = [...new Set([...Object.keys(shellVars), ...Object.keys(cfg).filter((k) => k.startsWith("TRACON_"))])].filter((k) => shellVars[k] !== cfg[k]);
    say(differ.length ? "FAIL" : "ok", "plist env", differ.length ? `differs from this shell for ${differ.join(", ")}: re-run tracon service install from the shell you want` : "matches this shell's TRACON_* variables");
  }

  // the engine on both ports
  const port = Number(cfg.TRACON_PORT ?? 4040), remote = Number(cfg.TRACON_REMOTE_PORT ?? 4041);
  const local = await ask(port, "/api/flights");
  say(local === 200 ? "ok" : "FAIL", "engine local", local === 200 ? `127.0.0.1:${port} answers` : `127.0.0.1:${port}: ${local}`);
  const far = await ask(remote, "/api/flights");
  say(far === 401 ? "ok" : "FAIL", "engine remote", far === 401 ? `127.0.0.1:${remote} answers and asks for the device token` : `127.0.0.1:${remote}: ${far}`);

  // the code the engine runs vs origin/main (as of the last git fetch: the doctor doesn't touch the network)
  const arg = plist?.ProgramArguments?.find((a) => /tracon\.js$/.test(a)); // the hand-copied plist gives it relative to WorkingDirectory
  const prog = arg ? resolve(plist.WorkingDirectory ?? "/", arg) : plist ? undefined : here;
  if (!prog) say("warn", "engine code", "compiled binary: no checkout to compare");
  else {
    const repo = resolve(dirname(prog), "../../..");
    const git = (...a) => run("git", "-C", repo, ...a)?.trim();
    const head = git("rev-parse", "--short", "HEAD"), behind = git("rev-list", "--count", "HEAD..origin/main");
    if (!head || behind === undefined) say("warn", "engine code", `${repo}: not a git checkout with origin/main`);
    else say(behind === "0" ? "ok" : "FAIL", "engine code", behind === "0" ? `${repo} at ${head}, has origin/main` : `${repo} at ${head} is ${behind} commit(s) behind origin/main: git pull --ff-only, then restart the engine`);
    // shortcut: an engine started before the last pull still runs the old code; compare its start time to HEAD's if that bites
  }

  // hooks in every Claude profile
  const profiles = claudeProfiles(home, env);
  if (!profiles.length) say("FAIL", "hooks", `no Claude profile with a projects/ folder under ${home}`);
  for (const p of profiles) {
    const bad = hookProblem(p.dir);
    say(bad ? "FAIL" : "ok", `hooks ${show(p.name)}`, bad ?? "both command hooks installed");
  }

  // state dir: secret, pairing, push
  const dir = cfg.TRACON_STATE ?? join(home, ".config", "tracon");
  say(existsSync(join(dir, "secret")) ? "ok" : "FAIL", "secret", existsSync(join(dir, "secret")) ? `present in ${dir}` : `missing in ${dir}: start the engine once`);
  const paired = existsSync(join(dir, "token"));
  let subs = 0;
  try {
    const s = JSON.parse(readFileSync(join(dir, "subscriptions.json"), "utf8"));
    subs = Array.isArray(s) ? s.length : 0;
  } catch {
    /* none yet */
  }
  say(paired ? "ok" : "FAIL", "pairing", paired ? "device token set" : "no device token: run tracon pair");
  say(subs ? "ok" : "FAIL", "push", subs ? `${subs} device(s) subscribed` : "no device subscribed: open the paired app and allow notifications");

  // Tailscale and the serve mapping to the remote port
  const ts = tailscale("status", "--json");
  let backend;
  try {
    backend = JSON.parse(ts ?? "").BackendState;
  } catch {
    /* not installed or not answering */
  }
  say(backend === "Running" ? "ok" : "FAIL", "tailscale", backend === "Running" ? "running" : ts === undefined ? "not installed or not running" : `state ${backend ?? "unknown"}: open Tailscale and sign in`);
  const served = (tailscale("serve", "status") ?? "").includes(`127.0.0.1:${remote}`);
  say(served ? "ok" : "FAIL", "tailscale serve", served ? `publishes 127.0.0.1:${remote}` : `not publishing 127.0.0.1:${remote}: tailscale serve --bg --https=443 http://127.0.0.1:${remote}`);

  // usage mirrors (TRACON_QUOTA) and plans (TRACON_TIERS)
  const mirrors = parseQuotaFiles(cfg.TRACON_QUOTA);
  for (const p of profiles) {
    const f = mirrors.get(p.name);
    if (f === undefined) {
      say("warn", `usage ${show(p.name)}`, "no mirror in TRACON_QUOTA: QUOTA shows n/a");
      continue;
    }
    const u = readUsage(f, now);
    if (!u) say("FAIL", `usage ${show(p.name)}`, `${f} is missing or has no (epoch ...) reading`);
    else {
      const age = Math.round((now - Date.parse(u.updatedAt)) / 60_000);
      say(now - Date.parse(u.updatedAt) > USAGE_STALE_MS ? "warn" : "ok", `usage ${show(p.name)}`, `read ${age} min ago`);
    }
  }
  const spec = (cfg.TRACON_TIERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = spec.filter((s) => !TIERS.has(s.split("=")[1]?.trim()));
  const tiers = parseTiers(cfg.TRACON_TIERS);
  const names = new Set(profiles.map((p) => p.name));
  const orphan = [...tiers.keys()].filter((k) => !names.has(k));
  if (unknown.length) say("FAIL", "tiers", `not a plan: ${unknown.join(", ")} (use ${[...TIERS].join(", ")})`);
  else if (orphan.length) say("warn", "tiers", `no such profile: ${orphan.map(show).join(", ")}`);
  else say("ok", "tiers", profiles.map((p) => `${show(p.name)}=${tiers.get(p.name) ?? "pro_20 (default)"}`).join(", ") || "none");
  return out;
}
