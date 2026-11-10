import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { hookCommand, withHooks } from "../src/hooks.js";
import { plist, plistPath } from "../src/service.js";

// `tracon doctor` on a fake HOME, with tailscale and launchctl stubbed on PATH; real git and plutil (macOS) read the fakes.
const mac = process.platform === "darwin";
const tmp = mkdtempSync(join(tmpdir(), "tracon-doctor-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const CLI = fileURLToPath(new URL("../bin/tracon.js", import.meta.url));
const SECRET = "s3cr3t-local-value", TOKEN = "t0ken-device-value", ENDPOINT = "https://push.example/endp0int-value";
const write = (f, s) => (mkdirSync(dirname(f), { recursive: true }), writeFileSync(f, s));
const serve = (status) =>
  new Promise((ok) => {
    const s = createServer((_q, r) => r.writeHead(status).end("{}")).listen(0, "127.0.0.1", () => ok(s));
  });
const stub = (dir, name, body) => (write(join(dir, name), `#!/bin/sh\n${body}\n`), chmodSync(join(dir, name), 0o755));

/** A fake HOME. healthy: every check passes; otherwise each check has something wrong. */
async function world(name, healthy) {
  const root = join(tmp, name), home = join(root, "home"), state = join(root, "state"), bin = join(root, "bin"), repo = join(root, "repo");
  const servers = healthy ? [await serve(200), await serve(401)] : [];
  const [port, remotePort] = healthy ? servers.map((s) => s.address().port) : [1, 2]; // nothing listens on 1 or 2
  after(() => servers.forEach((s) => s.close()));

  const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: "ignore" });
  mkdirSync(repo, { recursive: true });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "a");
  git("commit", "-q", "--allow-empty", "-m", "b");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  if (!healthy) git("checkout", "-q", "HEAD~1"); // one commit behind origin/main
  const prog = join(repo, "packages", "tracon-cli", "bin", "tracon.js");
  write(prog, "");

  const good = withHooks({}, hookCommand([process.execPath, prog]));
  write(join(home, ".claude", "settings.json"), JSON.stringify(good));
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  for (const [p, settings] of [
    ["A", healthy ? good : { hooks: { PreToolUse: [{ hooks: [{ type: "http", url: "http://127.0.0.1:4040/hook/pre-tool-use", headers: { "x-tracon-secret": SECRET } }] }] } }],
    ["B", healthy ? good : withHooks({}, hookCommand(["/gone/node", "/gone/tracon.js"]))],
  ]) {
    write(join(home, `.claude-${p.toLowerCase()}`, "settings.json"), JSON.stringify(settings));
    mkdirSync(join(home, `.claude-${p.toLowerCase()}`, "projects"), { recursive: true });
  }

  const mirror = join(root, "usage-a.md");
  if (healthy) write(mirror, `**5-hour window: 17% used.** Resets 2099-01-01 00:00 +06\n(epoch ${Math.floor(Date.now() / 1000) - 300})\n`);
  const vars = {
    TRACON_PORT: String(port),
    TRACON_REMOTE_PORT: String(remotePort),
    TRACON_STATE: state,
    TRACON_TIERS: healthy ? "A=max,B=team_100" : "A=max,B=platinum",
    TRACON_QUOTA: `A=${mirror}`,
  };
  write(plistPath(home), plist([process.execPath, prog, "start", "--no-open"], join(root, "log"), vars));
  if (healthy) {
    write(join(state, "secret"), SECRET + "\n");
    write(join(state, "token"), TOKEN + "\n");
    write(join(state, "subscriptions.json"), JSON.stringify([{ endpoint: ENDPOINT, keys: { auth: SECRET, p256dh: TOKEN } }]));
  }

  stub(bin, "launchctl", healthy ? 'printf "\\tstate = running\\n\\tpid = 42\\n"' : "exit 113");
  stub(bin, "tailscale", healthy ? `[ "$1" = status ] && echo '{"BackendState":"Running"}' || echo "|-- / proxy http://127.0.0.1:${remotePort}"` : `[ "$1" = status ] && echo '{"BackendState":"Stopped"}' || echo "No serve config"`);

  // the shell running doctor: no CLAUDE_CONFIG_DIR, and (when broken) a TRACON_PORT the plist doesn't have
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, ...vars, ...(healthy ? {} : { TRACON_PORT: "5999" }) };
  // async: the fake engine ports are served by this process
  const r = await new Promise((ok) => execFile(process.execPath, [CLI, "doctor"], { env, timeout: 30_000 }, (e, stdout, stderr) => ok({ status: e ? e.code : 0, stdout, stderr })));
  return { ...r, line: (check) => r.stdout.split("\n").find((l) => l.slice(5).startsWith(`${check}:`)) ?? `(no ${check} line)` };
}

test("doctor: a healthy setup is all ok and exits 0", { skip: !mac && "reads the plist with plutil" }, async () => {
  const r = await world("healthy", true);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const check of ["service", "plist env", "engine local", "engine remote", "engine code", "hooks ~/.claude", "hooks ~/.claude-a", "hooks ~/.claude-b", "secret", "pairing", "push", "tailscale", "tailscale serve", "usage ~/.claude-a", "tiers"])
    assert.match(r.line(check), /^ok /, check);
  assert.match(r.line("tiers"), /~\/\.claude-a=max, ~\/\.claude-b=team_100/);
  assert.match(r.line("push"), /1 device/);
  assert.match(r.line("usage ~/.claude"), /^warn .*no mirror/);
  for (const s of [SECRET, TOKEN, ENDPOINT]) assert.ok(!r.stdout.includes(s), "no secret, token or push endpoint in the output");
});

test("doctor: each broken part gets a FAIL line saying what to do, and exit 1", { skip: !mac && "reads the plist with plutil" }, async () => {
  const r = await world("broken", false);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const want = {
    service: /not loaded/,
    "plist env": /TRACON_PORT/,
    "engine local": /127\.0\.0\.1:1: /,
    "engine remote": /127\.0\.0\.1:2: /,
    "engine code": /1 commit\(s\) behind origin\/main/,
    "hooks ~/.claude-a": /old HTTP hook.*tracon hooks install/,
    "hooks ~/.claude-b": /\/gone\/node, which does not exist/,
    secret: /missing/,
    pairing: /tracon pair/,
    push: /no device subscribed/,
    tailscale: /Stopped/,
    "tailscale serve": /tailscale serve --bg/,
    "usage ~/.claude-a": /missing/,
    tiers: /B=platinum/,
  };
  for (const [check, re] of Object.entries(want)) assert.match(r.line(check), new RegExp(`^FAIL .*${re.source}`), check);
  assert.match(r.line("hooks ~/.claude"), /^ok /);
  assert.ok(!r.stdout.includes(SECRET), "the secret in an old settings.json is not echoed");
});
