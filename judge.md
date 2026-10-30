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

1. **Holding is a guess.** Transcripts have no "waiting for approval" entry, so a tool call with no result and no new line for 60 s is called holding. A long build or test run looks identical. The `sessions/<pid>.json` status may expose a waiting value, but only `busy`, `idle` and `shell` were observed. Only `~/.claude-biz` and `~/.claude-grr` wrote pid files during the run, so the other profiles rely on transcripts alone. (Narrowed 2026-10-17: with `tracon hooks install`, a held question, plan or permission makes its flight holding for certain. The guess remains for sessions without the hooks and for agy.)
2. **Alerts need the Flight Deck tab open.** The chime and notification come from the browser, so with no tab open nothing alerts; the chime also needs one click on the page after each reload (browser autoplay rule). They inherit the holding heuristic's false positives (long builds), damped by the 2-minute cooldown. Sound was not heard in testing (headless); the notification call was verified. (Narrowed 2026-10-17: web push reaches paired devices with no tab open, but only while away, and push on a real phone is still unverified.)
3. **Quota is thin.** `quotaPercentage` comes only from `TRACON_QUOTA` usage mirrors, and only the `hat` profile writes one. `accountTier` defaults to `pro_20` unless `TRACON_TIERS` says otherwise.
4. **agy holding and subagents are unverified.** No approval prompt or `invoke_subagent` call exists in the local agy data; the `WAIT*` status mapping and subagent naming are untested against real output. agy cwd comes from the last `run_command` Cwd, so a conversation that never ran a command has an empty cwd.
5. **Not built:** Ops Lounge / PixiJS (Phase 3), burn-rate forecasting (p4_2), the File Attention Heatmap, `transcript_full.jsonl`. The DAG shows agy background tasks only on the card, not as DAG nodes.
8. **DAG limits**: only the last 40 turns and 100 calls per turn are kept; subagents are matched to their `Agent` call by time, not id; the first tick reads every in-window transcript from the start (about 3 s for a 30-day window, instant for the default 30 min).
6. **Scale**: each tick stats every transcript (~860 files, ~10 ms). Fine on this machine; revisit if a profile grows to tens of thousands.
7. **Callsign collisions**: 4 hex chars per session; two sessions in one profile sharing a prefix would merge on the deck (about 1 in 65k per pair).

## Update (2026-10-16, agent round)

- **Fixed: finished subagents showed `running` forever.** Every Claude subagent transcript on this Mac (18 of 18) ends with a `SubagentHandback` call and its result, and no `turn_end`. The normalizer now treats that result as the end of the turn, so the subagent lands and its DAG node gets an end time. `toolAction` no longer files `SubagentHandback` as a spawn. On real data (3-day window): 0 subagent nodes left running; CL-BIZ-CF5A's 3 now end.
- **Built: p4_1 TCAS** (`collision.ts`). Two flights writing one file within 5 minutes get `collisionWarning`, a red card with the shared file, and one `TCAS:` line per pair in `tracon status`. Writes only; a subagent's writes count as its parent's. Checked with a two-session demo home in headless Chrome.
- **Built: quota source** (`quota.ts`, `TRACON_QUOTA="HAT=/path/usage-hat.md"`). Reads the 5-hour percentage from a statusline-usage.py mirror until its window resets. Only the `hat` profile writes a mirror today, and its last reading (15 Oct) has expired, so the gauge still reads n/a until that status line runs again.
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

1. Catch one real Claude permission prompt and one agy approval with the engine running, and record what `sessions/<pid>.json` and the agy transcript contain at that moment. Replace the 60 s heuristic with that signal where it exists. (Claude: done another way since 2026-10-17, by the hooks. Still open for agy.)
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

## Update (2026-10-19, review round)

No new commits since f8c244d (the Host-header and bad-percent-encoding fixes), so this was a gap pass. `scripts/check.sh` passes all 7 steps (35 tests) and leaves the tree clean. I also ran the engine on a made-up `$HOME` with its own state folder and random ports. Nothing was sent to a real device or push service.

