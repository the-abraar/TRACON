import type { ParsedEvent, ToolCall } from "../types.ts";

// agy stores some string args JSON-encoded ("\"/path\""); decode those so paths match the Claude side.
const unquote = (args: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(args).map(([k, v]) => {
      if (typeof v !== "string" || !/^".*"$/s.test(v)) return [k, v];
      try {
        return [k, JSON.parse(v)];
      } catch {
        return [k, v];
      }
    }),
  );

// Antigravity brain transcript.jsonl: one entry per step (USER_INPUT, PLANNER_RESPONSE, GENERIC tool output, SYSTEM_MESSAGE).
export function parseAgyLine(line: string): ParsedEvent | null {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const ts = Date.parse(o.created_at);
  if (Number.isNaN(ts)) return null;
  const status = String(o.status ?? "");

  // shortcut: no approval-wait entry exists in the local data, so any WAIT* status is assumed to mean holding; confirm against a real approval prompt.
  if (/WAIT/i.test(status)) return { kind: "holding", ts };

  switch (o.type) {
    case "USER_INPUT":
      return { kind: "prompt", ts, text: typeof o.content === "string" ? o.content : undefined };
    case "PLANNER_RESPONSE": {
      const usage = { key: `step-${o.step_index}`, input: o.input_tokens ?? 0, output: o.output_tokens ?? 0 };
      const tools: ToolCall[] = (o.tool_calls ?? []).map((t: any, i: number) => ({
        id: `${o.step_index}-${i}`,
        name: String(t.name),
        input: unquote(t.args ?? {}),
      }));
      const cwd = tools.map((t) => t.input.Cwd).find((c) => typeof c === "string") as string | undefined;
      return tools.length ? { kind: "tool_use", ts, cwd, usage, tools } : { kind: "turn_end", ts, usage };
    }
    case "GENERIC":
      // RUNNING means the tool is still executing; DONE/ERROR closes the oldest pending call.
      return status === "RUNNING" ? null : { kind: "tool_result", ts, toolUseIds: [] };
    default:
      return null;
  }
}
