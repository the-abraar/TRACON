import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";
import { Airspace } from "./airspace.ts";
import { idleSeconds, isAway } from "./away.ts";
import { decisionKind, Decisions, type HookInput } from "./decisions.ts";
import { parseSubscription, Pusher } from "./push.ts";
import { State } from "./state.ts";
import { watchDirs } from "./tailers/tailer.ts";
import type { Answer, AwayMode, Snapshot } from "./types.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
// Only pages served from this machine may open the local socket or POST to it; stops any website you visit from reading
// your sessions or answering them. Claude Code's hook requests carry no Origin. Any local port passes, so the socket also
// needs the local secret: a page from another local server (a dev server, a notebook) passes this check but has no secret.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// The local listener also checks Host: a DNS-rebinding page is same-origin with it and sends no foreign Origin on GET.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
// Every state-changing request carries the local secret (state.ts): `tracon hook` and the CLI read the file, the deck
// gets it in its page. A blind POST from another program gets 403.
// shortcut: a program running as you can read ~/.config/tracon/secret, connect to the socket or fetch the deck's page,
// so this stops blind POSTs and other users, not your own account; add peer-process checks if that ever matters.
const SECRET_HEADER = "x-tracon-secret";
// Browsers cannot set headers on a WebSocket, so the deck sends its credential (local secret or device token) as a
// subprotocol: ["tracon", <credential>]. The server echoes only "tracon", so the credential stays out of the URL and reply.
const WS_PROTOCOL = "tracon";
const offered = (req: IncomingMessage) => String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
// While a hook is held, a space every few seconds tells `tracon hook` the engine is alive (it gives up after 15 s of
// silence, so a stopped engine never freezes a prompt). Leading whitespace is still valid JSON.
const HEARTBEAT_MS = 5000;
const MAX_BODY = 1 << 20;
const MODES = new Set<AwayMode>(["auto", "on", "off"]);

export interface EngineOptions {
  port?: number;
  /** the listener `tailscale serve` exposes to paired devices; default 4041 */
  remotePort?: number;
  home?: string;
  windowMs?: number;
  tiers?: string;
  quota?: string;
  uiDist?: string;
  /** URL path -> readable file, replaces uiDist; the compiled binary uses it to serve the UI it embeds */
  uiFiles?: Record<string, string>;
  /** TRACON's own state dir (token, push keys); default ~/.config/tracon */
  stateDir?: string;
  /** seconds since the last keyboard/mouse input; tests inject it */
  idle?: () => Promise<number | undefined>;
  /** read for CLAUDE_CONFIG_DIR, TRACON_WINDOW_MIN, TRACON_TIERS, TRACON_QUOTA, TRACON_REMOTE_HOST */
  env?: NodeJS.ProcessEnv;
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) req.destroy(new Error("body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        fail(e);
      }
    });
    req.on("error", fail);
  });
}

/** local: deck, API and /ws on 127.0.0.1:<port>. remote: the same behind the device token. hook: /hook/* and POST /api/away on the Unix socket. */
type Listener = "local" | "remote" | "hook";

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

/**
 * Avalokita Engine. Local listener (127.0.0.1:<port>): the Flight Deck, /api/* and /ws. Remote listener
 * (127.0.0.1:<remotePort>, published by `tailscale serve`): the same deck and API behind the device token. The Claude
 * Code hooks (/hook/*, through `tracon hook`) are served only on the Unix socket <stateDir>/engine.sock, so whoever
 * holds a TCP port never sees them.
 */
