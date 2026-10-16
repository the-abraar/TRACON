import type { Edge, Node } from "@xyflow/react";
import type { TraceNode } from "../../../../avalokita-engine/src/types.ts";

export const COL_W = 240;
export const ROW_H = 92;

export type DagNode = Node<{ node: TraceNode }, "trace">;

export const duration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;

/** One column per turn (turn on top, its tools and subagents below in order); turns chain left to right. */
export function layoutTrace(trace: TraceNode[]): { nodes: DagNode[]; edges: Edge[] } {
  const col = new Map<string, number>();
  const row = new Map<string, number>();
  const nodes = trace.map((n): DagNode => {
    if (!col.has(n.turn)) col.set(n.turn, col.size);
    const r = row.get(n.turn) ?? 0;
    row.set(n.turn, r + 1);
    return { id: n.id, type: "trace", position: { x: col.get(n.turn)! * COL_W, y: r * ROW_H }, data: { node: n } };
  });
  const byId = new Map(trace.map((n) => [n.id, n]));
  const edges = trace.flatMap((n): Edge[] => {
    if (!n.parent || !byId.has(n.parent)) return [];
    const across = n.kind === "turn"; // turn -> next turn runs sideways, everything else hangs down
    return [
      {
        id: `${n.parent}->${n.id}`,
        source: n.parent,
        target: n.id,
        sourceHandle: across ? "r" : "b",
        targetHandle: across ? "l" : "t",
        animated: n.end === undefined,
      },
    ];
  });
  return { nodes, edges };
}
