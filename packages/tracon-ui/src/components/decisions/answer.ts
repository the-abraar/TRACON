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

/** What a permission prompt is about: the command, file, URL or, failing those, the raw input. */
export function permissionTarget(d: Decision): string {
  const i = d.input as Record<string, unknown>;
  const v = i.command ?? i.file_path ?? i.url ?? i.pattern ?? i.path;
  return typeof v === "string" ? v : JSON.stringify(i, null, 1);
}
