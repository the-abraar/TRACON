import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { applyHooks, hookGroups, withHooks } from "../src/hooks.js";

const tmp = mkdtempSync(join(tmpdir(), "tracon-hooks-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("withHooks adds TRACON's groups once, keeps everyone else's, and removes cleanly", () => {
  const caveman = { matcher: "", hooks: [{ type: "command", command: "caveman" }] };
  const before = { env: { A: "1" }, hooks: { PreToolUse: [caveman], Stop: [caveman] } };
  const on = withHooks(before, 4040, "s1");
  assert.deepEqual(on.hooks.PreToolUse, [caveman, ...hookGroups(4040, "s1").PreToolUse]);
  assert.deepEqual(on.hooks.PermissionRequest, hookGroups(4040, "s1").PermissionRequest);
  assert.deepEqual(withHooks(on, 4040, "s1"), on, "idempotent");
  assert.deepEqual(withHooks(on, 5050, "s1").hooks.PreToolUse.length, 2, "a new port replaces, not adds");
  assert.deepEqual(withHooks(on, undefined), before);
  assert.deepEqual(withHooks(withHooks({}, 4040, "s1"), undefined), {});
});

test("both hooks send the engine's local secret; re-installing rewrites an install from before it", () => {
  const sent = (s) => [...s.hooks.PreToolUse, ...s.hooks.PermissionRequest].flatMap((g) => g.hooks.map((h) => h.headers?.["x-tracon-secret"]));
  assert.deepEqual(sent(withHooks({}, 4040, "s1")), ["s1", "s1"]);
  const old = { url: "http://127.0.0.1:4040/hook/permission-request", type: "http", timeout: 3600 };
  const installedBefore = { hooks: { PermissionRequest: [{ matcher: "*", hooks: [old] }] } };
  assert.deepEqual(withHooks(installedBefore, 4040, "s1"), withHooks({}, 4040, "s1"));
  assert.deepEqual(sent(withHooks(withHooks({}, 4040, "s1"), 4040, "s2")), ["s2", "s2"], "a new secret replaces the old one");
});

test("applyHooks backs up a changed settings.json and leaves broken or unchanged ones alone", () => {
  const a = join(tmp, ".claude-a"), b = join(tmp, ".claude-b"), c = join(tmp, ".claude-c"), bak = join(tmp, "bak");
  for (const d of [a, b, c]) mkdirSync(d);
  const original = JSON.stringify({ model: "x" }, null, 2) + "\n";
  writeFileSync(join(a, "settings.json"), original);
  writeFileSync(join(c, "settings.json"), "{oops");
  assert.deepEqual(applyHooks([a, b, c], 4040, "s1", bak, "T"), [`${a}: installed`, `${b}: installed`, `${c}: settings.json is not valid JSON, left alone`]);
  assert.deepEqual(readdirSync(bak), [".claude-a-settings-T.json"]);
  assert.equal(readFileSync(join(bak, ".claude-a-settings-T.json"), "utf8"), original);
  assert.deepEqual(applyHooks([a], 4040, "s1", bak, "T2"), [`${a}: unchanged`]);
  applyHooks([a], undefined, undefined, bak, "T3");
  assert.equal(readFileSync(join(a, "settings.json"), "utf8"), original, "uninstall restores the file");
});
