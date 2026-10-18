import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
// your sessions or answering them. Claude Code's hook requests carry no Origin.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
// The local listener also checks Host: a DNS-rebinding page is same-origin with it and sends no foreign Origin on GET.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
// Every state-changing request to the local port carries the local secret (state.ts): the hooks send it from their
// settings, the deck gets it in its page, the CLI reads the file. A blind POST from another program gets 403.
// shortcut: a program running as you can read ~/.config/tracon/secret or fetch the deck's page, so this stops blind
// POSTs, not your own account; move the hooks and API to a Unix socket with peer checks if that ever matters.
const SECRET_HEADER = "x-tracon-secret";
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
  /** read for CLAUDE_CONFIG_DIR, TRACON_WINDOW_MIN, TRACON_TIERS, TRACON_QUOTA */
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

const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

/**
 * Avalokita Engine. Local listener (127.0.0.1:<port>): the Flight Deck, /api/*, /ws and the Claude Code hooks at /hook/*.
 * Remote listener (127.0.0.1:<remotePort>, published by `tailscale serve`): the same deck and API behind the device
 * token, never /hook/*.
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
    const s: Snapshot = { flights: air.tick(Date.now(), new Set(decisions.map((d) => d.callsign))), decisions, away: { mode, away } };
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
    const d = broker.hold(input, kind, air.callsignFor(input.transcript_path, input.session_id), (body) => {
      if (!res.writableEnded) body ? json(res, 200, body) : res.writeHead(200).end();
    });
    res.on("close", () => broker.drop(d.id));
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
  const handler = (remote: boolean) => (req: IncomingMessage, res: ServerResponse) => {
    if (!remote && !LOCAL_HOST.test(req.headers.host ?? "")) return json(res, 403, { error: "foreign host" });
    const url = new URL(req.url ?? "/", "http://x");
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return json(res, 400, { error: "bad path" });
    }
    if (path.startsWith("/hook/")) {
      if (remote || req.method !== "POST" || req.headers.origin) return json(res, 404, { error: "not found" });
      // refused at once, before anything is held: Claude Code treats a non-2xx reply as no answer and asks at the terminal
      if (!localOk(req)) return json(res, 403, { error: "missing or wrong local secret: run tracon hooks install" });
      return void hook(req, res);
    }
    if (path.startsWith("/api/")) {
      if (remote && !state.tokenOk(req.headers.authorization?.replace(/^Bearer /, ""))) return json(res, 401, { error: "pair this device: tracon pair" });
      if (!remote && req.method === "POST" && req.headers.origin && !LOCAL_ORIGIN.test(req.headers.origin)) return json(res, 403, { error: "foreign origin" });
      if (!remote && req.method === "POST" && !localOk(req)) return json(res, 403, { error: "missing or wrong local secret" });
      return void api(path, url, req, res);
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
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  };

  const listen = async (remote: boolean, p: number) => {
    const server = createServer(handler(remote));
    const verifyClient = remote
      ? (info: { req: IncomingMessage }) => state.tokenOk(new URL(info.req.url ?? "/", "http://x").searchParams.get("t") ?? undefined)
      : (info: { origin?: string; req: IncomingMessage }) =>
          LOCAL_HOST.test(info.req.headers.host ?? "") && (!info.origin || LOCAL_ORIGIN.test(info.origin));
    const wss = new WebSocketServer({ server, path: "/ws", verifyClient });
    wss.on("connection", (ws) => ws.send(snapshot));
    sockets.push(wss);
    await new Promise<void>((ok, fail) => server.once("error", fail).listen(p, "127.0.0.1", ok));
    return { server, wss, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  const local = await listen(false, port);
  const remote = await listen(true, opts.remotePort ?? 4041);

  let pending: NodeJS.Timeout | undefined;
  const watchers = watchDirs(air.roots(), () => {
    clearTimeout(pending);
    pending = setTimeout(refresh, 150);
  });
  // the poll finds new profiles/sessions, moves time-based states (holding after 60s, leaving the window), reads the
  // keyboard idle time for auto-away, and lets go of permission prompts the terminal already answered
  const poll = setInterval(async () => {
    const next = isAway(mode, await idle());
    if (next !== away) setAway(next);
    sweep();
    refresh();
  }, 2000);

  return {
    url: local.url,
    remoteUrl: remote.url,
    close: () => {
      clearInterval(poll);
      clearTimeout(pending);
      for (const w of watchers) w.close();
      broker.release();
      for (const s of [local, remote]) {
        s.wss.close();
        s.server.close();
      }
    },
  };
}
