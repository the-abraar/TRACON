import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";
import { Airspace } from "./airspace.ts";
import { watchDirs } from "./tailers/tailer.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};
// Only pages served from this machine may open the socket; stops any website you visit from reading your sessions.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export interface EngineOptions {
  port?: number;
  home?: string;
  windowMs?: number;
  tiers?: string;
  uiDist?: string;
  /** read for CLAUDE_CONFIG_DIR, TRACON_WINDOW_MIN, TRACON_TIERS */
  env?: NodeJS.ProcessEnv;
}

/** Avalokita Engine: HTTP snapshot at /api/flights, one flight's DAG at /api/trace?flight=<callsign>, live stream at ws://127.0.0.1:<port>/ws, and the built UI at /. */
export async function startEngine(opts: EngineOptions = {}) {
  const port = opts.port ?? 4040;
  const uiDist = resolve(opts.uiDist ?? join(import.meta.dirname, "../../tracon-ui/dist"));
  const env = opts.env ?? process.env;
  const air = new Airspace({
    home: opts.home ?? homedir(),
    windowMs: opts.windowMs ?? Number(env.TRACON_WINDOW_MIN ?? 30) * 60_000,
    tiers: opts.tiers ?? env.TRACON_TIERS,
    env,
  });

  // Each message is the whole airspace, {flights: FlightPacket[]}, so clients also learn when a flight leaves.
  let snapshot = JSON.stringify({ flights: air.tick() });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = decodeURIComponent(url.pathname);
    if (path === "/api/flights") {
      res.writeHead(200, { "content-type": "application/json" }).end(snapshot);
      return;
    }
    if (path === "/api/trace") {
      const nodes = air.trace(url.searchParams.get("flight") ?? "");
      res.writeHead(nodes ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(nodes ? { nodes } : { error: "unknown flight" }));
      return;
    }
    let file = resolve(uiDist, "." + path);
    if (!file.startsWith(uiDist + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(uiDist, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "content-type": "text/plain" }).end("Flight Deck not built. Run: npm run build -w tracon-ui\n");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server, path: "/ws", verifyClient: (info: { origin?: string }) => !info.origin || LOCAL_ORIGIN.test(info.origin) });
  wss.on("connection", (ws) => ws.send(snapshot));

  const refresh = () => {
    const next = JSON.stringify({ flights: air.tick() });
    if (next === snapshot) return;
    snapshot = next;
    for (const c of wss.clients) c.send(snapshot);
  };
  let pending: NodeJS.Timeout | undefined;
  const watchers = watchDirs(air.roots(), () => {
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  });
  // the poll finds new profiles/sessions and moves time-based states (holding after 60s, leaving the window)
  const poll = setInterval(refresh, 2000);

  await new Promise<void>((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", ok));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      clearInterval(poll);
      clearTimeout(pending);
      for (const w of watchers) w.close();
      wss.close();
      server.close();
    },
  };
}