**Status of the items still open after the last review:**
- **Open: the public download is older than the partner app.** The only release is `beta_0.1` (2026-10-16, commit 4955494), and the Homebrew formula points at it. That build's `tracon.js` has no `pair`, `hooks` or `away`, so the README's Partner App setup fails for anyone who installed with brew or the zip.
- **Open: there is no LICENSE file.** The MIT badge (README.md:17) and the License section (README.md:297-299) point at a file that doesn't exist, and GitHub reports no licence. The repo is public with 0 stars and no description or topics.
- **Open, now confirmed by a live run: any program on the Mac can approve a prompt.** A POST to `/api/answer` without an `Origin` header got a 200 (server.ts:192 only refuses a *foreign* Origin). Anything that can reach 127.0.0.1:4040 can read the held prompts and answer them. That includes another agent's Bash or an npm install script, and the same program can post fake prompts to `/hook/*`, which then get pushed to the phone. **Fixed the same day** (below).
- **Open, now confirmed in a screenshot: phone approvals of file writes are blind.** A held `Write` to `.github/workflows/deploy.yml` whose content ran `curl ... | sh` showed only the file path on the 375 px card (answer.ts:28-31).

**Bugs found:**
1. **`tracon pair --rotate` doesn't sign devices out of push.** It writes a new token (state.ts:38-42) but leaves `subscriptions.json` as it was, and `Pusher.send` notifies every subscription (push.ts:44-55). A lost or revoked phone keeps getting lock-screen notifications with commands, file paths and questions. The README (line 249) says rotating "signs out every device". **Fixed the same day** (below).
2. **The README understates what a push contains.** It says a push holds "only the callsign and the first line of the prompt". In fact `pushBody` sends up to 160 characters of the Bash command, file path or raw tool input, without redaction (push.ts:15-23). **Fixed the same day** (below).
3. **Low, not reproduced: one huge transcript would crash the engine on start-up.** The first read of a transcript loads the whole file into one string (tailer.ts:28-34). Nothing catches errors around the poll and refresh (server.ts:220-231), and there is no `uncaughtException` handler. A file over about 512 MB (V8's string limit) would therefore stop the engine every time it starts. The biggest transcript on this Mac is 90 MB, so this is not happening today.

**Checked and fine:** the remote port returns 401 without the token, including for a CORS preflight (no `Access-Control-Allow-Origin` header), so other sites can't use it. A paired device can't change the command it approves: `hookReply` sends only allow/deny, or the plan unchanged (decisions.ts:28-41). At a true 375 px width (an iframe), the deck and the inbox fit, the buttons are 44 px tall, and nothing scrolls sideways. Headless Chrome with `--window-size=375` cuts off the right edge, but that is Chrome's minimum window width, not the app.

**Fixed (2026-10-19):**
- **Local secret.** The engine makes 32 random bytes in `~/.config/tracon/secret` (0600) on first start and keeps them. Every POST to `/hook/*` and to local `/api/*` must send them in `x-tracon-secret` (constant-time compare), or gets a 403 before anything is held. An HTTP hook can't read a file, so `tracon hooks install` writes the secret into each profile's hook headers. Hooks installed before this fix are refused, so every prompt falls back to the terminal until the owner re-runs `tracon hooks install` (README setup step 3). The deck gets the secret from a `<meta>` tag in the page served on the local port only; `tracon away` reads the file. Limit, in a `shortcut:` comment and the README: a program running as the user can read the file or load the deck.
- **`tracon pair --rotate`** now empties `subscriptions.json` (`State.rotateToken`), so a revoked phone gets no more pushes. A device that pairs again re-subscribes when it opens the app.
- **Push bodies** are the callsign plus one line of at most 100 characters: the first line of a question or plan, or `Permission: <tool>`. They no longer include the command, path or tool input. The README now says exactly this.
- Proof:
  - `scripts/check.sh` passes all 7 steps with 39 tests (4 new, push test rewritten). Against an export of f8c244d, the new tests fail: the lost phone's subscription survives a rotate, a blind hook POST is held until the test's 2 s abort, and the push body contains the command.
  - Real Claude Code 2.1.303 in a scratch project, with project-level hooks to a scratch engine on a random port. The user-level TRACON hooks were blocked from reaching port 4040 with `sandbox-exec`.
    - Wrong secret, engine away: the AskUserQuestion dialog showed at the terminal 3 s after the prompt, and nothing was held.
    - Right secret: the question was held and answered through the engine API, and Claude received "Red". This shows Claude Code sends an HTTP hook's `headers`.
    - Engine down: the dialog showed after 2 s.
    - Bash permission with a wrong secret: the terminal dialog showed, nothing was held, and the file wasn't created (denied at the terminal).
  - Headless Chrome on the built deck against a scratch engine: the page has the secret, and the AWAY button's POST went through.

## Gaps (ranked, 2026-10-19)

1. **Fixed 2026-10-19: any program on the Mac could approve permission prompts.** The local secret (above) stops blind POSTs. Still open: GET `/api/flights` shows held prompts to any local program. The deck sends no `X-Frame-Options` or `frame-ancestors`, so a website could frame `127.0.0.1:4040` and trick a click on Allow. The secret sits in plain text in each profile's `settings.json`.
2. **The download doesn't match the README.** `beta_0.1` and the brew formula don't include the partner app. README.md:186 says the app is not on Homebrew, which contradicts lines 29-33. The badge says Linux, but the beta is macOS only. Setup step 2 points at `products/Caffeinate-my-mac`, a folder only the owner has.
3. **No LICENSE, and the public screenshots show a client's name** (`slides/screenshots/fleet.jpg`). The name TRACON hasn't been checked for trademarks. It is a common FAA acronym, so it would be hard to register, and TRACON Pharmaceuticals already uses it in another field.
4. **Blind file-write approvals on the phone** (above). Show `content` for Write, a diff for Edit and the JSON for MCP tools.
5. **Revoking a device is all or nothing**, and the WebSocket token travels in the query string. Fix: one token per device with `tracon devices list|revoke`. (Rotate stops all pushes, and push bodies are trimmed, since 2026-10-19.)
6. **Nothing keeps the engine running, and nothing checks the code.** There is no launchd or brew service, no top-level error handler and no CI (`.github/workflows` doesn't exist). The owner's engine is up today only because it was started by hand.
7. **A device whose token was rotated stays on "Connecting..." forever.** App.tsx:50-52 retries every 1.5 s, and the pair form shows only when no token is stored (App.tsx:104).
8. **Cards and inbox entries don't say what the agent is doing.** They lead with the callsign and two folder names. Everyone except the owner sees `SQ-20` and `QUOTA n/a`, which was confirmed on the made-up home.
9. **Positioning.** Anthropic's Agent View and Remote Control are free and cover "see sessions, approve from the phone". The README still opens with ASCII art, "swarms" and limit-stretching accounts, not the real difference: one inbox across several accounts and Antigravity, with no relay.
10. **No revenue path.** Treat it as an open-source portfolio piece until a launch shows demand.

`TODO.md` is out of date: its "commit the fixes made after 94d03fa" item was done in 3b12d51.

## Next steps (2026-10-19)

1. Done 2026-10-19 (see Fixed above): local secret, subscriptions cleared on `--rotate`, short push bodies, with tests. Next, small: add `frame-ancestors 'none'` to the local deck's pages.
2. Agent, about 2 h: show Write and Edit content on permission cards. When the server returns 401, clear the stored token and show the pair form.
3. Done 2026-10-21: Apache-2.0 LICENSE, GitHub description and topics. Still open, owner, 1 h: Re-shoot the slides on a made-up home, and fix the README contradictions (line 186, the Linux badge, the Caffeinate path).
4. Agent and owner, half a day: cut `beta_0.2` from HEAD, update the tap formula, and add a brew `service` block or a launchd plist with KeepAlive. Add a top-level error handler and a GitHub Actions workflow that runs `scripts/check.sh`.
5. Owner, 1 h: finish the iPhone push test in TODO.md, and answer a question, a plan and a permission from the phone.
6. Owner: post one launch (Show HN, r/ClaudeAI) about the multi-account angle, then decide from stars and issues whether to keep investing.

## Next steps (2026-10-25)

1. Done 2026-10-25: `frame-ancestors 'none'` (and `X-Frame-Options: DENY`) on every page both listeners serve, with a test. Write content and an Edit diff show on permission cards. A 401 clears the stored token and reloads into the pair form (gaps 4 partly, 7). The CLI logs `uncaughtException` / `unhandledRejection` and keeps running, and the engine poll catches its own errors (gap 6, partly). `.github/workflows/check.yml` runs `scripts/check.sh` on push and PR (not yet pushed, so it has never run on GitHub).
2. Still open from gap 4: a diff view is plain `-`/`+` lines, and MCP tool JSON is unchanged. Gap 6: still no launchd or brew service with KeepAlive.
3. Items 3 to 6 of the 2026-10-19 list are unchanged.
4. Agent round 2026-10-27: the engine wraps every request in one catch, so a throw answers 500 at once (a hook then falls back to the terminal) instead of hanging; tested. Edit cards show a colored diff with shared lines as context (prefix/suffix match, not a full LCS), and MCP tools show their whole input as indented JSON (gap 4 closed for Write, Edit and MCP; a MultiEdit card still shows only its path). Gap 6: the launchd plist with `KeepAlive` already exists (`scripts/com.blackbird.tracon.plist`, b3fc746, README "Start at login"; `plutil -lint` OK), so the 2026-10-25 note above was stale; it is not loaded, the owner installs it. The brew `service` block waits for `beta_0.2` and the tap repo. CI still has never run on GitHub (not pushed).

## Update (2026-10-27, second agent round)

- **Gap 6, done in code:** `tracon service install|uninstall|status [--dry-run]` (`packages/tracon-cli/src/service.js`, 561b648). Install writes `~/Library/LaunchAgents/com.blackbird.tracon.plist` (KeepAlive, RunAtLoad, ThrottleInterval 10, log `~/Library/Logs/tracon.log`), then `launchctl bootout` + `bootstrap`, retrying for up to 5 s while the old agent shuts down. Node (or the compiled binary) comes from PATH, so the agent survives `brew upgrade node` (`process.execPath` is the versioned Cellar path). Same label as the hand-copied plist, which is removed from `scripts/`; README "Start at login" now uses the command. 4 new tests: the plist passes `plutil -lint`, paths are XML-escaped, and `install --dry-run` on a temp HOME, with no `launchctl` on PATH, writes nothing. `scripts/check.sh` passes all 7 steps, 48 tests.
- **Correction to the note above:** the launchd agent *is* loaded on this Mac. `launchctl list` showed `com.blackbird.tracon` running as pid 709, listening on 4040. Nothing was installed, loaded, stopped or restarted in this round. Owner step (optional tidy-up, restarts the engine once): `tracon service install`.
- **Gap 4:** nothing to do. The earlier 2026-10-27 round already shows MCP input as indented JSON and Edit as a colored diff. Still open: a MultiEdit card shows only its path.
- **Still open:** the brew `service` block (waits for `beta_0.2` and the tap). `TRACON_PORT` is not carried into the plist, so a non-default port needs an `EnvironmentVariables` edit by hand. CI has never run on GitHub (not pushed).

## Update (2026-10-30, agent round)

- **MultiEdit cards (gap 4 closed):** each edit shows as a diff under an `@@ edit n of m` line; an Edit or MultiEdit edit with `replace_all` says ", every match" (PR #2, issue #1). Tests in `packages/tracon-ui/test/ui.test.ts`. Not checked in a browser or on a phone.
- **`TRACON_PORT` in the plist:** `tracon service install` copies every `TRACON_*` variable of the installing shell into the plist's `EnvironmentVariables` (issue #3). Tests: the plist with variables passes `plutil -lint`, and `install --dry-run` on a temp HOME with `TRACON_PORT=5050` prints it. Nothing was installed or restarted; the running agent keeps its old plist until the owner re-runs `tracon service install`.
- **Stuck sessions (`HOLD_MAX_MS`), answered from the code, not a live run** (issue #4, closed): a Claude card stays while its process runs; the held prompt goes back to the terminal after about 58 min, before Claude Code's 3600 s hook timeout. Not a bug. Profiles without `sessions/<pid>.json`, and agy, drop their card after 30 minutes, while a held entry stays in the inbox.
- **Antigravity answers:** skipped. No agy approval prompt has been captured and agy has no known hook, so it needs the owner to catch one live first.
- `scripts/check.sh` passes all 7 steps, 49 tests.
