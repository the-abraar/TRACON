# 📡 TRACON ATC: Master Implementation Plan & Engineering Spec

## 1. Project Identity & Philosophy

- **Product Name**: **TRACON ATC** (Short: **Tracon**)
- **Sub-Brand / Core Daemon**: **Avalokita Engine** (*The Thousand-Eyed Observer*)
- **Core Value Proposition**: Universal air traffic control for local AI coding agent fleets across multiple Claude accounts (`claude-a`, `claude-b`, `claude-c`), Antigravity (`agy`), and parallel terminal sessions.

---

## 2. System Architecture & Components

```
+----------------------------------------------------------------------------------------------------+
|                                      TRACON ATC ARCHITECTURE                                       |
+----------------------------------------------------------------------------------------------------+
                                                  │
          ┌───────────────────────────────────────┴────────────────────────────────────────┐
          ▼                                                                                ▼
+───────────────────────────────────+                            +───────────────────────────────────+
|     AVALOKITA ENGINE (DAEMON)     |                            |      TRACON FLIGHT DECK (UI)      |
+───────────────────────────────────+                            +───────────────────────────────────+
| 1. Airspace Scanner:              |                            | 1. Dual-View Mode Switcher:       |
|    - Watches ~/.claude*           |                            |    - Vector Radar (War Room DAG)  |
|    - Watches ~/.gemini/antigravity|                            |    - Ops Lounge (Pixel Office)    |
|    - Detects active PIDs / TTYs   |                            | 2. Fleet Radar Header:            |
| 2. File Tailer (fsevents):        |       WebSocket (:4040)    |    - Active flight badges         |
|    - Streams JSONL transcripts    | ─────────────────────────> |    - Quota & Burn rate gauges     |
| 3. Normalizer & Collision Engine: |                            | 3. Smart ATC Alerter:             |
|    - Maps to FlightEvents         |                            |    - Holding pattern notifications|
|    - Cross-agent file lock check  |                            |    - Audio transponder chime      |
+───────────────────────────────────+                            +───────────────────────────────────+
```

---

## 3. Data Ingestion: The Avalokita Telemetry Engine

### 3.1 Multi-Account Claude Ingestion
- **Target Directories**:
  - `~/.claude/projects/`
  - `~/.claude-*/projects/` (e.g., `~/.claude-a`, `~/.claude-b`, `~/.claude-c`)
  - Any path provided via `CLAUDE_CONFIG_DIR`
- **File Types**: `*.jsonl` transcript files.
- **Key Fields Parsed**:
  - Session ID, project root directory, model name.
  - User messages, assistant thinking turns, tool invocations (`ToolUse`), tool results (`ToolResult`).
  - Waiting-for-user state (`input_request`, permission confirmations).

### 3.2 Antigravity (`agy`) Ingestion
- **Target Directory**: `~/.gemini/antigravity-cli/brain/<conversation-id>/`
- **Files Parsed**:
  - `transcript.jsonl` (compact event stream) & `transcript_full.jsonl` (full payloads).
  - Background task status in `.system_generated/tasks/task-*.log`.
  - Subagent declarations and invocations (`invoke_subagent`, `define_subagent`).
- **Telemetry Mapping**:
  - Main Agent -> Primary Flight.
  - Subagent (`research`, `firestore-rules-author`, etc.) -> Escort / Sub-flight.
  - Background task -> Automated sortie.

### 3.3 Normalized Event Schema (`FlightPacket`)

```typescript
export interface FlightPacket {
  id: string;                      // Unique event UUID
  timestamp: string;               // ISO 8601
  flightCallsign: string;          // e.g. "CL-A", "CL-B", "AGY-01"
  accountTier: "pro_20" | "team_100" | "api_usage" | "gemini";
  runtime: "claude-code" | "antigravity" | "opencode";
  pid?: number;                    // Terminal process ID
  cwd: string;                     // Working repository path
  flightState: 
    | "preflight"                  // Initializing / prompt entered
    | "cruising"                   // Actively thinking / streaming
    | "tool_executing"             // File read/write, bash running
    | "holding"                    // WAITING FOR HUMAN INPUT / APPROVAL
    | "landed"                     // Task completed
    | "aborted";                   // Exited / failed
  activeTool?: {
    name: string;
    action: "read" | "write" | "bash" | "subagent" | "other";
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
```

