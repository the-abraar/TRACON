# AgentViz: Research Findings & Architectural Brainstorm

## Executive Summary

As AI-assisted software development transitions from single-turn chat prompts to autonomous multi-agent swarms (running parallel subagents, task planners, file editors, and sandbox executors), **observability has become the critical bottleneck**. Developers currently operate in a "terminal black box":
- Waiting for outputs without understanding agent trajectories.
- Missing costly runaway tool loops or duplicate tool invocations until limits are hit.
- Leaving agents idle for minutes or hours because a confirmation prompt (`[y/n]` or permission request) went unnoticed.
- Juggling multiple accounts (e.g., separate $20 Pro vs $100 Team accounts via aliases `claude-a`, `claude-b`, `claude-c`) and multiple runtimes (Claude Code, Google Antigravity `agy`, OpenCode) across different terminal windows with no unified overview.

**AgentViz** is designed to bridge this observability gap by uniting the best ideas from existing visualizers into a **single, ambient Mission Control** running locally on your machine.

---

## 1. Benchmark Analysis of Existing Visualizers

We evaluated 5 major projects and reference implementations across the AI coding agent ecosystem:

### 1.1 Agent Flow (`patoles/agent-flow`)
- **Core Concept**: Real-time interactive node graph visualizing Claude Code and Codex execution flows.
- **Key Capabilities**:
  - **Live DAG Graph**: Pan/zoom canvas showing root prompts, tool call chains, parallel subagent branching, and return flows.
  - **Token & Cost Attribution**: Breaks down token consumption and wall-clock time per task branch and session.
  - **File Attention Heatmaps**: Visually highlights which files agents read/write to most frequently.
  - **Transcript Replay**: Allows stepping through past JSONL event logs.
- **Data Ingestion Method**:
  - Native HTTP hook server (`npx agent-flow-app` or VS Code extension) that configures Claude Code hooks to stream structured JSON events with zero latency. Also supports historical session JSON/JSONL replays.
- **Limitations**:
  - Primarily assumes a single default configuration.
  - Lacks spatial presence/gamification (strictly technical graph view).
  - Can fail to automatically discover non-standard alias directories (`CLAUDE_CONFIG_DIR`).

### 1.2 Pixel Agents (`pixel-agents-hq/pixel-agents`)
- **Core Concept**: A retro 16-bit virtual office where coding agents are rendered as animated pixel-art characters.
- **Key Capabilities**:
  - **Spatial Gamification**: Agents sit at desks, wander between rooms, drink from water coolers, and type frantically at keyboards when executing writes.
  - **Dynamic Tool Animations**: Differentiates between reading files (holding a book/magnifying glass), writing code (typing at monitor), and running shell commands (terminal screen glow).
  - **Attention Triggers**: Pops up visual speech bubbles with optional audio chimes when an agent pauses or requests user permissions.
  - **Subagent Representation**: Dynamically spawns child characters that enter the office room when subagents are created and vanish upon completion.
  - **Dual Form Factor**: Runs as a VS Code extension panel and as a standalone web application (`npx pixel-agents`).
- **Data Ingestion Method**:
  - Non-invasive file tailer monitoring `~/.claude/` transcript `JSONL` logs in real time.
- **Limitations**:
  - Limited deep diagnostic metrics (no granular token cost DAG, no branch latency comparison).
  - Tied to standard Claude directories; lacks multi-engine abstraction for tools like Antigravity.

### 1.3 aiwatch / Subagent Viewer (`nyanko3141592/subagent-viewer`)
- **Core Concept**: A blazing-fast, terminal-native TUI (Terminal User Interface) written in Rust for real-time agent monitoring.
- **Key Capabilities**:
  - **Kanban-Style Multi-Project View**: Displays active projects as cards in a 2- or 3-column responsive terminal layout.
  - **Sub-Second Refresh**: 300ms polling cycle combined with OS file-change notifications.
  - **Input-Waiting Alert**: Highlights project borders in bright red and emits a terminal bell (`\a`) the instant an agent stops waiting for user input.
  - **Context Window Usage**: Real-time gauge of context window percentage consumed.
  - **Multi-Runtime Support**: Simultaneously tracks both **Claude Code** (`~/.claude/`) and **OpenCode** (`~/.local/share/opencode/`).
- **Data Ingestion Method**:
  - Direct file-system watching and JSON parsing of local session directories.
- **Limitations**:
  - Strictly text-based TUI (no spatial office visualization or visual graph trees).
  - Limited historical replay or branch diff analysis.

### 1.4 Session Character Visualizer / Blob Office (`Caffa/Session-Character-Visualizer`)
- **Core Concept**: An OpenCode plugin visualizing active AI sessions as cute colored blob characters in a web browser canvas.
- **Key Capabilities**:
  - **Orbital Subagent Physics**: Subagents are rendered as smaller colored blobs orbiting their parent agent blob like planetary satellites.
  - **Speech Bubbles**: Displays real-time status messages, active tools, and thoughts.
  - **Zero-Config Browser Auto-Launch**: Spawns a local HTML page connected via local plugin hooks.
