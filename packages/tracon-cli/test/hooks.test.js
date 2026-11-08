import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyHooks, hookCommand, hookGroups, sendHook, withHooks } from "../src/hooks.js";

// short base dir: a Unix socket path must stay under 104 bytes on macOS
const tmp = mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", "tracon-hooks-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const CMD = hookCommand(["/opt/homebrew/bin/node", "/x/tracon-cli/bin/tracon.js"]);

test("withHooks adds TRACON's groups once, keeps everyone else's, and removes cleanly", () => {
  const caveman = { matcher: "", hooks: [{ type: "command", command: "caveman" }] };
  const before = { env: { A: "1" }, hooks: { PreToolUse: [caveman], Stop: [caveman] } };
  const on = withHooks(before, CMD);
  assert.deepEqual(on.hooks.PreToolUse, [caveman, ...hookGroups(CMD).PreToolUse]);
  assert.deepEqual(on.hooks.PermissionRequest, hookGroups(CMD).PermissionRequest);
  assert.deepEqual(withHooks(on, CMD), on, "idempotent");
  assert.deepEqual(withHooks(on, hookCommand(["/elsewhere/tracon"])).hooks.PreToolUse.length, 2, "a new path replaces, not adds");
  assert.deepEqual(withHooks(on, undefined), before);
  assert.deepEqual(withHooks(withHooks({}, CMD), undefined), {});
});

test("the hooks are `tracon hook` commands that carry no secret; installing replaces the old HTTP hooks", () => {
  const hooks = (s) => [...s.hooks.PreToolUse, ...s.hooks.PermissionRequest].flatMap((g) => g.hooks);
  const on = withHooks({}, CMD);
  assert.deepEqual(
    hooks(on).map((h) => [h.type, h.command]),
    [
      ["command", `'/opt/homebrew/bin/node' '/x/tracon-cli/bin/tracon.js' hook pre-tool-use`],
      ["command", `'/opt/homebrew/bin/node' '/x/tracon-cli/bin/tracon.js' hook permission-request`],
    ],
  );
  assert.ok(hooks(on).every((h) => !h.headers && !h.url && h.timeout === 3600), "Claude Code must not kill a prompt held for minutes");
  assert.ok(!JSON.stringify(on).includes("secret"));
  const http = (path, headers) => ({ type: "http", url: `http://127.0.0.1:4040/hook/${path}`, ...(headers ? { headers } : {}), timeout: 3600 });
  const old = {
    hooks: {
      PreToolUse: [{ matcher: "AskUserQuestion|ExitPlanMode", hooks: [http("pre-tool-use", { "x-tracon-secret": "s1" })] }],
      PermissionRequest: [{ matcher: "*", hooks: [http("permission-request")] }],
    },
  };
  assert.deepEqual(withHooks(old, CMD), on);
  assert.deepEqual(withHooks(old, undefined), {}, "uninstall removes the old form too");
  assert.equal(hookCommand(["/a b/it's/tracon"], { TRACON_STATE: "/s t" }), `TRACON_STATE='/s t' '/a b/it'\\''s/tracon'`);
});

test("applyHooks backs up a changed settings.json and leaves broken or unchanged ones alone", () => {
  const a = join(tmp, ".claude-a"), b = join(tmp, ".claude-b"), c = join(tmp, ".claude-c"), bak = join(tmp, "bak");
  for (const d of [a, b, c]) mkdirSync(d);
  const original = JSON.stringify({ model: "x" }, null, 2) + "\n";
  writeFileSync(join(a, "settings.json"), original);
  writeFileSync(join(c, "settings.json"), "{oops");
  assert.deepEqual(applyHooks([a, b, c], CMD, bak, "T"), [`${a}: installed`, `${b}: installed`, `${c}: settings.json is not valid JSON, left alone`]);
  assert.deepEqual(readdirSync(bak), [".claude-a-settings-T.json"]);
  assert.equal(readFileSync(join(bak, ".claude-a-settings-T.json"), "utf8"), original);
  assert.deepEqual(applyHooks([a], CMD, bak, "T2"), [`${a}: unchanged`]);
  applyHooks([a], undefined, bak, "T3");
  assert.equal(readFileSync(join(a, "settings.json"), "utf8"), original, "uninstall restores the file");
});

test("applyHooks leaves settings.json readable only by you, like the engine's state files", () => {
  const fresh = join(tmp, ".claude-m1"), old = join(tmp, ".claude-m2"), same = join(tmp, ".claude-m3"), bak = join(tmp, "bak-m");
  for (const d of [fresh, old, same]) mkdirSync(d);
  writeFileSync(join(old, "settings.json"), "{}\n", { mode: 0o644 });
  writeFileSync(join(same, "settings.json"), JSON.stringify(withHooks({}, CMD), null, 2) + "\n");
  chmodSync(join(old, "settings.json"), 0o644);
  chmodSync(join(same, "settings.json"), 0o644);
  applyHooks([fresh, old, same], CMD, bak, "T");
  const mode = (d) => (statSync(join(d, "settings.json")).mode & 0o777).toString(8);
  assert.deepEqual([fresh, old, same].map(mode), ["600", "600", "600"], "new, rewritten and already-installed files are all 0600");
});

test("sendHook passes the engine's reply through, and gives up quietly when the engine can't answer", async () => {
  const sock = join(tmp, "e.sock");
  let seen;
  let mode = "answer";
  const srv = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c)).on("end", () => {
      seen = { path: req.url, secret: req.headers["x-tracon-secret"], body };
      if (mode === "answer") {
        res.writeHead(200).flushHeaders();
        res.write(" "); // heartbeat bytes before the JSON
        setTimeout(() => res.end(' {"ok":1}'), 50);
      } else if (mode === "refuse") res.writeHead(403).end('{"error":"x"}');
      else if (mode === "beat") {
        res.writeHead(200).flushHeaders();
        const t = setInterval(() => res.write(" "), 100);
        setTimeout(() => (clearInterval(t), res.end('{"late":1}')), 700);
      } // "silent": accept and never answer
    });
  });
  await new Promise((ok) => srv.listen(sock, ok));
  try {
    assert.equal(await sendHook(sock, "s1", "pre-tool-use", '{"a":1}'), '{"ok":1}');
    assert.deepEqual(seen, { path: "/hook/pre-tool-use", secret: "s1", body: '{"a":1}' });
    mode = "refuse";
    assert.equal(await sendHook(sock, "s1", "permission-request", "{}"), "", "a refusal leaves the prompt to the terminal");
    mode = "beat";
    assert.equal(await sendHook(sock, "s1", "pre-tool-use", "{}", 300), '{"late":1}', "heartbeats keep a long hold alive past the idle limit");
    mode = "silent";
    const t0 = Date.now();
    assert.equal(await sendHook(sock, "s1", "pre-tool-use", "{}", 300), "");
    assert.ok(Date.now() - t0 < 2000, "a silent engine is dropped after the idle limit");
    assert.equal(await sendHook(join(tmp, "missing.sock"), "s1", "pre-tool-use", "{}"), "", "no engine: nothing printed");
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
