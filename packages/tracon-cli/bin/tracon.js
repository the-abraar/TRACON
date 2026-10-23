#!/usr/bin/env node
// tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall
// (needs Node >= 23.6 unless you use the compiled binary: the engine is TypeScript run by Node's type stripping)
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyHooks } from "../src/hooks.js";
import { alertLines, flightRow, HEAD, heldLines, row, summary } from "../src/view.js";

const USAGE = "usage: tracon [tui] | start [--no-open] | status | away auto|on|off | pair [--rotate] | hooks install|uninstall";
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
} else {
  console.error(USAGE);
  process.exit(2);
}
