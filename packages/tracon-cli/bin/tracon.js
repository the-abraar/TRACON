#!/usr/bin/env node
// tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall | secret rotate | service install|uninstall|status [--dry-run]
// (and `tracon hook pre-tool-use|permission-request`, which the installed Claude Code hooks run)
// (needs Node >= 23.6 unless you use the compiled binary: the engine is TypeScript run by Node's type stripping)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyHooks, hookCommand, postSocket, sendHook } from "../src/hooks.js";
import { alertLines, flightRow, HEAD, heldLines, row, summary } from "../src/view.js";

const USAGE = "usage: tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall | secret rotate | service install|uninstall|status [--dry-run]";
const [cmd = "tui", ...flags] = process.argv.slice(2);
const port = Number(process.env.TRACON_PORT ?? 4040);
const remotePort = Number(process.env.TRACON_REMOTE_PORT ?? 4041);
const base = `http://127.0.0.1:${port}`;
const uiFiles = globalThis.TRACON_UI_FILES; // set by the compiled binary's entry, which embeds the Flight Deck
const engine = () => import("../../avalokita-engine/src/server.ts");
const state = async () => new (await import("../../avalokita-engine/src/state.ts")).State();
/** Hosts the engine in this process; a port someone else holds ends it with that one line and exit 1, not a stack trace. */
const host = async () => {
  try {
    return await (await engine()).startEngine({ port, remotePort, uiFiles });
  } catch (e) {
    console.error(`tracon: ${e.message}`);
    process.exit(1);
  }
};
/** This program's absolute argv, as launchd and the hooks run it: the compiled binary, or node and this file. */
const self = async () => {
  const { onPath } = await import("../src/service.js");
  const PATH = process.env.PATH;
  return uiFiles ? [onPath("tracon", PATH, process.execPath)] : [onPath("node", PATH, process.execPath), fileURLToPath(import.meta.url)];
};

async function snapshot() {
  try {
    return await (await fetch(`${base}/api/flights`)).json();
  } catch {
    console.error(`No engine on :${port}. Run: tracon start`);
    process.exit(1);
  }
}

/** The tailscale CLI: on PATH, or inside the macOS app. */
function tailscale(...args) {
  for (const bin of ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]) {
    try {
      return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) {
      if (e.code !== "ENOENT") return undefined;
    }
  }
  return undefined;
}

// A stray error must not take the engine down with held prompts: log it and keep serving (held prompts time out on their own).
for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, (e) => console.error(`tracon: ${ev}:`, e));

