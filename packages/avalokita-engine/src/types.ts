// FlightPacket is copied verbatim from PLAN.md section 3.3; the UI imports this file too.
export type FlightState = "preflight" | "cruising" | "tool_executing" | "holding" | "landed" | "aborted";
export type ToolAction = "read" | "write" | "bash" | "subagent" | "other";
export type AccountTier = "pro_20" | "team_100" | "api_usage" | "gemini";

export interface FlightPacket {
  id: string;
  timestamp: string;
  flightCallsign: string;
  accountTier: AccountTier;
  runtime: "claude-code" | "antigravity" | "opencode";
  pid?: number;
  cwd: string;
  flightState: FlightState;
  activeTool?: {
    name: string;
    action: ToolAction;
    targetFile?: string;
    details?: string;
  };
  subagents: {
    id: string;
    role: string;
    state: string;
  }[];
  fuelMetrics: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    burnRatePerMin: number;
    quotaPercentage?: number;
  };
  collisionWarning?: {
    conflictingFlight: string;
    sharedFile: string;
  };
}

/** One node of a flight's execution DAG (GET /api/trace?flight=<callsign>). Times are epoch ms; no `end` = still running. */
export interface TraceNode {
  id: string;
  kind: "turn" | "tool" | "subagent";
  label: string;
  /** the turn column this node belongs to (a turn's own id for turn nodes) */
  turn: string;
  /** edge source: previous turn, previous tool batch, or the spawning tool */
  parent?: string;
  start: number;
  end?: number;
  tokens?: number;
  action?: ToolAction;
  detail?: string;
}

/** What a parser extracts from one transcript line, independent of runtime. */
export type ParsedEvent =
  | { kind: "prompt"; ts: number; cwd?: string }
  | { kind: "thinking"; ts: number; cwd?: string; usage?: Usage }
  | { kind: "tool_use"; ts: number; cwd?: string; usage?: Usage; tools: ToolCall[] }
  | { kind: "tool_result"; ts: number; cwd?: string; toolUseIds: string[]; running?: boolean }
  | { kind: "turn_end"; ts: number; cwd?: string; usage?: Usage }
  | { kind: "holding"; ts: number; cwd?: string };

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Usage is keyed so the normalizer can drop repeats of one API response. */
export interface Usage {
  key: string;
  input: number;
  output: number;
}

/** A prompt a Claude Code hook holds open until a paired device answers it (POST /api/answer) or the terminal takes it back. */
export interface Decision {
  id: string;
  callsign: string;
  kind: "question" | "plan" | "permission";
  tool: string;
  /** the tool input as Claude Code sent it: AskUserQuestion questions, the ExitPlanMode plan, or the command/file to permit */
  input: Record<string, unknown>;
  cwd: string;
  createdAt: number;
}

export type Answer =
  | { id: string; kind: "question"; answers: Record<string, string> }
  | { id: string; kind: "plan"; approve: boolean; feedback?: string }
  | { id: string; kind: "permission"; allow: boolean; message?: string };

/** auto = away after 3 idle minutes at the Mac's keyboard and mouse; on/off pin it. */
export type AwayMode = "auto" | "on" | "off";

/** Every WebSocket message and GET /api/flights. */
export interface Snapshot {
  flights: FlightPacket[];
  decisions: Decision[];
  away: { mode: AwayMode; away: boolean };
}
