import type { Edge, Node } from "@xyflow/react";
import type { TraceNode } from "../../../../avalokita-engine/src/types.ts";

export const COL_W = 240;
export const ROW_H = 92;

/** `members`: the calls a grouped node stands for, oldest first. */
export type DagNode = Node<{ node: TraceNode; members?: TraceNode[] }, "trace">;

/** Shortest run of same-action calls that is folded into one node. */
export const MIN_GROUP = 3;

export const duration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;

/** Folds each run of MIN_GROUP or more back-to-back tool calls with one action (edits, bash, reads...) in a turn into one node. */
function groupRuns(trace: TraceNode[]): DagNode["data"][] {
  const out: DagNode["data"][] = [];
  for (let i = 0; i < trace.length; ) {
    const n = trace[i]!;
    let j = i + 1;
    if (n.kind === "tool") while (j < trace.length && trace[j]!.kind === "tool" && trace[j]!.turn === n.turn && trace[j]!.action === n.action) j++;
    const members = trace.slice(i, j);
    i = j;
    if (members.length < MIN_GROUP) {
      out.push(...members.map((node) => ({ node })));
      continue;
    }
    const files = new Set(members.map((m) => m.detail).filter(Boolean)).size;
    const ends = members.map((m) => m.end);
    const node: TraceNode = {
      id: `group-${n.id}`,
      kind: "tool",
      label: `${[...new Set(members.map((m) => m.label))].join(", ")} ×${members.length}`,
      turn: n.turn,
      ...(n.parent ? { parent: n.parent } : {}),
      start: Math.min(...members.map((m) => m.start)),
      ...(ends.every((e) => e !== undefined) ? { end: Math.max(...(ends as number[])) } : {}),
      ...(n.action ? { action: n.action } : {}),
    };
    if (n.action === "read" || n.action === "write") node.detail = `${files} file${files === 1 ? "" : "s"}`;
    out.push({ node, members });
  }
  return out;
}

/** One column per turn (turn on top, its tools and subagents below in order); turns chain left to right. */
export function layoutTrace(trace: TraceNode[]): { nodes: DagNode[]; edges: Edge[] } {
  const items = groupRuns(trace);
  // edges into a grouped call start at its group; edges between members of one group vanish
  const groupOf = new Map(items.flatMap((d) => (d.members ?? []).map((m) => [m.id, d.node.id] as const)));
  const col = new Map<string, number>();
  const row = new Map<string, number>();
  const nodes = items.map((d): DagNode => {
    const n = d.node;
    if (!col.has(n.turn)) col.set(n.turn, col.size);
    const r = row.get(n.turn) ?? 0;
    row.set(n.turn, r + 1);
    return { id: n.id, type: "trace", position: { x: col.get(n.turn)! * COL_W, y: r * ROW_H }, data: d };
  });
  const ids = new Set(items.map((d) => d.node.id));
  const edges = items.flatMap(({ node: n }): Edge[] => {
    const parent = n.parent === undefined ? undefined : (groupOf.get(n.parent) ?? n.parent);
    if (!parent || parent === n.id || !ids.has(parent)) return [];
    const across = n.kind === "turn"; // turn -> next turn runs sideways, everything else hangs down
    return [
      {
        id: `${parent}->${n.id}`,
        source: parent,
        target: n.id,
        sourceHandle: across ? "r" : "b",
        targetHandle: across ? "l" : "t",
        animated: n.end === undefined,
      },
    ];
  });
  return { nodes, edges };
}
