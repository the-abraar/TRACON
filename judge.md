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
3. **Quota is thin.** `quotaPercentage` comes only from `TRACON_QUOTA` usage mirrors, and only the `hat` profile writes one. `accountTier` defaults to `pro_20` unless `TRACON_TIERS` says otherwise.
4. **agy holding and subagents are unverified.** No approval prompt or `invoke_subagent` call exists in the local agy data; the `WAIT*` status mapping and subagent naming are untested against real output. agy cwd comes from the last `run_command` Cwd, so a conversation that never ran a command has an empty cwd.
5. **Not built:** Ops Lounge / PixiJS (Phase 3), burn-rate forecasting (p4_2), the File Attention Heatmap, `transcript_full.jsonl`. The DAG shows agy background tasks only on the card, not as DAG nodes.
8. **DAG limits**: only the last 40 turns and 100 calls per turn are kept; subagents are matched to their `Agent` call by time, not id; the first tick reads every in-window transcript from the start (about 3 s for a 30-day window, instant for the default 30 min).
6. **Scale**: each tick stats every transcript (~860 files, ~10 ms). Fine on this machine; revisit if a profile grows to tens of thousands.
7. **Callsign collisions**: 4 hex chars per session; two sessions in one profile sharing a prefix would merge on the deck (about 1 in 65k per pair).

## Update (2026-10-16, agent round)

- **Fixed: finished subagents showed `running` forever.** Every Claude subagent transcript on this Mac (18 of 18) ends with a `SubagentHandback` call and its result, and no `turn_end`. The normalizer now treats that result as the end of the turn, so the subagent lands and its DAG node gets an end time. `toolAction` no longer files `SubagentHandback` as a spawn. On real data (3-day window): 0 subagent nodes left running; CL-BIZ-CF5A's 3 now end.
- **Built: p4_1 TCAS** (`collision.ts`). Two flights writing one file within 5 minutes get `collisionWarning`, a red card with the shared file, and one `TCAS:` line per pair in `tracon status`. Writes only; a subagent's writes count as its parent's. Checked with a two-session demo home in headless Chrome.
- **Built: quota source** (`quota.ts`, `TRACON_QUOTA="HAT=/path/usage.md"`). Reads the 5-hour percentage from a statusline-usage.py mirror until its window resets. Only the `hat` profile writes a mirror today, and its last reading (15 Oct) has expired, so the gauge still reads n/a until that status line runs again.
- Proof: `scripts/check.sh` passes all 7 steps; 21 tests (6 new, 2 of them fail on the old normalizer).

## Update (2026-10-17, partner app)

- **Built: the Partner App** (PLAN.md section 8). Held `AskUserQuestion`, plan approvals and permission prompts from every Claude profile appear on any paired device (PWA over Tailscale, with web push), and the answer goes back to the waiting session.
- **Gap 1 narrowed**: with the hooks installed, a held question, plan or permission makes its flight `holding` for certain; the 60 s heuristic remains only for sessions without the hooks and for agy.
- **Gap 2 narrowed**: web push reaches devices with the deck closed (only while away).
- Proof:
  - `scripts/check.sh` passes all 7 steps with 34 tests.
  - Against real Claude Code 2.1.302 in a scratch project:
    - A question was answered via the token-gated remote port, and Claude received "Green / Olives, Basil".
    - A remote plan approval was followed by a remote Bash allow, and the file was created.
    - A held question went back to the terminal on "at desk": the dialog appeared only after the release.
    - A permission answered at the terminal was released from the inbox 2.6 s later.
  - Web push decrypted correctly from a fake HTTPS push service, and a 410 subscription was dropped.
  - Headless Chrome at 375 px rendered the deck, and its real buttons answered all three kinds.
  - The bun binary serves the service worker, manifest and icons.
- Not verified: push on a physical iPhone or Android (headless Chrome denies notifications), `tracon pair` with Tailscale installed (it isn't on this Mac), and the time from a hook POST to the push arriving on a device.

## Next steps

1. Catch one real Claude permission prompt and one agy approval with the engine running, and record what `sessions/<pid>.json` and the agy transcript contain at that moment. Replace the 60 s heuristic with that signal where it exists.
2. Owner: decide the tier for each profile (`TRACON_TIERS`), and add a usage-mirror status line to the profiles you want quota for (only `hat` has one).
3. p4_2 burn-rate forecasting: with quota readings over time, project when the 5-hour window runs out.
4. Phase 3 Ops Lounge (PixiJS), once the radar deck has been used for a while.
5. Plan: share current usage and quota for every account.
   - Source: each profile's status line writes a usage mirror (`statusline-usage.py` format). Today only `hat` does, so first add the mirror to `~/.claude`, `-work`, `-biz`, `-grr` and list them all in `TRACON_QUOTA`. agy has no quota source; show `n/a`.
   - Engine: extend `quota.ts` to return both the 5-hour and 7-day percentages, their reset times and the `Updated` age, not just the 5-hour percentage. Add `GET /api/usage` returning one row per account: `{profile, tier, fivehPct, sevenDPct, resets, updatedAt, stale}`. A reading older than 10 minutes is marked `stale`, never shown as current.
   - Share: `tracon usage` prints the same table (one line per account), and the Fleet Bar shows both gauges per account. Read-only, localhost only, like the rest of the engine.
   - Done when: all accounts with a mirror show live 5h and 7d numbers, a stopped account shows `stale`, and a test covers the stale and reset cases.
6. Plan: macOS widget for usage and quota.
   - Shape: a WidgetKit widget (small = worst account's 5h percentage; medium = one row per account with 5h and 7d bars and the reset time), in a small SwiftUI host app. Swift precedent: `products/Caffeinate-my-mac`.
   - Data: the widget's timeline provider fetches `http://127.0.0.1:4040/api/usage` (needs the network-client entitlement), refreshing every 5 minutes. If the engine is not running, show the last reading greyed out with its age.
   - Owner decision: a WidgetKit widget needs a signed app (free Apple ID is enough for local use). The fallback is a SwiftUI menu bar item with the same data and no signing, if signing is a hassle.
   - Depends on item 5. Build order: item 5, then the host app and a small widget, then the medium one.
   - Done when: the widget shows the same numbers as `tracon usage` and goes stale-grey when the engine stops.