---

## 4. Dual-View UI Specification

### View A: The Vector Radar ("War Room")
- **Tech Stack**: `@xyflow/react` (React Flow) + TailwindCSS + Lucide Icons.
- **Visuals**: Dark tactical theme, radar sweeps, flight vectors.
- **Core Modules**:
  1. **Airspace Overview**: Visual cards of all active flights with transponder squawks (`SQ-20`, `SQ-100`, `SQ-AGY`).
  2. **Live Execution DAG**: Interactive nodes representing turns, tools, and subagents with branch latency and token cost badges.
  3. **File Attention Heatmap**: Tree visualizer of the repository showing read/write intensity across all agents.
  4. **Collision Monitor (TCAS)**: Highlights in amber/red when two independent sessions touch the same file within a 5-minute window.

### View B: The Ops Lounge ("Pixel Office")
- **Tech Stack**: PixiJS hardware-accelerated 2D canvas.
- **Visuals**: 16-bit retro flight operations room.
- **Core Modules**:
  1. **Radar Consoles**: Each active flight sits at a designated retro workstation with their account badge above them.
  2. **Character State Machine**:
     - *Cruising/Thinking*: Pacing, looking at flight maps.
     - *Writing/Editing*: Typing furiously with neon particle effects.
     - *Running Shell*: Console screen glowing.
     - *Holding (Wait State)*: Pulsing exclamation speech bubble over character's head + alarm bell.
  3. **Subagent Drones**: Mini orbital characters hovering around the main desk when `invoke_subagent` is triggered.

---

## 5. Implementation Milestones

```mermaid
gantt
    title TRACON ATC Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1: Avalokita Engine
    Directory Scanner (~/.claude*, agy)       :p1_1, 2026-10-16, 2d
    fsevents Tailer & JSONL Parser            :p1_2, after p1_1, 2d
    WebSocket Server & Normalizer             :p1_3, after p1_2, 2d
    section Phase 2: Vector Radar Deck
    Fleet Bar & Quota Gauges                  :p2_1, after p1_3, 2d
    Interactive DAG (React Flow)              :p2_2, after p2_1, 3d
    Smart Alerter (Audio & macOS Notification):p2_3, after p2_2, 1d
    section Phase 3: Ops Lounge (Pixel)
    PixiJS Tile Engine & Sprites              :p3_1, after p2_3, 4d
    State Animation Mappings                  :p3_2, after p3_1, 3d
    section Phase 4: Airspace Safety
    TCAS File Collision Radar                 :p4_1, after p3_2, 2d
    Rate-Limit Burn Rate Forecasting          :p4_2, after p4_1, 2d
```

---

## 6. Directory Scaffolding Plan

```
agentviz/
├── README.md                      # Official Tracon Documentation
├── findings.md                    # Research benchmark & synthesis
├── package.json                   # Root workspace manifest
├── packages/
│   ├── avalokita-engine/          # Core Telemetry Ingestion Daemon
│   │   ├── src/
│   │   │   ├── scanners/          # Multi-Claude & Agy path discoverers
│   │   │   ├── tailers/           # fsevents file-watchers
│   │   │   ├── parsers/           # Claude & Antigravity JSONL parsers
│   │   │   ├── normalizer.ts      # Unified FlightPacket creator
│   │   │   ├── collision.ts       # File conflict detector (TCAS)
│   │   │   └── server.ts          # WebSocket server (:4040)
│   │   └── package.json
│   ├── tracon-ui/                 # Frontend Web Deck
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── radar/         # Vector Radar & DAG views
│   │   │   │   ├── lounge/        # PixiJS Pixel Office
│   │   │   │   ├── fleet/         # Flight cards & Quota meters
│   │   │   │   └── alerts/        # Holding pattern notifications
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   └── package.json
│   └── tracon-cli/                # Global CLI runner (`tracon start`)
│       ├── bin/tracon.js
│       └── package.json
```
