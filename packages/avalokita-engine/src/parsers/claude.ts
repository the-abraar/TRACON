import type { ParsedEvent, ToolCall, Usage } from "../types.ts";

// Claude Code writes one JSONL entry per content block; most entry types (mode, ai-title, attachments...) carry no flight signal.
// Subagent transcripts (subagents/agent-*.jsonl) mark every line isSidechain; older main transcripts mix such lines in.
export function parseClaudeLine(line: string, sidechain = false): ParsedEvent | null {
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || Boolean(o.isSidechain) !== sidechain) return null;
  const ts = Date.parse(o.timestamp);
  if (Number.isNaN(ts)) return null;
  const cwd = typeof o.cwd === "string" ? o.cwd : undefined;

  if (o.type === "system") {
    return o.subtype === "turn_duration" || o.subtype === "stop_hook_summary" ? { kind: "turn_end", ts, cwd } : null;
  }

  const content = o.message?.content;
  if (o.type === "user") {
    if (Array.isArray(content) && content.some((c: any) => c?.type === "tool_result")) {
      const toolUseIds = content.filter((c: any) => c?.type === "tool_result").map((c: any) => String(c.tool_use_id));
      return { kind: "tool_result", ts, cwd, toolUseIds };
    }
    if (o.isMeta) return null;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => c?.text ?? "").join("") : "";
    if (text.startsWith("[Request interrupted by user")) return { kind: "turn_end", ts, cwd };
    return { kind: "prompt", ts, cwd, text };
  }

  if (o.type === "assistant") {
    const m = o.message ?? {};
    const u = m.usage;
    const usage: Usage | undefined = u
      ? {
          key: String(m.id ?? o.requestId ?? o.uuid),
          // cache reads re-count the whole context every turn, so they are left out of fuel.
          input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
          output: u.output_tokens ?? 0,
        }
      : undefined;
    const tools: ToolCall[] = (Array.isArray(content) ? content : [])
      .filter((c: any) => c?.type === "tool_use")
      .map((c: any) => ({ id: String(c.id), name: String(c.name), input: c.input ?? {} }));
    if (tools.length) return { kind: "tool_use", ts, cwd, usage, tools };
    if (m.stop_reason === "end_turn" || m.stop_reason === "stop_sequence" || o.isApiErrorMessage) return { kind: "turn_end", ts, cwd, usage };
    return { kind: "thinking", ts, cwd, usage };
  }
  return null;
}
