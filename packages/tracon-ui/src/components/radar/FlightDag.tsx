import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FlightPacket, TraceNode } from "../../../../avalokita-engine/src/types.ts";
import { api } from "../../lib/remote.ts";
import { tokens } from "../fleet/FlightCard.tsx";
import { duration, layoutTrace, type DagNode } from "./layout.ts";

const TONE: Record<string, string> = {
  turn: "border-emerald-600 bg-emerald-950",
  read: "border-sky-700 bg-slate-900",
  write: "border-fuchsia-700 bg-slate-900",
  bash: "border-cyan-600 bg-slate-900",
  subagent: "border-indigo-500 bg-indigo-950",
  other: "border-slate-600 bg-slate-900",
};

function TraceBox({ data: { node: n } }: NodeProps<DagNode>) {
  const tone = TONE[n.kind === "tool" ? (n.action ?? "other") : n.kind];
  return (
    <div className={`w-52 rounded border px-2 py-1.5 font-mono text-[11px] text-slate-200 ${tone}`} title={n.detail ?? n.label}>
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="target" position={Position.Top} id="t" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{n.label}</span>
        {n.kind === "subagent" && <span className="text-[9px] text-indigo-300">SUBAGENT</span>}
      </div>
      {n.detail && <div className="truncate text-slate-400">{n.detail}</div>}
      <div className="mt-1 flex gap-1 text-[10px]">
        <span className={`rounded px-1 ${n.end === undefined ? "animate-pulse bg-amber-500/80 text-slate-950" : "bg-slate-800 text-slate-300"}`}>
          {n.end === undefined ? "running" : duration(n.end - n.start)}
        </span>
        {n.tokens !== undefined && <span className="rounded bg-slate-800 px-1 text-emerald-300">{tokens(n.tokens)} tok</span>}
      </div>
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </div>
  );
}

const nodeTypes = { trace: TraceBox };

/** Live execution DAG for one flight; refetched whenever the engine sends a new packet for it. */
export function FlightDag({ flight, onClose }: { flight: FlightPacket; onClose: () => void }) {
  const [trace, setTrace] = useState<TraceNode[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    api(`/api/trace?flight=${encodeURIComponent(flight.flightCallsign)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { nodes: TraceNode[] }) => live && (setTrace(d.nodes), setError(false)))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [flight.flightCallsign, flight.id]);

  const { nodes, edges } = useMemo(() => layoutTrace(trace ?? []), [trace]);
  // open zoomed on the six most recent nodes at a readable size; pan or the minimap reach the rest
  const focus = useMemo(() => nodes.toSorted((a, b) => a.data.node.start - b.data.node.start).slice(-6).map((n) => ({ id: n.id })), [nodes]);

  return (
    <section className="mb-4 rounded-lg border border-emerald-900/60 bg-slate-900/70" aria-label={`Execution DAG for ${flight.flightCallsign}`}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h2 className="truncate font-mono text-sm text-emerald-300">
          EXECUTION DAG · {flight.flightCallsign} <span className="text-slate-500">· {nodes.length} nodes</span>
        </h2>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Close DAG">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="h-[60vh]">
        {error ? (
          <p className="p-6 font-mono text-sm text-red-300">Could not load the trace for {flight.flightCallsign}.</p>
        ) : trace === undefined ? (
          <p className="p-6 font-mono text-sm text-slate-500">Loading trace...</p>
        ) : nodes.length === 0 ? (
          <p className="p-6 font-mono text-sm text-slate-500">No turns recorded for this flight yet.</p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            colorMode="dark"
            fitView
            fitViewOptions={{ nodes: focus, maxZoom: 1 }}
            minZoom={0.1}
            onlyRenderVisibleElements
            nodesDraggable={false}
            nodesConnectable={false}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="#10b981" className="max-sm:hidden" />
          </ReactFlow>
        )}
      </div>
    </section>
  );
}