- **Limitations**:
  - Tight coupling to OpenCode plugin APIs.
  - Minimal analytics, cost accounting, or historical log persistence.

### 1.5 Visualizing Subagents Skill (`WarrenZhu050413 / mcpmarket`)
- **Core Concept**: An agent skill / prompt instruction module that forces the LLM to structure and visualize its own subagent workflows.
- **Key Capabilities**:
  - **Pre-Execution ASCII DAG**: Before launching parallel tasks, the model outputs an ASCII dependency map outlining sequential vs parallel subagent execution.
  - **Post-Task HTML Synthesis**: Generates interactive HTML dashboards with Mermaid dependency graphs and collapsible cards summarizing subagent results.
- **Limitations**:
  - In-band LLM prompting rather than an ambient, independent background monitoring daemon.

---

## 2. The Custom Multi-Account & Multi-Engine Dilemma

### 2.1 The Multi-Account Reality
Power users frequently configure shell aliases to manage multiple Claude accounts (e.g. balancing $20/month Pro accounts, $100/month Team/Max tiers, or distinct API keys to overcome hourly rate limits):
```bash
# Typical user alias setup in ~/.zshrc or ~/.bashrc:
alias claude-a="CLAUDE_CONFIG_DIR=~/.claude-a claude"
alias claude-b="CLAUDE_CONFIG_DIR=~/.claude-b claude"
alias claude-c="CLAUDE_CONFIG_DIR=~/.claude-c claude"
```
When running these aliases concurrently:
- Each profile writes to its own isolated config directory (`~/.claude-a/projects/`, `~/.claude-b/projects/`, etc.).
- Existing visualizers hardcoded to `~/.claude/` fail to detect `claude-a` or `claude-b`.
- The user cannot easily see which account is near its quota ceiling or which account is waiting for approval across multiple background terminal tabs.

### 2.2 The Antigravity (`agy`) Runtime
Google Antigravity (`agy`) maintains its own isolated workspace and data directories:
- **Session Data**: Located at `~/.gemini/antigravity-cli/brain/<conversation-id>/`.
- **Transcripts**: Real-time event streams in `transcript.jsonl` (compact) and `transcript_full.jsonl` (full payload), logging tool calls, thinking steps, and subagent invocations.
- **Task Management**: Spawns background tasks (`task-XX`) with live log streams in `.system_generated/tasks/`.
- **Specialized Subagents**: Spawns subagents with distinct roles (e.g., `research`, `firestore-rules-author`, `flutter_a11y_agent`).

### 2.3 The Core Opportunity for AgentViz
AgentViz will act as a **universal aggregator** that scans the entire system for any active Claude profile (`~/.claude*`, environment variables, running processes) AND any active Antigravity session (`~/.gemini/antigravity-cli/brain/`), normalizing all events into a unified stream.

---

## 3. AgentViz Product Architecture

### 3.1 Architectural Flow

