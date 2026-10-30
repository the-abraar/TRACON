#!/usr/bin/env node
// tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall | service install|uninstall|status [--dry-run]
// (needs Node >= 23.6 unless you use the compiled binary: the engine is TypeScript run by Node's type stripping)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyHooks } from "../src/hooks.js";
import { alertLines, flightRow, HEAD, heldLines, row, summary } from "../src/view.js";

const USAGE = "usage: tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall | service install|uninstall|status [--dry-run]";
const [cmd = "tui", ...flags] = process.argv.slice(2);
const port = Number(process.env.TRACON_PORT ?? 4040);
const remotePort = Number(process.env.TRACON_REMOTE_PORT ?? 4041);
const base = `http://127.0.0.1:${port}`;
const uiFiles = globalThis.TRACON_UI_FILES; // set by the compiled binary's entry, which embeds the Flight Deck
const engine = () => import("../../avalokita-engine/src/server.ts");
const state = async () => new (await import("../../avalokita-engine/src/state.ts")).State();

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

if (cmd === "start") {
  const { startEngine } = await engine();
  const { url, remoteUrl } = await startEngine({ port, remotePort, uiFiles });
  console.log(`Avalokita Engine watching the airspace. Flight Deck: ${url}  (ws: ${url.replace("http", "ws")}/ws)`);
  console.log(`Paired devices: ${remoteUrl} (publish it with tailscale serve; see: tracon pair)`);
  if (!flags.includes("--no-open") && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
} else if (cmd === "tui") {
  if (!process.stdin.isTTY) {
    console.error("tracon tui needs a terminal. Use: tracon status");
    process.exit(1);
  }
  // reuse a running engine, else host one in this process
  if (!(await fetch(`${base}/api/flights`).then(() => true, () => false))) await (await engine()).startEngine({ port, remotePort, uiFiles });
  (await import("../src/tui.js")).runTui(base);
} else if (cmd === "status") {
  const { flights, decisions } = await snapshot();
  console.log(summary(flights));
  console.log(row(...HEAD));
  for (const f of flights) console.log(flightRow(f));
  for (const line of [...alertLines(flights), ...heldLines(decisions)]) console.log(line);
} else if (cmd === "away" && ["auto", "on", "off"].includes(flags[0])) {
  await snapshot(); // exits with a hint if no engine
  const headers = { "content-type": "application/json", "x-tracon-secret": (await state()).secret() };
  const r = await (await fetch(`${base}/api/away`, { method: "POST", headers, body: JSON.stringify({ mode: flags[0] }) })).json();
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
  for (const line of applyHooks(dirs, install ? port : undefined, install ? st.secret() : undefined, backups)) console.log(line);
  if (install) console.log(`Backups of changed files: ${backups}. New sessions send held prompts to the engine; restart running sessions to be sure they do.`);
} else if (cmd === "service" && ["install", "uninstall", "status"].includes(flags[0])) {
  if (process.platform !== "darwin") (console.error("tracon service is macOS only (launchd)."), process.exit(1));
  const { LABEL, logPath, onPath, plist, plistPath, serviceState, traconEnv } = await import("../src/service.js");
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
      const PATH = process.env.PATH;
      const program = [...(uiFiles ? [onPath("tracon", PATH, process.execPath)] : [onPath("node", PATH, process.execPath), fileURLToPath(import.meta.url)]), "start", "--no-open"];
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