export async function startEngine(opts: EngineOptions = {}) {
  const port = opts.port ?? 4040;
  const uiDist = resolve(opts.uiDist ?? join(import.meta.dirname, "../../tracon-ui/dist"));
  const env = opts.env ?? process.env;
  const air = new Airspace({
    home: opts.home ?? homedir(),
    windowMs: opts.windowMs ?? Number(env.TRACON_WINDOW_MIN ?? 30) * 60_000,
    tiers: opts.tiers ?? env.TRACON_TIERS,
    quota: opts.quota ?? env.TRACON_QUOTA,
    env,
  });
  const state = new State(opts.stateDir);
  state.secret(); // first start: create it, so `tracon hooks install` and the deck find it
  const pusher = new Pusher(state);
  const idle = opts.idle ?? idleSeconds;
  let mode: AwayMode = "auto";
  let away = false;

  const snap = (): string => {
    const decisions = broker.list();
    const now = Date.now();
    const s: Snapshot = { flights: air.tick(now, new Set(decisions.map((d) => d.callsign))), accounts: air.accounts(now), decisions, away: { mode, away } };
    return JSON.stringify(s);
  };
  // Each message is the whole airspace, so clients also learn when a flight leaves or a decision is answered elsewhere.
  let snapshot = "";
  const sockets: WebSocketServer[] = [];
  const refresh = () => {
    const next = snap();
    if (next === snapshot) return;
    snapshot = next;
    for (const w of sockets) for (const c of w.clients) c.send(snapshot);
  };
  const broker = new Decisions(() => refresh());
  snapshot = snap();

  const sweep = () => broker.sweep(Date.now(), (tp, tool, input) => air.waiting(tp, tool, input));
  const pushHeld = () => {
    if (away) for (const d of broker.unpushed()) void pusher.send(d);
  };
  const setAway = (next: boolean) => {
    if (away && !next) broker.release((d) => d.kind !== "permission"); // back at the keyboard: the terminal asks again
    away = next;
    pushHeld();
    refresh();
  };

  async function hook(req: IncomingMessage, res: ServerResponse) {
    let input: HookInput;
    try {
      input = await readBody(req);
    } catch {
      return json(res, 400, { error: "bad body" });
    }
    const kind = decisionKind(String(input?.hook_event_name), String(input?.tool_name));
    // Permission prompts race the terminal's own dialog, so they are always held; questions and plans block the terminal
    // until the hook replies, so they are held only while you are away.
    if (!kind || typeof input.session_id !== "string" || typeof input.transcript_path !== "string" || (kind !== "permission" && !away))
      return res.writeHead(200).end();
    res.writeHead(200, { "content-type": "application/json" }).flushHeaders();
    const beat = setInterval(() => res.write(" "), HEARTBEAT_MS);
    const d = broker.hold(input, kind, air.callsignFor(input.transcript_path, input.session_id), (body) => {
      clearInterval(beat);
      if (!res.writableEnded) res.end(body ? JSON.stringify(body) : "");
    });
    res.on("close", () => (clearInterval(beat), broker.drop(d.id)));
    sweep(); // holding refreshed the airspace, so the transcript already shows the call: mark it seen before you can answer at the terminal
    pushHeld();
  }

  async function api(path: string, url: URL, req: IncomingMessage, res: ServerResponse) {
    const post = req.method === "POST";
    if (path === "/api/flights") return res.writeHead(200, { "content-type": "application/json" }).end(snapshot);
    if (path === "/api/trace") {
      const nodes = air.trace(url.searchParams.get("flight") ?? "");
      return json(res, nodes ? 200 : 404, nodes ? { nodes } : { error: "unknown flight" });
    }
    if (path === "/api/push/key") return json(res, 200, { key: pusher.key() });
    if (!post) return json(res, 404, { error: "not found" });
    let body: any;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { error: "bad body" });
    }
    if (path === "/api/answer") {
      const r = broker.answer(body as Answer);
      return json(res, r === "ok" ? 200 : r === "gone" ? 409 : 400, { result: r });
    }
    if (path === "/api/away") {
      if (!MODES.has(body?.mode)) return json(res, 400, { error: "mode must be auto, on or off" });
      mode = body.mode;
      setAway(isAway(mode, await idle()));
      return json(res, 200, { mode, away });
    }
    if (path === "/api/push/subscribe") {
      const sub = parseSubscription(body);
      if (!sub) return json(res, 400, { error: "bad subscription" });
      pusher.subscribe(sub);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "not found" });
  }

  const localOk = (req: IncomingMessage) => state.secretOk(req.headers[SECRET_HEADER] as string | undefined);
  // The remote listener checks Host too (DNS rebinding): loopback, or the *.ts.net name `tailscale serve` forwards.
  // TRACON_REMOTE_HOST (comma-separated host names) replaces the .ts.net rule for another front end.
  const remoteHosts = env.TRACON_REMOTE_HOST?.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const hostOk = (remote: boolean, host = "") => {
    if (LOCAL_HOST.test(host)) return true;
    if (!remote) return false;
    const name = host.replace(/:\d+$/, "").toLowerCase();
    return remoteHosts?.length ? remoteHosts.includes(name) : /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(name);
  };
  // Top-level catch for every request: a throw answers 500 instead of leaving the client hanging. Claude Code treats a
  // non-2xx hook reply as no answer and asks at the terminal, so a broken engine fails open.
  const handler = (kind: Listener) => async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(kind, req, res);
    } catch (e) {
      console.error(`tracon: ${req.method} ${req.url} failed:`, e);
      if (!res.headersSent) json(res, 500, { error: "engine error" });
      else res.end();
    }
  };
  const route = async (kind: Listener, req: IncomingMessage, res: ServerResponse) => {
    const remote = kind === "remote";
    if (!hostOk(remote, req.headers.host)) return json(res, 403, { error: "foreign host" });
    const url = new URL(req.url ?? "/", "http://x");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: "bad path" });
    }
    if (kind === "hook") {
      // the hooks, and `tracon away`, so the CLI never sends the secret to whoever holds the TCP port
      const isHook = path.startsWith("/hook/");
      if (!(isHook || path === "/api/away") || req.method !== "POST" || req.headers.origin) return json(res, 404, { error: "not found" });
      // refused at once, before anything is held: `tracon hook` prints nothing and Claude Code asks at the terminal
      if (!localOk(req)) return json(res, 403, { error: "missing or wrong local secret: run tracon hooks install" });
      return isHook ? hook(req, res) : api(path, url, req, res);
    }
    if (path.startsWith("/hook/")) return json(res, 404, { error: "not found: the hooks moved to the engine's socket; run tracon hooks install" });
    if (path.startsWith("/api/")) {
      if (remote && !state.tokenOk(req.headers.authorization?.replace(/^Bearer /, ""))) return json(res, 401, { error: "pair this device: tracon pair" });
      if (!remote && req.method === "POST" && req.headers.origin && !LOCAL_ORIGIN.test(req.headers.origin)) return json(res, 403, { error: "foreign origin" });
      if (!remote && req.method === "POST" && !localOk(req)) return json(res, 403, { error: "missing or wrong local secret" });
      return api(path, url, req, res);
    }
    let file = opts.uiFiles ? (opts.uiFiles[path] ?? opts.uiFiles["/index.html"]) : resolve(uiDist, "." + path);
    if (!opts.uiFiles && (!file.startsWith(uiDist + sep) || !existsSync(file) || statSync(file).isDirectory())) file = join(uiDist, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "content-type": "text/plain" }).end("Flight Deck not built. Run: npm run build -w tracon-ui\n");
      return;
    }
    let body = readFileSync(file);
    // only the page served on the local port (Host already checked) carries the secret; the remote one never does
    if (!remote && extname(file) === ".html")
      body = Buffer.from(body.toString("utf8").replace("<head>", `<head><meta name="tracon-secret" content="${state.secret()}">`));
    // no site may frame the deck and trick a click on Allow; the local page carries the secret, so keep it out of the disk cache
    res
      .writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-security-policy": "frame-ancestors 'none'",
        "x-frame-options": "DENY",
        "x-content-type-options": "nosniff",
        ...(extname(file) === ".html" ? { "cache-control": "no-store" } : {}),
      })
      .end(body);
  };

  const servers: Server[] = [];
  /** Binds a port on 127.0.0.1, or a socket path; a port someone else holds rejects with a line that says so. */
  const bind = async (kind: Listener, at: number | string) => {
    const server = createServer(handler(kind));
    await new Promise<void>((ok, fail) => {
      server.once("error", (e: NodeJS.ErrnoException) =>
        fail(e.code === "EADDRINUSE" && typeof at === "number" ? Object.assign(new Error(`port ${at} is in use by another process (lsof -iTCP:${at})`), { code: e.code }) : e),
      );
      typeof at === "number" ? server.listen(at, "127.0.0.1", ok) : server.listen(at, ok);
    });
    servers.push(server);
    return server;
  };
  // the WebSocket server attaches after the bind: before it, ws re-emits a bind error where nothing catches it
  const web = async (remote: boolean, p: number) => {
    const server = await bind(remote ? "remote" : "local", p);
    const verifyClient = remote
      ? ({ req }: { req: IncomingMessage }) =>
          hostOk(true, req.headers.host) &&
          (offered(req).some((p) => state.tokenOk(p)) ||
            // shortcut: decks cached before the subprotocol still send ?t=<token>; drop this in the next release
            state.tokenOk(new URL(req.url ?? "/", "http://x").searchParams.get("t") ?? undefined))
      : ({ origin, req }: { origin?: string; req: IncomingMessage }) =>
          hostOk(false, req.headers.host) && (!origin || LOCAL_ORIGIN.test(origin)) && offered(req).some((p) => state.secretOk(p));
    // echo the fixed name, never the credential; a browser drops a socket whose offered protocols got no echo
    const handleProtocols = (protocols: Set<string>) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false);
    const wss = new WebSocketServer({ server, path: "/ws", verifyClient, handleProtocols });
    wss.on("connection", (ws) => ws.send(snapshot));
    sockets.push(wss);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  let url: string, remoteUrl: string;
  try {
    url = await web(false, port);
    remoteUrl = await web(true, opts.remotePort ?? 4041);
    await bind("hook", await state.freeSocket());
  } catch (e) {
    for (const w of sockets) w.close();
    for (const s of servers) s.close();
    throw e;
  }

  let pending: NodeJS.Timeout | undefined;
  const watchers = watchDirs(air.roots(), () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      try {
        refresh();
      } catch (e) {
        console.error("tracon: refresh failed:", e); // same guard as the poll: a watch event must not stop the engine
      }
    }, 150);
  });
  // the poll finds new profiles/sessions, moves time-based states (holding after 60s, leaving the window), reads the
  // keyboard idle time for auto-away, and lets go of permission prompts the terminal already answered
  const poll = setInterval(async () => {
    try {
      const next = isAway(mode, await idle());
      if (next !== away) setAway(next);
      sweep();
      refresh();
    } catch (e) {
      console.error("tracon: poll failed:", e); // an unreadable transcript must not stop the engine
    }
  }, 2000);

  return {
    url,
    remoteUrl,
    sock: state.sock,
    close: () => {
      clearInterval(poll);
      clearTimeout(pending);
      for (const w of watchers) w.close();
      broker.release();
      for (const w of sockets) w.close();
      for (const s of servers) s.close(); // closing the socket listener also removes engine.sock
    },
  };
}
