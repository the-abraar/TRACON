// Terminal Flight Deck: polls a running engine and redraws. No dependencies, plain ANSI.
import { spawn } from "node:child_process";
import { alertLines, flightRow, HEAD, row, summary, traceLine } from "./view.js";

const ESC = "\x1b[";
const paint = (code, s) => `${ESC}${code}m${s}${ESC}0m`;
const STATE_COLOR = { holding: "1;33", tool_executing: "32", cruising: "36", landed: "2", aborted: "31" };

export function runTui(base) {
  const out = process.stdout;
  let flights = [];
  let sel = 0;
  let trace; // {callsign, nodes} while the trace panel is open
  let error = "";

  const load = async () => {
    try {
      flights = (await (await fetch(`${base}/api/flights`)).json()).flights;
      sel = Math.min(sel, Math.max(0, flights.length - 1));
      if (trace && flights[sel]) {
        const r = await fetch(`${base}/api/trace?flight=${encodeURIComponent(flights[sel].flightCallsign)}`);
        trace = { callsign: flights[sel].flightCallsign, nodes: r.ok ? (await r.json()).nodes : [] };
      }
      error = "";
    } catch {
      error = `engine on ${base} not answering`;
    }
    draw();
  };

  function draw() {
    const [cols, rows] = [out.columns || 100, out.rows || 30];
    const lines = [{ t: summary(flights), c: "1" }, { t: row(...HEAD), c: "2" }];
    flights.forEach((f, i) => lines.push({ t: flightRow(f), c: i === sel ? "7" : STATE_COLOR[f.flightState]}));
    if (!flights.length) lines.push({ t: "No flights in the last 30 min. Start an agent session.", c: "2" });
    for (const a of alertLines(flights)) lines.push({ t: a, c: a.startsWith("TCAS") ? "1;31" : "1;33" });
    if (trace) {
      lines.push({ t: `TRACE ${trace.callsign} (last turns)`, c: "1" });
      const room = rows - lines.length - 2;
      for (const n of trace.nodes.slice(-Math.max(room, 0))) lines.push({ t: traceLine(n) });
    }
    if (error) lines.push({ t: error, c: "31" });
    // pin the key help to the last row
    const body = lines.slice(0, rows - 1).map(({ t, c }) => (c ? paint(c, t.slice(0, cols)) : t.slice(0, cols)) + `${ESC}K`);
    const help = "↑/↓ select   enter trace   w web deck   q quit".slice(0, cols);
    out.write(`${ESC}H${body.join("\n")}\n${ESC}J${ESC}${rows};1H${paint("2", help)}`);
  }

  const quit = () => {
    clearInterval(timer);
    out.write(`${ESC}?25h${ESC}?1049l`);
    process.exit(0);
  };

  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (key) => {
    if (key === "q" || key === "\x03") quit();
    else if (key === `${ESC}A`) sel = Math.max(0, sel - 1);
    else if (key === `${ESC}B`) sel = Math.min(flights.length - 1, sel + 1);
    else if (key === "\r") trace = trace ? undefined : { callsign: "", nodes: [] };
    else if (key === "w" && process.platform === "darwin") spawn("open", [base], { stdio: "ignore", detached: true }).unref();
    else return;
    load();
  });
  out.on("resize", draw);
  out.write(`${ESC}?1049h${ESC}?25l`);
  const timer = setInterval(load, 1000);
  load();
}
