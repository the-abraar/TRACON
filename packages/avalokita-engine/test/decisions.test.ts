import assert from "node:assert/strict";
import { test } from "node:test";
import { isAway } from "../src/away.ts";
import { decisionKind, Decisions, HOLD_MAX_MS, hookReply, type HookInput } from "../src/decisions.ts";
import { parseSubscription, pushBody } from "../src/push.ts";
import type { Decision } from "../src/types.ts";

const questions = [
  { question: "Pick a color", header: "Color", multiSelect: false, options: [{ label: "Red" }, { label: "Blue" }] },
  { question: "Pick toppings", header: "Top", multiSelect: true, options: [{ label: "Cheese" }, { label: "Olives" }] },
];
const dec = (kind: Decision["kind"], tool: string, input: Record<string, unknown>): Decision => ({ id: "d1", callsign: "CL-T", kind, tool, input, cwd: "/w", createdAt: 0 });
const hook = (tool: string, input: Record<string, unknown>, event = "PreToolUse"): HookInput => ({ hook_event_name: event, session_id: "s", transcript_path: "/t.jsonl", cwd: "/w", tool_name: tool, tool_input: input });

test("decisionKind: questions and plans via PreToolUse, everything else via PermissionRequest", () => {
  assert.equal(decisionKind("PreToolUse", "AskUserQuestion"), "question");
  assert.equal(decisionKind("PreToolUse", "ExitPlanMode"), "plan");
  assert.equal(decisionKind("PreToolUse", "Bash"), undefined);
  assert.equal(decisionKind("PermissionRequest", "Bash"), "permission");
  assert.equal(decisionKind("PermissionRequest", "AskUserQuestion"), undefined);
  assert.equal(decisionKind("Stop", "Bash"), undefined);
});

test("hookReply: the three response shapes Claude Code accepts, and answers that do not fit", () => {
  const q = dec("question", "AskUserQuestion", { questions });
  assert.deepEqual(hookReply(q, { id: "d1", kind: "question", answers: { "Pick a color": "Blue", "Pick toppings": "Cheese, Olives", extra: "x" } }), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { questions, answers: { "Pick a color": "Blue", "Pick toppings": "Cheese, Olives" } } },
  });
  assert.equal(hookReply(q, { id: "d1", kind: "question", answers: { "Pick a color": "Blue" } }), undefined, "every question needs an answer");
  assert.equal(hookReply(q, { id: "d1", kind: "question", answers: { "Pick a color": "Blue", "Pick toppings": "  " } }), undefined);
  assert.equal(hookReply(q, { id: "d1", kind: "permission", allow: true }), undefined, "kind must match");

  const p = dec("plan", "ExitPlanMode", { plan: "# Plan" });
  assert.deepEqual(hookReply(p, { id: "d1", kind: "plan", approve: true }), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { plan: "# Plan" } } });
  assert.deepEqual(hookReply(p, { id: "d1", kind: "plan", approve: false, feedback: " use bye.txt " }), {
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "use bye.txt" },
  });

  const b = dec("permission", "Bash", { command: "ls" });
  assert.deepEqual(hookReply(b, { id: "d1", kind: "permission", allow: true }), { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } });
  assert.deepEqual(hookReply(b, { id: "d1", kind: "permission", allow: false }), {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message: "Denied from TRACON." } },
  });
});

test("broker: hold, answer once, release, drop, and the sweep", () => {
  const replies: (object | undefined)[] = [];
  let changes = 0;
  const b = new Decisions(() => changes++);
  const d = b.hold(hook("AskUserQuestion", { questions }), "question", "CL-T", (r) => replies.push(r), 1000);
  assert.equal(b.list().length, 1);
  assert.equal(b.answer({ id: d.id, kind: "question", answers: {} }), "invalid");
  assert.equal(b.list().length, 1, "an invalid answer keeps the hold");
  assert.equal(b.answer({ id: d.id, kind: "question", answers: { "Pick a color": "Red", "Pick toppings": "Olives" } }), "ok");
  assert.equal(b.answer({ id: d.id, kind: "question", answers: { "Pick a color": "Red", "Pick toppings": "Olives" } }), "gone");
  assert.equal(replies.length, 1);

  const plan = b.hold(hook("ExitPlanMode", { plan: "x" }), "plan", "CL-T", (r) => replies.push(r), 1000);
  const perm = b.hold(hook("Bash", { command: "ls" }, "PermissionRequest"), "permission", "CL-T", (r) => replies.push(r), 1000);
  assert.deepEqual(b.unpushed().map((x) => x.id), [plan.id, perm.id]);
  assert.deepEqual(b.unpushed(), []);
  b.release((x) => x.kind !== "permission");
  assert.equal(replies.at(-1), undefined, "release replies empty: the terminal asks");
  assert.deepEqual(b.list().map((x) => x.id), [perm.id]);

  // the permission is released only after the transcript showed it waiting and then answered at the terminal
  let waiting = false;
  b.sweep(2000, () => waiting);
  assert.equal(b.list().length, 1, "never seen waiting: keep it");
  waiting = true;
  b.sweep(3000, () => waiting);
  waiting = false;
  b.sweep(4000, () => waiting);
  assert.equal(b.list().length, 0);

  const old = b.hold(hook("AskUserQuestion", { questions }), "question", "CL-T", (r) => replies.push(r), 0);
  b.sweep(HOLD_MAX_MS + 1, () => true);
  assert.equal(b.answer({ id: old.id, kind: "question", answers: {} }), "gone", "expired before Claude Code's hook timeout");

  const gone = b.hold(hook("Bash", { command: "ls" }, "PermissionRequest"), "permission", "CL-T", () => assert.fail("no reply to a closed request"));
  b.drop(gone.id);
  assert.equal(b.list().length, 0);
  assert.ok(changes >= 8);
});

test("away: auto turns away after 3 idle minutes; on and off pin it", () => {
  assert.equal(isAway("auto", 179), false);
  assert.equal(isAway("auto", 180), true);
  assert.equal(isAway("auto", undefined), false);
  assert.equal(isAway("on", 0), true);
  assert.equal(isAway("off", 9999), false);
});

test("push: notification text per kind, and only well-formed https subscriptions", () => {
  assert.deepEqual(pushBody(dec("question", "AskUserQuestion", { questions })), { title: "CL-T needs you", body: "Pick a color", id: "d1" });
  assert.equal(pushBody(dec("plan", "ExitPlanMode", { plan: "\n# Plan: ship it\nmore" })).body, "Plan approval: Plan: ship it");
  assert.equal(pushBody(dec("permission", "Bash", { command: "rm -rf build" })).body, "Bash: rm -rf build");
  assert.equal(pushBody(dec("permission", "Edit", { file_path: "/a.ts", old_string: "x" })).body, "Edit: /a.ts");
  const keys = { p256dh: "k", auth: "a" };
  assert.deepEqual(parseSubscription({ endpoint: "https://push.example/1", keys, extra: 1 }), { endpoint: "https://push.example/1", keys });
  assert.equal(parseSubscription({ endpoint: "http://push.example/1", keys }), undefined);
  assert.equal(parseSubscription({ endpoint: "https://push.example/1" }), undefined);
});