if (cmd === "hook" && ["pre-tool-use", "permission-request"].includes(flags[0])) {
  // Run by Claude Code for each prompt the hooks match. Whatever goes wrong, print nothing and exit 0: Claude Code then
  // asks at the terminal exactly as it would without TRACON.
  let out = "";
  try {
    let body = "";
    for await (const c of process.stdin) body += c;
    const st = await state();
    const secret = readFileSync(join(st.dir, "secret"), "utf8").trim();
    out = await sendHook(st.sock, secret, flags[0], body);
  } catch {
    /* no state dir or secret yet: no engine has run */
  }
  process.stdout.write(out);
} else if (cmd === "start") {
  const { url, remoteUrl } = await host();
  console.log(`Avalokita Engine watching the airspace. Flight Deck: ${url}  (ws: ${url.replace("http", "ws")}/ws)`);
  console.log(`Paired devices: ${remoteUrl} (publish it with tailscale serve; see: tracon pair)`);
  if (!flags.includes("--no-open") && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
} else if (cmd === "tui") {
  if (!process.stdin.isTTY) {
    console.error("tracon tui needs a terminal. Use: tracon status");
    process.exit(1);
  }
  // reuse a running engine, else host one in this process
  if (!(await fetch(`${base}/api/flights`).then(() => true, () => false))) await host();
  (await import("../src/tui.js")).runTui(base);
} else if (cmd === "status") {
  const { flights, decisions } = await snapshot();
  console.log(summary(flights));
  console.log(row(...HEAD));
  for (const f of flights) console.log(flightRow(f));
  for (const line of [...alertLines(flights), ...heldLines(decisions)]) console.log(line);
} else if (cmd === "away" && ["auto", "on", "off"].includes(flags[0])) {
  // over the engine's socket, never TCP: whoever holds the port must not get the secret
  const st = await state();
  const res = await postSocket(st.sock, st.secret(), "/api/away", JSON.stringify({ mode: flags[0] }));
  if (!res) (console.error(`No engine on ${st.sock}. Run: tracon start`), process.exit(1));
  const r = JSON.parse(res.text);
  if (!r.mode) (console.error(`The engine refused: ${r.error}`), process.exit(1));
  console.log(`away mode: ${r.mode} (${r.away ? "away: questions and plans wait for your devices" : "at the Mac: the terminal asks"})`);
} else if (cmd === "pair") {
  const status = tailscale("status", "--json");
  if (!status) {
    console.error("Tailscale is not installed or not running. Install it on this Mac and on each device (https://tailscale.com/download), sign in to the same tailnet, then run tracon pair again.");
    process.exit(1);
  }
  const st = await state();
  const token = flags.includes("--rotate") || !st.token() ? st.rotateToken() : st.token();
  if (flags.includes("--rotate")) console.log("New device token: every paired device has to pair again.");
  const host = JSON.parse(status).Self?.DNSName?.replace(/\.$/, "");
  if (!(tailscale("serve", "status") ?? "").includes(`127.0.0.1:${remotePort}`))
    console.log(`Publish the engine to your tailnet (once; HTTPS, tailnet only):\n  tailscale serve --bg --https=443 http://127.0.0.1:${remotePort}\n`);
  const link = `https://${host}/#pair=${token}`;
  console.log(`Open this on each device, then Share > Add to Home Screen (iPhone) or Install app (Android/desktop):\n  ${link}\n`);
  (await import("qrcode-terminal")).default.generate(link, { small: true });
  console.log("Anyone with this link can answer your sessions' prompts. Rotate it with: tracon pair --rotate");
} else if (cmd === "hooks" && ["install", "uninstall"].includes(flags[0])) {
  const { claudeProfiles } = await import("../../avalokita-engine/src/scanners/claude.ts");
  const dirs = claudeProfiles(homedir()).map((p) => p.dir);
  const st = await state();
  const backups = join(st.dir, "backups");
  const install = flags[0] === "install";
  // the hook command finds the state dir itself; pin a non-default one, since Claude Code won't have this shell's env
  const env = process.env.TRACON_STATE ? { TRACON_STATE: resolve(process.env.TRACON_STATE) } : {};
  if (install) st.rotateSecret(); // a secret copied from an older install (or older settings.json) stops working
  for (const line of applyHooks(dirs, install ? hookCommand(await self(), env) : undefined, backups)) console.log(line);
  if (install) console.log(`Backups of changed files: ${backups}. New sessions send held prompts to the engine; restart running sessions to be sure they do. The local secret was rotated: reload open Flight Deck pages.`);
} else if (cmd === "secret" && flags[0] === "rotate") {
  (await state()).rotateSecret();
  console.log("New local secret: the old one no longer works. Reload open Flight Deck pages; the hooks and the CLI read the new one themselves.");
} else if (cmd === "service" && ["install", "uninstall", "status"].includes(flags[0])) {
  if (process.platform !== "darwin") (console.error("tracon service is macOS only (launchd)."), process.exit(1));
  const { LABEL, logPath, plist, plistPath, serviceState, traconEnv } = await import("../src/service.js");
  const dry = flags.includes("--dry-run"); // prints what it would do; touches neither the file nor launchd
  const file = plistPath(homedir());
  const domain = `gui/${process.getuid()}`;
  const launchctl = (...args) => {
    if (dry && args[0] !== "print") return void console.log(`would run: launchctl ${args.join(" ")}`);
    try {
      return execFileSync("launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return undefined;
    }
  };
  if (flags[0] === "status") {
    const state = serviceState(launchctl("print", `${domain}/${LABEL}`));
    console.log(state ? `${LABEL}: ${state} (${file}; log ${logPath(homedir())})` : `${LABEL}: not loaded. Install with: tracon service install`);
  } else {
    launchctl("bootout", `${domain}/${LABEL}`); // stop the old one; fails harmlessly if none is loaded
    if (flags[0] === "uninstall") {
      if (dry) console.log(`would remove: ${file}`);
      else (rmSync(file, { force: true }), console.log(`Removed ${file}. The engine no longer starts at login.`));
    } else {
      // the compiled binary is its own program; from source, node runs this file
      const program = [...(await self()), "start", "--no-open"];
      const body = plist(program, logPath(homedir()), traconEnv(process.env));
      if (dry) console.log(`would write ${file}:\n${body}`);
      else {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body);
      }
      let ok = launchctl("bootstrap", domain, file);
      // a bootout finishes asynchronously, so the first bootstrap can fail with "Input/output error"
      for (let i = 0; !dry && ok === undefined && i < 5; i++) await new Promise((r) => setTimeout(r, 1000)), (ok = launchctl("bootstrap", domain, file));
      if (!dry && ok === undefined) (console.error(`launchctl bootstrap failed. Try: launchctl bootstrap ${domain} ${file}`), process.exit(1));
      if (!dry) console.log(`Installed ${file}: the engine starts at login and restarts if it dies. Log: ${logPath(homedir())}. Check: tracon service status`);
    }
  }
} else {
  console.error(USAGE);
  process.exit(2);
}
