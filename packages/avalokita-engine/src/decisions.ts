import { randomUUID } from "node:crypto";
import type { Answer, Decision } from "./types.ts";

/** The fields of a Claude Code hook body that the broker uses. */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  transcript_path: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/** Claude Code's hook timeout is 3600 s (`tracon hooks install`); replying first hands the prompt back to the terminal. */
export const HOLD_MAX_MS = 3_500_000;
const MAX_TEXT = 4000;

/** Which hook calls the broker holds. AskUserQuestion and ExitPlanMode come through PreToolUse only. */
export function decisionKind(event: string, tool: string): Decision["kind"] | undefined {
  if (event === "PreToolUse") return tool === "AskUserQuestion" ? "question" : tool === "ExitPlanMode" ? "plan" : undefined;
  if (event === "PermissionRequest" && tool !== "AskUserQuestion" && tool !== "ExitPlanMode") return "permission";
}

const pre = (permissionDecision: "allow" | "deny", rest: object) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, ...rest } });
const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, MAX_TEXT) : fallback);

/** The hook response that answers `d`, or undefined when `a` does not fit it. Shapes verified against Claude Code 2.1.302. */
export function hookReply(d: Decision, a: Answer): object | undefined {
  if (a.kind !== d.kind) return undefined;
  if (a.kind === "question") {
    const qs = Array.isArray(d.input.questions) ? (d.input.questions as { question: string }[]) : [];
    const answers: Record<string, string> = {};
    // an option label, several joined by ", " (multiSelect), or free "Other" text: Claude Code takes them all as given
    for (const q of qs) answers[q.question] = text(a.answers?.[q.question], "");
    if (!qs.length || Object.values(answers).some((v) => !v)) return undefined;
    return pre("allow", { updatedInput: { ...d.input, answers } });
  }
  if (a.kind === "plan") return a.approve ? pre("allow", { updatedInput: d.input }) : pre("deny", { permissionDecisionReason: text(a.feedback, "Plan rejected from TRACON.") });
  const decision = a.allow ? { behavior: "allow" } : { behavior: "deny", message: text(a.message, "Denied from TRACON.") };
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision } };
}

interface Held {
  d: Decision;
  transcriptPath: string;
  /** undefined = empty 200, which leaves the prompt to the terminal */
  reply: (body?: object) => void;
  /** the transcript has shown this permission's tool call still waiting */
  seen: boolean;
  pushed: boolean;
}

/** Hook calls held open for a remote answer. Every change calls onChange so the snapshot goes out. */
export class Decisions {
  private held = new Map<string, Held>();
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  hold(input: HookInput, kind: Decision["kind"], callsign: string, reply: Held["reply"], now = Date.now()): Decision {
    const d: Decision = { id: randomUUID(), callsign, kind, tool: input.tool_name, input: input.tool_input ?? {}, cwd: input.cwd ?? "", createdAt: now };
    this.held.set(d.id, { d, transcriptPath: input.transcript_path, reply, seen: false, pushed: false });
    this.onChange();
    return d;
  }

  answer(a: Answer): "ok" | "gone" | "invalid" {
    const h = this.held.get(a?.id);
    if (!h) return "gone";
    const body = hookReply(h.d, a);
    if (!body) return "invalid";
    this.finish(h, body);
    return "ok";
  }

  /** Hands matching prompts back to the terminal. */
  release(pick: (d: Decision) => boolean = () => true): void {
    for (const h of [...this.held.values()]) if (pick(h.d)) this.finish(h);
  }

  /** Claude Code dropped the request (session closed): forget it without replying. */
  drop(id: string): void {
    if (this.held.delete(id)) this.onChange();
  }

  list(): Decision[] {
    return [...this.held.values()].map((h) => h.d);
  }

  /** Not yet pushed to devices; marks them pushed. */
  unpushed(): Decision[] {
    const out = [...this.held.values()].filter((h) => !h.pushed);
    for (const h of out) h.pushed = true;
    return out.map((h) => h.d);
  }

  /**
   * Releases holds past HOLD_MAX_MS, and permission holds the terminal already answered: Claude Code shows its own dialog
   * alongside a PermissionRequest hook and does not cancel the hook when you answer there, so the transcript is the only
   * sign. `waiting` says whether the transcript shows the call still unanswered; a hold is released once it was and no longer is.
   */
  sweep(now: number, waiting: (transcriptPath: string, tool: string, input: Record<string, unknown>) => boolean): void {
    for (const h of [...this.held.values()]) {
      if (now - h.d.createdAt > HOLD_MAX_MS) {
        this.finish(h);
        continue;
      }
      if (h.d.kind !== "permission") continue;
      if (waiting(h.transcriptPath, h.d.tool, h.d.input)) h.seen = true;
      else if (h.seen) this.finish(h);
    }
  }

  private finish(h: Held, body?: object): void {
    this.held.delete(h.d.id);
    h.reply(body);
    this.onChange();
  }
}
