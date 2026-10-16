// tracon [tui] | start [--no-open] | status   (needs Node >= 23.6 unless you use the compiled binary: the engine is TypeScript run by Node's type stripping)
import { spawn } from "node:child_process";
import { alertLines, flightRow, HEAD, row, summary } from "../src/view.js";

const [cmd = "tui", ...flags] = process.argv.slice(2);
const port = Number(process.env.TRACON_PORT ?? 4040);
const base = `http://127.0.0.1:${port}`;
const uiFiles = globalThis.TRACON_UI_FILES; // set by the compiled binary's entry, which embeds the Flight Deck
const engine = () => import("../../avalokita-engine/src/server.ts");

if (cmd === "start") {
  const { startEngine } = await engine();
  const { url } = await startEngine({ port, uiFiles });
  console.log(`Avalokita Engine watching the airspace. Flight Deck: ${url}  (ws: ${url.replace("http", "ws")}/ws)`);
  if (!flags.includes("--no-open") && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
} else if (cmd === "tui") {
  if (!process.stdin.isTTY) {
    console.error("tracon tui needs a terminal. Use: tracon status");
    process.exit(1);
  }
  // reuse a running engine, else host one in this process
  if (!(await fetch(`${base}/api/flights`).then(() => true, () => false))) await (await engine()).startEngine({ port, uiFiles });
  (await import("../src/tui.js")).runTui(base);
} else if (cmd === "status") {
  let flights;
  try {
    ({ flights } = await (await fetch(`${base}/api/flights`)).json());
  } catch {
    console.error(`No engine on :${port}. Run: tracon start`);
    process.exit(1);
  }
  console.log(summary(flights));
  console.log(row(...HEAD));
  for (const f of flights) console.log(flightRow(f));
  for (const line of alertLines(flights)) console.log(line);
} else {
  console.error("usage: tracon [tui] | start [--no-open] | status");
  process.exit(2);
}
