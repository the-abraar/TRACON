# TRACON ATC: build verdict

> **Current score: 50% of PLAN.md** (12 of the roadmap's 23 planned days). Phase 1 (engine) and all of Phase 2 (fleet bar, execution DAG, holding alerts) are built and verified against live sessions on this machine. The Ops Lounge (Phase 3), TCAS and burn forecasting (Phase 4) and the file heatmap are not built.

Built and judged 2026-10-16. I read PLAN.md, findings.md, README.md and combo_of_these.md, inspected the real transcript formats (key names and entry types only, never message content or secrets), built the MVP, ran it against the live sessions, and ran `scripts/check.sh`.

## Verdict

**The core loop works end to end.** The engine finds all five Claude Code profiles and the Antigravity brain, tails their transcripts read-only, folds each session into a `FlightPacket`, and pushes the whole airspace over `ws://127.0.0.1:4040/ws`. The Flight Deck shows one live card per session: callsign, squawk, state, active tool, subagents, burn rate and token totals. It is a working local tool for a single user, not yet the product in the README: the parts that make it "air traffic control" (holding alerts, collision warnings, quota pacing) are still to come, and holding detection is a heuristic.

## What works

- **Discovery**: `~/.claude`, every `~/.claude-*` with a `projects/` dir, and `$CLAUDE_CONFIG_DIR`; agy at `~/.gemini/antigravity-cli/brain/<conv>/.system_generated/logs/transcript.jsonl` (the real location; PLAN's `<conv>/transcript.jsonl` is the fallback).
- **Tailing**: FSEvents (`fs.watch` recursive) plus a 2 s poll; reads only appended bytes and stops at the last newline, so half-written lines are never parsed. Files are opened `r` and closed at once.
- **Normalizing**: Claude user/assistant/tool_use/tool_result/turn-end entries and agy USER_INPUT/PLANNER_RESPONSE/GENERIC steps map to the six flight states. Token usage is de-duplicated per API response. Claude subagents (`<session>/subagents/agent-*.jsonl`, role from `.meta.json`) and running agy background tasks appear as `subagents`.
- **Live process signal**: Claude Code's `sessions/<pid>.json` gives `pid` and `status` (busy/idle); a dead pid shows `aborted`.
- **Server**: one process on `127.0.0.1:4040` serving the UI, `/api/flights` and `/ws`; WebSocket refuses non-localhost origins.
- **CLI**: `tracon start [--no-open]` and `tracon status`.
- **Execution DAG (p2_2)**: `GET /api/trace?flight=<callsign>` returns a bounded list of turn, tool and subagent nodes with latency and tokens; the deck draws it with React Flow (VIEW DAG on a card).
- **Holding alerts (p2_3)**: opt-in ALERTS toggle; chime plus browser notification when a flight enters holding, once per flight per 2 min; the tab title shows the holding count.

## Verified, and how

| Check | How | Result |
|---|---|---|
| `scripts/check.sh` | install, strict `tsc` on engine and UI, stray files, read-only grep guard on engine source, 16 `node:test` tests (engine + UI layout/alert logic), Vite build | all steps pass |
| DAG on real data | one engine tick over a 30-day window, then `trace()` for every flight | 287 flights across all 5 profiles + 2 agy; 16,248 nodes, no dangling edges, no negative durations; 377 of 379 subagents attached to their `Agent` call |
| DAG in the browser | headless Chrome at 1280 px and 375 px, click VIEW DAG on the live session | nodes and edges render with latency badges; no console errors; no horizontal scroll |
| Holding alert | engine on a synthetic `$HOME`, page open with alerts on and notifications granted, then an `AskUserQuestion` line appended | one notification ("CL-DEMO-BEEF is holding ..."), title `(1) HOLDING · TRACON ATC`, card pulses amber |
| Parser + normalizer | synthetic fixtures in `packages/avalokita-engine/test/fixtures/` (no real session content) | states, fuel de-dupe, sidechain filter, redaction, agy RUNNING/WAIT, quoted agy args |
| Engine end to end | fake `$HOME` with two Claude profiles, a subagent and an agy conversation; append a line and re-tick | both runtimes discovered; state moves tool_executing -> landed; packet id stable until content changes |
| Socket | real server on a random port; new session file appears; foreign `Origin` | snapshot pushed within the poll; `https://evil.example` refused |
| Live run | `tracon start --no-open`, then `tracon status`, `/api/flights`, and a 45 s WebSocket listener | this session showed as `CL-BIZ-CF5A` with pid and its three subagents changing between `cruising` and `tool_executing` live; a second profile (`CL-GRR-...`) moved holding -> landed while listening |
| Real-data coverage | one tick with a 3-day window | 79 flights: 77 Claude across all 5 profiles, 2 agy with correct cwd |
| UI | headless Chrome screenshots at 1280 px and a 375 px iframe | cards render from the live socket; no horizontal scroll at 375 px |

## Gaps (ranked)

1. **Holding is a guess.** Transcripts have no "waiting for approval" entry, so a tool call with no result and no new line for 60 s is called holding. A long build or test run looks identical. The `sessions/<pid>.json` status may expose a waiting value, but only `busy`, `idle` and `shell` were observed. Only `~/.claude-biz` and `~/.claude-grr` wrote pid files during the run, so the other profiles rely on transcripts alone.
2. **Alerts need the Flight Deck tab open.** The chime and notification come from the browser, so with no tab open nothing alerts; the chime also needs one click on the page after each reload (browser autoplay rule). They inherit the holding heuristic's false positives (long builds), damped by the 2-minute cooldown. Sound was not heard in testing (headless); the notification call was verified.
3. **No quota.** `quotaPercentage` is never set; the gauge reads `n/a`. `accountTier` defaults to `pro_20` unless `TRACON_TIERS` says otherwise.
4. **agy holding and subagents are unverified.** No approval prompt or `invoke_subagent` call exists in the local agy data; the `WAIT*` status mapping and subagent naming are untested against real output. agy cwd comes from the last `run_command` Cwd, so a conversation that never ran a command has an empty cwd.
5. **Not built:** Ops Lounge / PixiJS (Phase 3), TCAS and burn-rate forecasting (Phase 4), the File Attention Heatmap, `transcript_full.jsonl`. The DAG shows agy background tasks only on the card, not as DAG nodes.
8. **DAG limits**: only the last 40 turns and 100 calls per turn are kept; subagents are matched to their `Agent` call by time, not id; the first tick reads every in-window transcript from the start (about 3 s for a 30-day window, instant for the default 30 min).
6. **Scale**: each tick stats every transcript (~860 files, ~10 ms). Fine on this machine; revisit if a profile grows to tens of thousands.
7. **Callsign collisions**: 4 hex chars per session; two sessions in one profile sharing a prefix would merge on the deck (about 1 in 65k per pair).

## Next steps

1. Catch one real Claude permission prompt and one agy approval with the engine running, and record what `sessions/<pid>.json` and the agy transcript contain at that moment. Replace the 60 s heuristic with that signal where it exists.
2. Decide the tier for each profile and set `TRACON_TIERS` (or give TRACON a quota source; `~/.claude-hat/statusline-usage.py` already sees usage for one profile).
3. Phase 4 TCAS: the DAG already records write targets per flight (`action: "write"`, `detail`); flag two flights writing the same file within 5 minutes (`collisionWarning`).
4. Phase 3 Ops Lounge (PixiJS), once the radar deck has been used for a while.
