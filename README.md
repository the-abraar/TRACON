# 📡 TRACON ATC

<div align="center">

```
  ████████╗██████╗  █████╗  ██████╗ ██████╗ ███╗   ██╗     █████╗ ████████╗ ██████╗
  ╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔═══██╗████╗  ██║    ██╔══██╗╚══██╔══╝██╔════╝
     ██║   ██████╔╝███████║██║     ██║   ██║██╔██╗ ██║    ███████║   ██║   ██║     
     ██║   ██╔══██╗██╔══██║██║     ██║   ██║██║╚██╗██║    ██╔══██║   ██║   ██║     
     ██║   ██║  ██║██║  ██║╚██████╗╚██████╔╝██║ ╚████║    ██║  ██║   ██║   ╚██████╗
     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝    ╚═╝  ╚═╝   ╚═╝    ╚═════╝
```

### **Terminal Radar Approach Control for Autonomous AI Agent Fleets**
*Powered by the **Avalokita Telemetry Engine** — The Thousand-Eyed Observer.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status: Phase 2](https://img.shields.io/badge/Status-Phase_2_(engine_%2B_radar_deck)-yellow.svg)](judge.md)
[![Platform: macOS / Linux](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-black.svg)]()

</div>

---

## 🧭 Overview

**TRACON ATC** (short name: **Tracon**) is an ambient developer mission control system that transforms the chaotic, invisible execution of local AI coding agents into an intuitive, real-time radar control room.

Modern developers no longer run a single AI chat session. They operate **swarms**:
- Multiple Claude Code profiles (`claude-a` on a personal $20 Pro plan, `claude-b` on a $100 Team account, `claude-c` on pay-as-you-go API keys).
- Autonomous Google Antigravity (`agy`) swarms orchestrating parallel background subagents, sandbox tasks, and security reviewers.
- Multiple terminal tabs executing tool calls, file writes, and code inspections simultaneously.

Without radar, you are flying blind in unmonitored airspace. Agents sit idle for hours trapped in unseen confirmation prompts (`[y/n]`), file write collisions go unnoticed until git merge conflicts erupt, and token budgets burn invisibly.

**Tracon sweeps your laptop's airspace in real time, bringing tactical clarity and philosophical calm to agent orchestration.**

---

## 👁️ The Avalokita Telemetry Engine

At the core of Tracon sits the **Avalokita Engine**, named after *Avalokiteśvara* (Sanskrit: अवलोकित, *"The Thousand-Eyed Observer"* who watches across all realms simultaneously with unwavering attention).

```
                      ┌──────────────────────────────────────┐
                      │       AVALOKITA TELEMETRY ENGINE     │
                      │     "The Thousand-Eyed Observer"     │
                      └──────────────────┬───────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  [ Eye 001..099 ]                 [ Eye 100..199 ]                 [ Eye 200..999 ]
 Claude Multi-Profile             Antigravity (`agy`)               System Process
   Directory Watcher                Brain Transcripts                 Radar & Locks
 (~/.claude*, custom dirs)        (~/.gemini/antigravity-cli)       (PIDs, FSEvents)
```

The Avalokita Engine is a small read-only background process that:
1. **Watches**: Tails every Claude Code profile's session transcripts (`~/.claude*/projects/**/*.jsonl`), Claude Code's live-session pid files, and Antigravity brain transcripts, through FSEvents plus a 2-second poll. It never writes to those directories and needs no changes to your CLI tools.
2. **Normalizes**: Converts Claude Code and Antigravity events into one `FlightPacket` per session (schema in PLAN.md section 3.3).
3. **Broadcasts**: Pushes the whole airspace as `{"flights": FlightPacket[]}` over `ws://127.0.0.1:4040/ws` whenever it changes, and serves the same snapshot at `GET /api/flights`.
4. **Traces**: Keeps a bounded execution DAG per flight (the last 40 turns, up to 100 tool calls each) and serves it on demand at `GET /api/trace?flight=<callsign>` as `{"nodes": TraceNode[]}` (schema in `packages/avalokita-engine/src/types.ts`).

---

## 🛫 Aviation Metaphor & Core Concepts

Tracon maps the chaos of multi-agent development directly to airport radar operations:

| Aviation Concept | Agent Equivalent in Tracon |
| :--- | :--- |
| **Aircraft (Flight)** | An active agent CLI session (e.g. `Flight CL-A`, `Flight CL-B`, `Flight AGY-01`). |
| **Transponder / Squawk Code** | The identity tag distinguishing accounts (e.g. `Squawk 20` for Pro vs `Squawk 100` for Max). |
| **Drones / Escort Craft** | Subagents spawned by a parent agent (e.g. an `agy` `research` subagent). |
| **Holding Pattern** ⚠️ | An agent blocked waiting for human input, approval, or bash confirmation (`y/n`). |
| **Fuel Gauge / Burn Rate** | Token usage velocity and pacing toward hourly/daily rate-limit exhaustion. |
| **Bingo Fuel Warning** 🚨 | Quota alert when an account approaches rate-limit ceiling. |
| **TCAS / Collision Alert** ⚡ | Warning triggered when two independent agents attempt to modify the same file or worktree. |
| **Touchdown / Landed** ✅ | Task successfully completed, tests passing, or Pull Request opened. |

---

## 🎛️ Dual-Interface Experience (planned)

Built today: the fleet radar (one live card per session), the per-flight Execution DAG with latency and token badges, Holding Pattern alerts (chime plus system notification), TCAS file-collision warnings, and a quota gauge fed by a status-line usage mirror (`TRACON_QUOTA`). The File Attention Heatmap, Branch Cost diffs, the Ops Lounge and Bingo Fuel forecasting below are not built yet (see [judge.md](judge.md)).

Tracon features a dual-mode presentation layer suited for both deep technical analysis and ambient side-monitor awareness:

### Mode 1: The Vector Radar ("War Room")
*Inspired by high-tech air traffic control displays and Agent Flow.*
- **Live Flight Screen**: Real-time vector radar showing active agent nodes, subagent branches, and data flows.
- **Execution DAG**: Interactive pan/zoom tree tracing exact sequences of prompts, tool calls, and outputs.
- **Branch Cost Trees**: Click into any flight path to see exact duration, token cost, and tool payload diffs.
- **File Attention Heatmap**: 2D tree map of your workspace showing which files are being swept or modified by which agent.

### Mode 2: The Ops Lounge ("Pixel Office")
*Inspired by Pixel Agents and retro simulation games.*
- **Ambient Pixel Art**: A 16-bit retro flight operations room designed to sit on a side display.
- **Desk per Account**: `claude-a`, `claude-b`, and `agy` have dedicated radar consoles and distinctive character sprites.
- **Dynamic Action Sprites**: Characters type frantically during code generation, study charts during file search, and pace nervously during long tests.
- **Speech Bubbles & Audio Chimes**: Instant visual and acoustic cues the moment an aircraft enters a *Holding Pattern* (waiting for your input).

---

## 🏗️ Technical Architecture

Target architecture. Built today: scanner, tailer, normalizer, WebSocket/REST server, the fleet cards, the execution DAG, the holding alerter, the TCAS collision detector (`collision.ts`) and the quota reader (`quota.ts`). Not built: burn-rate forecasting and the Ops Lounge. Layout: `packages/avalokita-engine` (engine), `packages/tracon-ui` (Flight Deck), `packages/tracon-cli` (`tracon start | status`).

```mermaid
flowchart TD
    subgraph Airspace ["Local Airspace (Your Mac)"]
        CA["claude-a (Personal $20/mo)<br>CLAUDE_CONFIG_DIR=~/.claude-a"]
        CB["claude-b (Team $100/mo)<br>CLAUDE_CONFIG_DIR=~/.claude-b"]
        CC["claude-c (API Tokens)<br>ANTHROPIC_API_KEY=..."]
        AGY["Antigravity CLI (agy)<br>~/.gemini/antigravity-cli/brain/"]
    end

    subgraph AvalokitaEngine ["Avalokita Telemetry Engine (Daemon)"]
        Scanner["Multi-Directory Scanner<br>(Glob ~/.claude*, agy brain)"]
        FSEvents["OS Event Tailer (fsevents)<br>(Zero-CPU JSONL Streaming)"]
        Collision["TCAS Collision Detector<br>(Cross-Session File Lock Monitor)"]
        Fuel["Fuel / Quota Calculator<br>(Token Velocity & Limit Pacing)"]
        Norm["Unified Telemetry Normalizer<br>(Standardized FlightPackets)"]
    end

    subgraph ServerLayer ["Tracon Server"]
        WS["WebSocket Server (:4040/ws)"]
        API["REST / State API (:4040/api)"]
    end

    subgraph VisualDeck ["Tracon Flight Deck (UI)"]
        RadarUI["📡 Vector Radar View<br>(DAG Execution Graph & Heatmaps)"]
        OfficeUI["🎮 Ops Lounge View<br>(Pixel Art Office & Subagent Sprites)"]
        Alerter["🔔 Smart ATC Alerter<br>(macOS Notifications & Audio Chimes)"]
    end

    CA --> Scanner
    CB --> Scanner
    CC --> Scanner
    AGY --> Scanner

    CA -.-> FSEvents
    CB -.-> FSEvents
    AGY -.-> FSEvents

    Scanner --> Collision
    FSEvents --> Norm
    Collision --> Norm
    Fuel --> Norm

    Norm --> WS
    Norm --> API

    WS --> RadarUI
    WS --> OfficeUI
    WS --> Alerter
```

---

## ⚡ Quick Start

Needs Node.js 23.6 or newer (the engine is TypeScript run by Node's type stripping). Not published to npm or Homebrew; run it from the repo.

```bash
npm ci
npm start                                      # builds the UI, starts the engine on 127.0.0.1:4040, opens the Flight Deck
node packages/tracon-cli/bin/tracon.js status  # terminal snapshot from a running engine
scripts/check.sh                               # typecheck, read-only guard, tests, UI build (--fast: skip tests and build)
```

`npm start` keeps running in the foreground; stop it with Ctrl-C. `tracon start --no-open` skips opening the browser.

### Using the Flight Deck

- **Fleet bar**: flights on the radar, how many are airborne or holding, and the total burn rate.
- **Flight cards**: one per session active in the last 30 minutes (or with a live pid): callsign, squawk (plan), state, the tool in flight, subagents, burn rate and token totals. A holding flight pulses amber.
- **VIEW DAG**: opens that flight's execution DAG above the cards. Each turn is a column (turns chain left to right); its tool calls hang below in order, parallel calls fan out from the same parent, and Claude subagents hang off the `Agent`/`Task` call that spawned them. Badges show latency (or `running`) and tokens per turn and subagent. Pan, zoom and the minimap reach older turns; hover a node for its full path or command. The DAG refreshes whenever the engine sends a new packet for that flight.
- **ALERTS**: off by default. Click it once to allow the chime and notifications (the browser asks for notification permission). From then on, a flight that enters holding plays a two-tone chime and shows a system notification, at most once per flight every 2 minutes. The tab title always shows the holding count, e.g. `(1) HOLDING · TRACON ATC`. Alerts need the Flight Deck tab open (it can be in the background); after a reload, the chime starts working again on your first click on the page.

Optional environment variables:
- `TRACON_TIERS="BIZ=team_100,WORK=api_usage"`: the plan behind each Claude profile (suffix of `~/.claude-<suffix>`; `""` is `~/.claude`). Unlisted profiles show as `pro_20`.
- `TRACON_QUOTA="HAT=/path/usage.md"`: a usage mirror per profile, in the format `~/.claude-hat/statusline-usage.py` writes. The card's QUOTA gauge shows its 5-hour percentage until that window resets; profiles without a mirror stay `n/a`. TRACON only reads the file.
- `TRACON_WINDOW_MIN=30`: how long after its last transcript line a session stays on the radar.
- `TRACON_PORT=4040` (also read by `tracon status`), and `CLAUDE_CONFIG_DIR` (also scanned).

For UI work, `npm run dev:ui` serves the deck through Vite and proxies to a running engine.

### Example Terminal Status Output (`tracon status`, illustrative values)

```
TRACON ATC | FLIGHTS: 3 | HOLDING: 1
SQUAWK   CALLSIGN         RUNTIME      STATE           CURRENT TOOL               TOKENS (BURN/MIN)
SQ-100   CL-BIZ-CF5A      claude-code  TOOL_EXECUTING  Bash                       60.6k (11.8k)
SQ-20    CL-GRR-0F3E      claude-code  HOLDING         Edit                       36.2k (407)
SQ-AGY   AGY-37AC         antigravity  LANDED          -                          89.2k (0)
HOLDING: CL-GRR-0F3E in /Users/you/project is waiting on you.
```

---

## 🗺️ Project Roadmap

- [x] **Phase 0: Research & Synthesis** — Benchmark against existing visualizers (`agent-flow`, `pixel-agents`, `aiwatch`, `Session-Character-Visualizer`, `mcpmarket`).
- [x] **Phase 1: Avalokita Engine MVP**
  - [x] Multi-account directory scanner (`~/.claude*`, `CLAUDE_CONFIG_DIR`).
  - [x] Antigravity brain transcript reader (`~/.gemini/antigravity-cli/brain/`).
  - [x] Unified WebSocket telemetry server (`ws://127.0.0.1:4040/ws`).
- [x] **Phase 2: The Tactical Radar Deck (Web UI)**
  - [x] Live session cards with account badges and burn meters (quota gauge shows `n/a`: no quota source yet).
  - [x] Interactive execution DAG using `@xyflow/react` (turns, tools, subagents; latency and token badges).
  - [x] Instant Holding Pattern alerts (WebAudio chime + browser notification, which macOS shows in Notification Center).
- [ ] **Phase 3: The Ops Lounge (Pixel Office)**
  - [ ] PixiJS-powered 16-bit retro radar room.
  - [ ] Real-time character animations matching active tools (reading, writing, shell).
  - [ ] Subagents orbiting parent flight consoles.
- [ ] **Phase 4: Advanced Airspace Safety**
  - [x] TCAS file conflict detector: two sessions writing the same file within 5 minutes get a red card and a `TCAS:` line in `tracon status` (a subagent's writes count as its parent's).
  - [ ] Rate-limit trajectory predictions for $20 Pro vs $100 Team accounts.

---

## 🙏 Inspirations & Acknowledgments

A respectful nod of appreciation to the pioneering tools and creators who explored early agent visualization:
- **[Agent Flow](https://github.com/patoles/agent-flow)** by `@patoles`
- **[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)** by `@pablodelucca`
- **[aiwatch / Subagent Viewer](https://github.com/nyanko3141592/subagent-viewer)** by `@nyanko3141592`
- **[Session Character Visualizer](https://github.com/Caffa/Session-Character-Visualizer)** by `@Caffa`
- **[Visualizing Subagents](https://mcpmarket.com/tools/skills/visualizing-subagents)** by `@WarrenZhu050413`

> [!NOTE]
> **Independent Implementation Note**: None of the code from the above projects was copied or used in TRACON. TRACON and the Avalokita Engine were architected and implemented from the ground up after personally using these tools and finding that none of them met the needs of modern multi-account, multi-runtime workflows (juggling multiple concurrent Claude profiles like `claude-a`, `claude-b`, and `claude-c` alongside Google Antigravity swarms). Their innovative ideas served as an inspiring spark for what was missing in the ecosystem.

---

## 📜 Philosophy

> *"To watch without interfering is the beginning of wisdom. To guide without controlling is the art of flight control."*

TRACON ATC merges the precision and safety-critical discipline of aerospace engineering with the ancient, unblinking mindfulness of Avalokiteśvara. It exists so developers can orchestrate massive fleets of autonomous agents with absolute confidence, joy, and peace of mind.

---

## 📄 License

MIT © 2026 TRACON ATC Contributors.