```
+-------------------------------------------------------------------------------+
|                             ACTIVE RUNTIMES                                   |
|                                                                               |
|   +-------------------+  +-------------------+  +--------------------------+  |
|   | claude-a ($20/mo) |  | claude-b ($100/mo)|  | Antigravity CLI (agy)    |  |
|   | ~/.claude-a/...   |  | ~/.claude-b/...   |  | ~/.gemini/antigravity... |  |
|   +---------+---------+  +---------+---------+  +------------+-------------+  |
+-------------|----------------------|-------------------------|----------------+
              |                      |                         |
              v                      v                         v
+-------------------------------------------------------------------------------+
|                      AGENTVIZ LOCAL INGESTION DAEMON                          |
|                                                                               |
|   - Auto-Discovery: Scans PIDs, ~/.claude*, CLAUDE_CONFIG_DIR, agy brain     |
|   - Low-overhead FSEvents / inotify file tailers                              |
|   - Optional lightweight HTTP Hook endpoint (:4040/events)                    |
|   - State Normalization Engine (Unified Agent Event Schema)                  |
+---------------------------------------+---------------------------------------+
                                        | WebSocket stream
                                        v
+-------------------------------------------------------------------------------+
|                        AGENTVIZ PRESENTATION LAYER                            |
|                                                                               |
|  +------------------------------+   +--------------------------------------+  |
|  |     VIEW 1: VIRTUAL OFFICE   |   |        VIEW 2: WAR ROOM (DAG)        |  |
|  |   - Pixel Art / Blob Canvas  |   |   - Interactive Execution Tree       |  |
|  |   - Desk per active Account  |   |   - Tool Call & Token Cost Trees     |  |
|  |   - Subagents orbiting/entry |   |   - Live File Attention Heatmap      |  |
|  |   - Speech Bubbles for Input |   |   - Rate Limit & Quota Burn Radar    |  |
|  +------------------------------+   +--------------------------------------+  |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  |                   SMART HUMAN-IN-THE-LOOP ALERTER                       |  |
|  |      macOS System Notifications | Audio Chimes | Terminal Bell (\a)     |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 4. Feature Synthesis: What to Build

### Feature 1: Fleet & Multi-Account Radar
- **Automatic Multi-Dir Discovery**: Automatically glob-watches `~/.claude*` and `~/.gemini/antigravity-cli/brain/`. Whenever you launch `claude-a` or `agy`, AgentViz automatically binds to the new session.
- **Account Badging & Quota Tracking**:
  - Badges each agent with its identity (e.g. `claude-a [Pro $20]`, `claude-b [Team $100]`, `agy [Gemini 3.8]`).
  - Estimates context window consumption and session token velocity.
  - Warns when an account is pacing too fast toward its rate-limit reset window.

### Feature 2: Dual-Mode UI ("The Office" vs "The War Room")
- **Mode 1: The Office (Ambient Gamified Screen)**
  - Retro pixel-art or clean 2D blob studio designed to stay open on a second monitor.
  - Each active CLI session occupies a designated desk with an account banner.
  - Subagents appear dynamically as satellite blobs or temporary coworkers.
  - Visual states:
    - 💤 **Idle / Pondering**: Gentle floating animation / sleeping zZz.
    - ⌨️ **Writing / Modifying**: Typing at workstation with animated sparkles.
    - 🔍 **Reading / Grepping**: Magnifying glass / book reading.
    - ⚙️ **Running Command**: Terminal window rendering command progress.
    - ⚠️ **Waiting for Confirmation**: Flashing exclamation / speech bubble.
- **Mode 2: The War Room (Deep Observability & DAG)**
  - Pan-and-zoom execution graph showing exact tool chains (`view_file` -> `run_command` -> `replace_file_content`).
  - Cost attribution per branch: Understand how many tokens and seconds each subagent spent.
  - File Attention Heatmap: Tree view of repository files with heat gradients indicating read/write intensity.
  - Multi-Agent Collision Warning: Alerts if `claude-a` and `agy` attempt to edit overlapping files in the same workspace.

### Feature 3: Smart Human-in-the-Loop Alerter
- Eliminates the silent downtime caused by waiting for permission:
  - Immediate macOS native notifications with click-to-focus on the specific terminal window.
  - Subtle audio feedback (retro chime or gentle alert).
  - Red border highlight around the waiting agent card/desk.

---

## 5. Technical Specifications & Recommended Tech Stack

| Component | Recommendation | Rationale |
| :--- | :--- | :--- |
| **Backend Daemon** | **Node.js (TypeScript)** or **Go** | Fast file tailing via native OS `fsevents`, trivial WebSocket broadcasting, zero external C dependencies. |
| **Log Watching** | `chokidar` or Go `fsnotify` | Monitors `~/.claude*/**/transcript*.jsonl` and `~/.gemini/antigravity-cli/brain/**/transcript*.jsonl`. |
| **Event Bus** | Local WebSocket Server (`ws://localhost:4040`) | Broadcasts normalized JSON events to web clients or TUI listeners. |
| **Frontend UI** | **Vite + React + Tailwind CSS** | Fast, component-rich ecosystem with robust canvas support. |
| **Office Canvas** | **PixiJS** or **HTML5 Canvas 2D** | Hardware-accelerated 60 FPS sprite rendering for pixel characters and animations. |
| **Graph Engine** | **@xyflow/react** (React Flow) | Production-grade pan/zoom node-graph engine for execution DAGs. |
| **Terminal Client** | Optional Rust/Go TUI (inspired by `aiwatch`) | For developers who prefer a pure tmux/terminal monitoring pane. |

---

## 6. Phased Implementation Roadmap

1. **Phase 1: Ingestion Engine & Unified Normalizer**
   - Create a watcher service that detects all Claude config paths (`~/.claude`, `~/.claude-*`) and Antigravity brain directories.
   - Parse raw `JSONL` transcripts into a standardized `AgentEvent` schema (session start, tool call start/finish, user prompt, waiting state, session complete).
   - Expose the live stream over local WebSockets.

2. **Phase 2: The War Room Dashboard (MVP UI)**
   - Build a web interface displaying active agent cards, account badges, real-time tool logs, and the React Flow execution DAG.
   - Implement the "Waiting for Approval" alert sound and notification system.

3. **Phase 3: The Gamified Office Layer**
   - Integrate a PixiJS pixel-art canvas displaying characters at desks mapped to active sessions.
   - Add animations for reading, writing, thinking, and subagent spawning.

4. **Phase 4: Advanced Fleet Analytics & Quota Monitor**
   - Add token burn rate calculators and rate limit pacing alerts for $20 vs $100 tiers.
   - Add multi-agent file collision detection.
