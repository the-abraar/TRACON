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
  const on = withHooks(before, 4040);
  assert.deepEqual(on.hooks.PreToolUse, [caveman, ...hookGroups(4040).PreToolUse]);
  assert.deepEqual(on.hooks.PermissionRequest, hookGroups(4040).PermissionRequest);
  assert.deepEqual(withHooks(on, 4040), on, "idempotent");
  assert.deepEqual(withHooks(on, 5050).hooks.PreToolUse.length, 2, "a new port replaces, not adds");
  assert.deepEqual(withHooks(on, undefined), before);
  assert.deepEqual(withHooks(withHooks({}, 4040), undefined), {});
});

test("applyHooks backs up a changed settings.json and leaves broken or unchanged ones alone", () => {
  const a = join(tmp, ".claude-a"), b = join(tmp, ".claude-b"), c = join(tmp, ".claude-c"), bak = join(tmp, "bak");
  for (const d of [a, b, c]) mkdirSync(d);
  const original = JSON.stringify({ model: "x" }, null, 2) + "\n";
  writeFileSync(join(a, "settings.json"), original);
  writeFileSync(join(c, "settings.json"), "{oops");
  assert.deepEqual(applyHooks([a, b, c], 4040, bak, "T"), [`${a}: installed`, `${b}: installed`, `${c}: settings.json is not valid JSON, left alone`]);
  assert.deepEqual(readdirSync(bak), [".claude-a-settings-T.json"]);
  assert.equal(readFileSync(join(bak, ".claude-a-settings-T.json"), "utf8"), original);
  assert.deepEqual(applyHooks([a], 4040, bak, "T2"), [`${a}: unchanged`]);
  applyHooks([a], undefined, bak, "T3");
  assert.equal(readFileSync(join(a, "settings.json"), "utf8"), original, "uninstall restores the file");
});
