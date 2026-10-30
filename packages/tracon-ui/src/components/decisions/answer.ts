import type { Answer, Decision } from "../../../../avalokita-engine/src/types.ts";

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export const questionsOf = (d: Decision): Question[] => (Array.isArray(d.input.questions) ? (d.input.questions as Question[]) : []);

/**
 * The answer to an AskUserQuestion from the picked labels and any "Other" text, joined the way Claude Code's own dialog
 * reports them ("Cheese, Olives"). Single-select: Other text replaces the pick. Undefined until every question is answered.
 */
export function questionAnswer(d: Decision, picked: Record<string, string[]>, other: Record<string, string>): Answer | undefined {
  const answers: Record<string, string> = {};
  for (const q of questionsOf(d)) {
    const o = other[q.question]?.trim() ?? "";
    const v = (q.multiSelect ? [...(picked[q.question] ?? []), o] : [o || picked[q.question]?.[0] || ""]).filter(Boolean).join(", ");
    if (!v) return undefined;
    answers[q.question] = v;
  }
  return Object.keys(answers).length ? { id: d.id, kind: "question", answers } : undefined;
}

/** What a permission prompt is about: the command, file, URL or, failing those, the raw input. MCP tools always show
 * their whole input, indented, since any field (not just a path) can matter. */
export function permissionTarget(d: Decision): string {
  const i = d.input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.url ?? i.pattern ?? i.path;
  return typeof v === "string" && !d.tool.startsWith("mcp__") ? v : JSON.stringify(i, null, 2);
}

/** What a Write would put in the file, so a phone never approves a blind file change; undefined for other tools. */
export function permissionBody(d: Decision): string | undefined {
  const i = d.input as Record<string, unknown>;
  return d.tool === "Write" && typeof i.content === "string" ? i.content : undefined;
}

export interface DiffLine {
  /** "@" heads each edit of a MultiEdit */
  op: " " | "-" | "+" | "@";
  text: string;
}

/** An Edit as diff lines, or a MultiEdit as one block per edit under an "@@ edit n of m" line; undefined for other tools.
 * A `replace_all` edit says so, since it changes every match, not just the one shown. */
export function permissionDiff(d: Decision): DiffLine[] | undefined {
  const i = d.input as Record<string, unknown>;
  const every = (e: Record<string, unknown>) => (e?.replace_all === true ? ", every match" : "");
  if (d.tool === "Edit") {
    const diff = editDiff(i);
    return diff && every(i) ? [{ op: "@", text: "@ edit" + every(i) }, ...diff] : diff;
  }
  if (d.tool !== "MultiEdit" || !Array.isArray(i.edits)) return undefined;
  const edits = i.edits as Record<string, unknown>[];
  const parts = edits.map(editDiff);
  if (parts.some((p) => !p)) return undefined; // a malformed edit, which Claude Code rejects anyway
  return parts.flatMap((p, n) => [{ op: "@" as const, text: `@ edit ${n + 1} of ${parts.length}${every(edits[n])}` }, ...p!]);
}

/** Lines shared at the start and end are context, the rest is removed then added. */
// shortcut: prefix/suffix match, not a full LCS, so scattered changes show as one block; use a diff library if that confuses.
function editDiff(i: Record<string, unknown>): DiffLine[] | undefined {
  if (typeof i?.old_string !== "string" || typeof i.new_string !== "string") return undefined;
  const a = i.old_string.split("\n");
  const b = i.new_string.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const lines = (op: DiffLine["op"], t: string[]) => t.map((text) => ({ op, text }));
  return [
    ...lines(" ", a.slice(0, head)),
    ...lines("-", a.slice(head, a.length - tail)),
    ...lines("+", b.slice(head, b.length - tail)),
    ...lines(" ", a.slice(a.length - tail)),
  ];
}
