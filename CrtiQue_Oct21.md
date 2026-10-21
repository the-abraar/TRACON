# TRACON: independent critique, 2026-10-21

Reviewed at `4eb9464` (`main`, in sync with `origin/main`). I read `AGENTS.md`, `CODING_STANDARDS.md`, `README.md`, `judge.md` (last section first), `PLAN.md`, `TODO.md`, `findings.md`, `slides/`, all engine, CLI and UI source, and the Swift sources. I ran `scripts/check.sh` (7 of 7 steps pass, 42 tests) and `swift test` in `mac/` (4 XCTest tests pass, built under the session scratchpad). I also ran the engine on made-up homes with random ports, to probe the secret, the headers, malformed input and a stopped engine. One read-only `Airspace.tick()` ran over the real `~/.claude*` data to measure sizes and timings; it printed only counts. I installed no hooks, started no launchd job and sent nothing to any push service. No baseline: this is the first critique.

Each finding is marked **Confirmed** (traced in code or reproduced) or **Suspected**.

## 1. Verdict

TRACON is a local monitor for people who run several Claude Code profiles at once, plus Antigravity. It has a radar deck in the browser, a terminal UI, a menu bar app and widgets. Its partner app lets you answer held questions, plans and permission prompts from a phone over Tailscale. For one power user it works: the engine is small, read-only towards `~/.claude*`, well tested for its size, and the hook design fails open when the engine is down. It is not ready for strangers. Any local program can still approve every held permission prompt with one extra GET. A stopped engine blocks questions at the terminal for up to an hour. One malformed Antigravity line crashes the engine, and it crashes again on every restart. The public download predates the partner app.

**Continue, as an open-source portfolio piece**, not as a product with revenue. **My GTM readiness: 30%** (weighted 43.5, capped at 30). That matches the scorecard's 30%, but for different reasons. The scorecard gives Security 6 and treats "any local program can approve" as fixed by the local secret. I give Security 4, because the secret is served to anyone who GETs `/`. I give Legal 4 instead of 2, because the Apache-2.0 LICENSE has landed. The cap stays at 30: the public release lacks the headline feature, and the public screenshots still show a client's folder name. Among the other projects it ranks with Visit-Cox and Caffeinate (30), below ThrottleIQ and TakaTalks (40), and above Ambulance (16) and Protiti (10).

## 2. Code and architecture

**Shape.** About 4,850 lines in total. `avalokita-engine` (TypeScript run by Node's type stripping, no build step) is scanners → tailer → parsers → `Flight` normalizer → `Airspace` → `server.ts`. The partner app adds `decisions.ts`, `push.ts`, `state.ts` and `away.ts`. `tracon-cli` is plain JS (CLI, TUI, hooks installer). `tracon-ui` is React plus `@xyflow/react`. `mac/` is a Swift package with a shared `TraconKit`, a menu bar app and two widgets. The layering is clean. `Airspace` has no network code, so it is testable without sockets, and that is used well in `test/engine.test.ts`.

**Good choices:**
- Two dependencies in the engine (`ws`, `web-push`). No chokidar: `fs.watch` plus a 2 s poll.
- Whole-snapshot wire format. It is simple, and clients learn about departures for free.
- The `shortcut:` comments are honest about limits (`server.ts:31-32`, `normalizer.ts:194-195`, `airspace.ts:162`, `parsers/agy.ts:29`, `away.ts:17`).
- The read-only rule is enforced by a grep in `scripts/check.sh:21-24`. I checked it by hand: the engine writes only through `state.ts`, under `~/.config/tracon`. The Mac app writes only `~/Library/Application Support/TRACON/view.json` (`mac/Sources/TraconKit/Sort.swift:73-82`). The only writer into a profile is `tracon hooks install|uninstall` (`packages/tracon-cli/src/hooks.js:49`). It is opt-in, documented and backed up first. **The "reads `~/.claude*` read-only" claim holds for the engine and the Mac app.**

**Weak spots:**
- **No error isolation anywhere in the hot path.** `Airspace.consider` applies parsed lines without a try/catch (`airspace.ts:200-203`). The 2 s poll is an `async` interval with no catch (`server.ts:241-246`), and the fs-watch debounce calls `refresh` from a bare timer (`server.ts:235-238`). Any throw ends the process (see bug B3). CODING_STANDARDS says "Tolerate partial lines and files that change mid-read", but nothing tolerates a well-formed line with an unexpected shape.
- **`Airspace.tracked` never shrinks.** Every transcript that enters the window stays in memory with its `Flight`, its usage map and up to 40×100 trace nodes, for the whole uptime (`airspace.ts:41, 196-197`). `Tailer.pos` grows the same way. A 7-day window measured 114 flights, a 4.0 s first tick and about 625 MB RSS. The default 30-minute window measured 4 flights, a 116 ms first tick and 19 ms after that. A daemon left running for weeks drifts towards the first set of numbers.
- **Callsigns are used as keys.** The held set (`airspace.ts:118`), the trace path map (`airspace.ts:122`) and the UI's React keys all use the 4-hex callsign. A prefix clash merges two sessions (judge gap 7, still open).
- **The guard grep is narrow.** `check.sh:22` catches `writeFile`/`rename`/... but not `openSync(p, "w")`, `writeSync` or `fs.cp`. That is fine today, but the guard proves less than its name says.
- **Repo noise in a public repo:**
  - `combo_of_these.md` is a paste of Reddit pages, including unrelated subreddits and other people's usernames.
  - `findings.md` and the long aviation and Avalokiteśvara prose in `README.md`/`PLAN.md` describe a product much bigger than the one that exists.
  - `TODO.md` is stale: it says fixes are uncommitted, but they were committed in `3b12d51`.

**Standards adherence.** Mostly good. The AGENTS.md rules (two listeners, `/hook/*` never remote, the secret on POSTs, `HOLD_MAX_MS`) are all implemented as written. Two CODING_STANDARDS rules are broken in spirit: "Fail open for the user" (B2) and "Tolerate partial lines" (B3).

## 3. Bugs

Ranked by severity.

| # | Sev | Status | Where | Failure scenario | Fix sketch |
|---|---|---|---|---|---|
| B1 | High | Confirmed (reproduced) | `packages/avalokita-engine/src/server.ts:214-215`, `:186`, `:203`; `README.md:249` | The "local secret" is pasted into every HTML page served on the local port. Any local program can `GET http://127.0.0.1:4040/`, regex the `<meta name="tracon-secret">`, read `GET /api/flights` (no secret needed), and `POST /api/answer {allow:true}` for every held permission in every profile. I did exactly this against a scratch engine: 64-hex secret scraped, hook reply `{"behavior":"allow"}`. The judge's "Fixed 2026-10-19" holds only against browsers, which the Origin and Host checks already stopped. It does not hold against "another agent's Bash or an npm install script", the threat the fix was written for. One allowed command in one session can approve dangerous commands in every other session. | Stop serving the secret in the page. Pair the local deck like a remote device: a one-time `#pair=` link from `tracon start`, stored in localStorage. Require the secret or token on local `GET /api/flights` and `/ws` too, since held decisions carry full tool input. Document adding `~/.config/tracon` to Claude Code's sandbox deny-read list. A Unix socket with peer checks for `/hook/*` is the real fix if it ever matters (the `shortcut:` at `server.ts:31` says so). |
| B2 | High | Confirmed (reproduced with SIGSTOP) | `packages/tracon-cli/src/hooks.js:9` (`timeout: 3600`), `server.ts:130-148` | If the engine process is alive but not answering, the port still accepts connections and every hook waits for its full timeout. Causes: Ctrl-Z on a foreground `tracon start` or `npm start` (the README tells users to run them in the foreground), a debugger, heavy swap, or a 4 s first tick. A `PreToolUse` hook for `AskUserQuestion`/`ExitPlanMode` blocks the terminal in every profile for up to 3,600 s, even when you are at the desk, because only the engine can say "not away". My curl against a stopped engine hung until its own 8 s limit. `README.md:239` ("If the engine is not running, every prompt behaves exactly as without TRACON") is true only when nothing listens on the port. CODING_STANDARDS calls a prompt that never returns "the worst bug this app can have". | Use a `command` hook (`tracon hook`) instead of a bare HTTP hook. It connects with a 1 s connect and first-byte deadline, and exits 0 with no output if the engine is slow. While holding, the engine streams a whitespace byte every few seconds (JSON allows leading whitespace), and the wrapper aborts after 10 s of silence. Test it with SIGSTOP. |
| B3 | Medium | Confirmed (reproduced) | `packages/avalokita-engine/src/parsers/agy.ts:37`; `airspace.ts:200-203`; `server.ts:241-246`, `:117` | An Antigravity line whose `tool_calls` is not an array (`{}` or a string) throws `(o.tool_calls ?? []).map is not a function`. At start-up, `startEngine` throws and the engine never comes up. At runtime, the async poll rejects, nothing catches it, and Node exits. The offset lives in memory, so every restart re-reads the bad line and dies again, until the file leaves the 30-minute window. agy's format is self-described as unverified (`agy.ts:29`). The Claude parser is more defensive, but it has the same single point of failure. The partner app dies with the engine. Hooks fail open, so it is not B2-level. | Check `Array.isArray(o.tool_calls)` and object `args`. Wrap `parse`+`apply` per line in try/catch and skip the line. Catch around `refresh()` in the poll and the watch timer. Add `process.on("unhandledRejection")` logging. Add a fixture of junk-shaped lines to the engine tests. |
| B4 | Medium | Confirmed by reading; real-Claude behaviour Suspected | `decisions.ts:104-113` with `airspace.ts:145-152` | A permission hold is released only when its tool call stops being *pending*, which means its result has been written. Allow a 10-minute `npm test` at the terminal, and the phone still shows that permission with ALLOW and DENY for 10 minutes, and the flight shows `holding` (`airspace.ts:118`). If the terminal answers before any sweep sees the call pending (`seen` never true), the hold stays for `HOLD_MAX_MS`, about 58 minutes. Matching also needs the hook's `tool_input` to canonicalise equal to the transcript's input (`airspace.ts:146-149`), which is one Claude Code release away from breaking. | Add a cheap `PostToolUse` HTTP hook with matcher `*`. When it arrives, the engine releases the matching hold and replies at once with an empty 200. Keep the transcript sweep as a fallback. |
| B5 | Medium | Confirmed (still open from judge 2026-10-19) | `packages/tracon-ui/src/components/decisions/answer.ts:28-31` | Permission cards for `Write` show only the file path, and `Edit` shows only the path. You approve file contents blind on the phone. The judge's screenshot case: a workflow file containing `curl … \| sh`. | Show `content` for Write, `old_string`/`new_string` as a small diff for Edit, and JSON for MCP tools. Collapse anything over 2 KB. |
| B6 | Low | Confirmed by reading | `packages/tracon-ui/src/App.tsx:52-54`, `:109-111` | After `tracon pair --rotate`, a device keeps a dead token, retries the socket every 1.5 s forever and shows "Connecting…". The pair form appears only when no token is stored. | When `/api/flights` returns 401, clear the token and show `PairForm`. |
| B7 | Low | Confirmed by reading | `server.ts:120-122`, `decisions.ts:92-97` | Permission holds made while you are at the desk are never marked pushed. The moment AUTO flips you to away, every one of them is pushed at once, including ones held for up to an hour. | Mark holds as pushed (or skip them) when they are created while present. |
| B8 | Low | Suspected | `packages/tracon-cli/src/hooks.js:45-49` | `settings.json` is rewritten in place, not atomically. If Claude Code writes the same file at that moment (for example "always allow" adding a rule), one write is lost. A backup exists, so the risk is low. | Write to a temp file and rename it. Re-read and compare just before writing. |
| B9 | Low | Confirmed (judge 2026-10-19 #3, still open) | `tailers/tailer.ts:28-34` | The first read loads a whole transcript into one Buffer and one string. Over about 512 MB, `toString` throws and B3's crash path applies. The largest transcript on this Mac is about 90 MB. | Cap the first read to the last N MB, starting after the first newline. |
| B10 | Low | Confirmed | `mac/Sources/TraconKit/Engine.swift:22` | `Account.path` rebuilds `~/.claude-<suffix>` from the profile name. That is wrong for a `CLAUDE_CONFIG_DIR` outside home. Cosmetic. | Have the engine send the real directory. |

## 4. Corner cases and failure modes

| Case | Result | How checked |
|---|---|---|
| Engine down while a hook would hold | Connection refused, so Claude Code shows its own dialog. **OK** | judge 2026-10-19 real-Claude run; code `server.ts:140-141` |
| Engine alive but stopped or slow | Hook hangs until its 3,600 s timeout, and questions and plans block the terminal (**B2**) | Reproduced: SIGSTOP, then curl hung |
| Wrong or missing secret | 403 before anything is held, so the terminal asks. **OK** | `server.ts:197`; covered by a test |
| Other local process | Can scrape the secret from `GET /` and approve (**B1**) | Reproduced |
| Web page calling the API (CORS) | No `Access-Control-Allow-Origin`. POSTs with a foreign Origin get 403. WebSocket checks Origin and Host. **OK** | `server.ts:186, 202, 221-224`; test "foreign origins refused" |
| DNS rebinding | Local listener refuses a foreign `Host`. **OK.** The remote listener has no Host check, but every `/api` and `/ws` needs the token. | `server.ts:186, 201, 222` |
| Framing (clickjacking) | No `X-Frame-Options` and no CSP `frame-ancestors` on either listener (both returned `null`). A site on the Mac can frame `127.0.0.1:4040`, whose page carries the secret, and bait a click on ALLOW while a permission is held. Chrome's Local Network Access permission may block this; Safari does not have it. **Suspected exploitable, Confirmed headers missing** | Probe of the scratch engine |
| Port 4040 already taken | `listen` rejects and `tracon start` dies. Port 4040 is also ngrok's default inspector port. If another program owns 4040, hooks POST to it, so the secret header goes to whoever listens there. A squatter that answers `allow` would approve every permission prompt. | `server.ts:228`; hooks fixed at install time (`hooks.js:9`) |
| Many config dirs, hundreds of sessions | 30-min window: 4 flights, 116 ms first tick, about 19 ms per tick. 7-day window: 114 flights, 4.0 s first tick that blocks the event loop, about 625 MB RSS. `tracked` never evicts. | Read-only `Airspace.tick()` on real data, counts only |
| Malformed JSONL | Junk text and half lines are skipped (tailer stops at the last newline; parsers `try JSON.parse`). A well-formed line with an unexpected shape crashes the engine (**B3**). | Reproduced |
| Huge JSONL | About 512 MB or more on first read: crash (**B9**) | Code |
| Clock skew | TCAS ignores writes stamped in the future (`collision.ts:20`). Negative durations are clamped (`normalizer.ts:127, 154`). Hold expiry uses wall-clock `Date.now()`, so after a long sleep holds are released at once on wake, which is safe. **OK** | Code |
| macOS sleep | With the Mac asleep, the phone cannot reach it, and push stops. The README's fix points at `products/Caffeinate-my-mac`, a path only the owner has (`README.md:243`). | Code and docs |
| Phone offline | Push TTL is 3,600 s (`push.ts:53`). The answer is lost if the hold expires first. Acceptable. | Code |
| Leaks to the push service | Payload is encrypted (VAPID, aes128gcm). The lock screen shows the callsign plus one line of at most 100 characters: the first line of a question or plan, or `Permission: <tool>`. **OK** | `push.ts:16-26`; test |
| Two answers race | `Decisions.answer` deletes on the first answer. A second answer gets 409 "gone". **OK** | `decisions.ts:69-76, 116-120`; test |
| Answer for the wrong kind or partial question | `hookReply` returns undefined, so the API answers 400. **OK** | `decisions.ts:28-41`; test |
| Session killed while held | `res.on("close")` drops the hold. **OK** | `server.ts:145` |
| Callsign collision | Two sessions with the same 4-hex prefix in one profile merge (trace, held state) | Code (`airspace.ts:118-122`) |

## 5. Security and privacy

Threat model, as built: one user, one Mac, a tailnet of their own devices. Strong parts:
- Constant-time token and secret compares (`state.ts:15-19`).
- `/hook/*` is never reachable remotely, and it refuses any request carrying an Origin (`server.ts:195`).
- The remote port needs a bearer token on every `/api` and `/ws` request.
- Push bodies are trimmed.
- The engine never writes into profiles.
- No secrets are in git history: I scanned all 24 commits for 64-hex strings and found none.

**Open issues, ranked:**
1. **B1: the secret is effectively public to local processes.** This matters more here than in most apps, because the threat is the agent being supervised. A prompt-injected session whose Bash is allowed can approve its own next dangerous prompt, and every other session's. `GET /api/flights` without any secret also returns every held decision's full `tool_input` (reproduced), including file contents for held Writes.
2. **B2: fail-open fails when the engine hangs.**
3. **No anti-framing headers** on either listener (see section 4).
4. **The tailnet's identity is in a public file.** `TODO.md:30` and `TODO.md:32` list the Mac's Tailscale machine name, the tailnet's MagicDNS name and two Tailscale IPs. They have been in git history since `94d03fa`. Tailnet addresses are not reachable from the internet. Still, this tells anyone the exact origin of the owner's partner app, which is the target for a framing or phishing page, and it identifies the owner's devices. Remove them from `TODO.md`. Whether to rewrite history is the owner's call.
5. **One bearer token for all devices, with no expiry, sent in the WebSocket query string** (`packages/tracon-ui/src/lib/remote.ts:51`, `server.ts:222`). Revoking is all or nothing (judge gap 5).
6. **The secret sits in plain text in every profile's `settings.json`.** Agents often `cat` that file, so the secret ends up in transcripts. This is moot while B1 stands.
7. **`tracon pair` prints the token** in a link and a QR code. Run inside an agent session, the token lands in a transcript and goes to the model provider. Add a warning, or a `--qr-only` flag.
8. **`/api/push/subscribe` accepts any `https://` endpoint** from a paired device (`push.ts:10`), so the engine will POST to it. A paired device is trusted, so this is Low.

## 6. UI

- **Flight Deck.** Dense, coherent dark theme with a light/dark toggle. Cards lead with callsign, squawk and state, then cwd (last two folders), then the tool in flight, subagent chips, burn and quota bars. The opening screenshot (`slides/screenshots/fleet.jpg`) shows the problem: 49 flights, and most cards say "no tool in flight", "QUOTA n/a" and "SQ-20". The card does not say what the agent is working on. The turn prompt exists in the DAG (`normalizer.ts:41-45`) but not on the card.
- **Jargon.** SQ-20, preflight, cruising, holding, TCAS. The metaphor is fun for the author and a learning cost for everyone else. "SQ-20" just means "unlisted profile, so the Pro tier is assumed" (`airspace.ts:69`).
- **Decision inbox.** The best screen. Big buttons (`min-h-11`), the plan shown in a scrollable `pre`, free-text "Other", reasons for deny and reject, and errors shown inline with `role="alert"`. The gaps are B5 (blind Write/Edit) and no undo or confirm on ALLOW. A confirm is probably right for Bash commands that match `rm|curl|sh|sudo|git push`.
- **Mac menu bar and widgets.** Tidy, and they mirror the deck's accounts rail. The widgets need a properly signed app to be usable by anyone else (ad-hoc signing, `mac/build.sh:22-23`).

## 7. UX

**First-run path for a stranger, as documented:**
1. Download `beta_0.1`. It has no `pair`, `hooks` or `away` (judge 2026-10-19). Brew installs the same build.
2. Or clone the repo, run `npm ci` and `npm start`. That needs Node ≥ 23.6, and `README.md:186` says this is the only way, which contradicts the brew section at `:29-33`.
3. For the partner app: install Tailscale on both ends, keep `tracon start` running in a terminal (no service), keep the Mac awake with a folder the user doesn't have, run `tracon hooks install`, run `tracon pair`, run the printed `tailscale serve` line, then on iPhone use Add to Home Screen, paste the link, and tap ENABLE PUSH.

That is about 9 steps across 3 machines, and step 1 fails outright. Each step is reasonable alone. Together they lose most people who are not the author.

**When things go wrong:**
- Engine crashes (B3): the deck shows "Connecting…" forever, and nothing on the phone says why.
- Token rotated: stuck (B6).
- Push silently missing: the owner's own `TODO.md:9-14` shows this cost an evening, and it is still unverified on a real iPhone.
- Engine stopped (B2): the terminal waits, and nothing says TRACON is the cause.

**Away mode** is a good design. Becoming present hands questions back to the terminal within one 2 s poll. Permission prompts race, and the first answer wins. A 3-minute idle threshold means stepping away for coffee holds the next question. That is intended, and the user can pin the mode.

## 8. Accessibility and performance

- **Accessibility:**
  - The inbox has `aria-label`s on inputs, `aria-pressed` on options and a labelled section.
  - The React Flow DAG has no text alternative. That is acceptable for a visualiser, but the TUI's trace is the accessible path, and it is not mentioned.
  - Many labels use `text-[10px]` and `text-slate-500` on `slate-950` (31 occurrences in `src/`). That is about 4.2:1, below 4.5:1 for small text.
  - State is shown by colour plus a text badge. Good.
- **Phone and slow networks:**
  - The UI bundle is 440 KB of JS (140 KB gzipped). It loads once over the tailnet. Fine on a low-end Android.
  - The socket re-sends the whole snapshot on every change, debounced only 150 ms. At about 500-650 bytes per flight (measured), 50 flights are about 30 KB per message. With a few busy sessions writing every second or two, that is roughly 1-2 MB a minute on mobile data while the app is open (**Suspected**, estimated from the measured sizes). Send deltas, or throttle remote sockets to one message every 2 s.
- **Engine:** cheap at the default window (about 19 ms per tick). See section 2 for memory growth over uptime and the 4 s blocking first tick on a 7-day window.

## 9. Testing and verification

**What the tests prove:**
- 42 `node:test` tests. They cover parsers, normalizer states, fuel de-duplication, DAG bounds, TCAS, quota reset, scanner discovery, end-to-end `Airspace` on a fake home, server origin refusal, hold/answer/release/drop/sweep, the token-gated remote port, the secret rules, rotate clearing subscriptions, hooks install idempotence and backups, push body trimming, and the UI's pure functions.
- Plus 4 Swift tests: sorting, gaps, snapshot decoding and formatting.
- The judge's real Claude Code 2.1.302/2.1.303 runs are the most valuable evidence in the repo. A real question, plan and permission were each answered through the engine, and the wrong-secret and engine-down cases fell back to the terminal.

**What they don't prove:**
- No test feeds a well-formed line with the wrong shape (B3 would have failed it).
- No hung-engine test (B2).
- No test that the page does not leak the secret to a non-browser client (B1). The existing test asserts the opposite, that the page carries it.
- No header tests (framing).
- No React component tests: `DecisionInbox` rendering, the pair form or the 401 path.
- No real-phone push. `TODO.md:9-17` admits the iPhone never subscribed.
- No CI: `.github/` does not exist, so `check.sh` runs only when someone remembers to run it.
- Fixtures note no Claude Code version, although CODING_STANDARDS asks for it.

I disagree with `judge.md:122` marking "any program on the Mac could approve" as **Fixed**. The test suite encodes the weak version of the fix.

## 10. Deploy and operations

- **Release:** one pre-release, `beta_0.1` (2026-10-16). It is older than the partner app, the secret, the accounts rail, the Mac app and the license. `README.md:27, 38` point at it.
- **Homebrew:** `the-abraar/tap/tracon` still says `version "beta_0.1"` and `license "MIT"`, while the repo is Apache-2.0.
- **Running:** no launchd plist and no `brew services` block. The owner's own engine runs only because it was started by hand (`TODO.md:8`). Logs: the engine prints a start line and nothing else, so there is no record of why it died.
- **Signing:** the binaries are bun-compiled and not notarized (the README documents the `xattr` workaround). The Mac app is ad-hoc signed. The Apple Developer enrollment decision (`decision.md:63`) unblocks both.
- **Updates and rollback:** no update check. Rollback means downloading the older zip. Hooks survive uninstalling TRACON unless the user runs `tracon hooks uninstall`, but an orphaned hook only gets "connection refused", which fails open.
- **Platform claims:** the README badge says "macOS | Linux". The build is macOS only, and on Linux AUTO away never turns on (`away.ts:17`).

## 11. Legal and compliance

- **Licence:** Apache-2.0 LICENSE present (`b89c2e1`). The README section matches. The brew formula still says MIT: fix it.
- **Third-party content:** `combo_of_these.md` reproduces Reddit posts, usernames and vote counts, including off-topic threads, in an Apache-licensed public repo. TRACON has no right to relicense that text. Delete it.
- **Confidentiality:** `slides/screenshots/fleet.jpg` (and likely other tiles shot on the same live data) shows a paying client's project folder name on a public repo and in the slide deck. Re-shoot on a made-up home (judge item 3, still open).
- **Name:** "TRACON" is a common FAA term, so it is weak as a mark, and TRACON Pharmaceuticals uses it in another class. An unrelated "atc-claude-kanban" package already uses the ATC framing for Claude tooling. There is little legal risk as an OSS project, but the name can't be defended.
- **Vendor terms:** the README sells the tool on juggling "a personal $20 Pro plan, a $100 Team account and API keys" (`README.md:51-53`), and the roadmap promises "rate-limit trajectory predictions" per plan. Watching your own accounts is fine. Marketing it as a way to stretch limits across accounts invites a terms-of-service reading the owner doesn't want (**Suspected** risk; check Anthropic's consumer terms on multiple accounts before a launch post leads with it).
- **Bangladesh:** nothing in TRACON collects third-party personal data or crosses a border except encrypted pushes through Apple and Google. No local-law exposure that I can see. No app store is involved (it is a PWA), so no store policy applies.

## 12. Market, demand and marketability

**Who it is for:** developers who run several Claude Code profiles (`CLAUDE_CONFIG_DIR`) and possibly Antigravity at the same time, and want one screen and one phone inbox. That is a real but small group: the owner and a slice of heavy r/ClaudeCode users.

**Competitors (web-checked 2026-10-21):**

| Tool | Overlap | Their edge | TRACON's edge |
|---|---|---|---|
| Claude Code Remote Control (built in) | See and drive a session from phone or web | Free, official, no setup | Several profiles in one inbox, no Anthropic relay |
| Happy (`slopus/happy`, open source) | Mobile and web client, push when Claude Code or Codex needs permission, end-to-end encrypted | Native apps, Codex support, an existing community | Engine is read-only and unmodified (no wrapper CLI); multi-profile; Antigravity view |
| claude-remote-approver, claude-push (ntfy.sh) | Approve or deny permission prompts from phone notifications | One-hook install, no Tailscale | Questions and plans too, not just permissions; no third-party relay that sees command text |
| Forge Remote (iOS, closed) | One-tap approve with a risk level | Polished, App Store | Free, open, cross-profile |
| ccusage (about 10k stars), ccboard | Usage and cost from local logs | Mature, widely known | Live state, holds and quota rail per account (but quota needs a status-line mirror) |
| Claude Squad, Conductor, Crystal, Vibe Kanban | Run many agents at once | They *launch* and isolate agents (worktrees) | TRACON watches agents started any way you like |

**Demand evidence:** none yet. 0 stars, 0 forks, 0 issues, no launch post.

**Pricing:** none is plausible. Everything adjacent is free or open source, and the official features overlap the core job.

**Distribution:** one Show HN or r/ClaudeAI / r/ClaudeCode post. The README's first screen is ASCII art, "swarms" and Avalokiteśvara, and the real difference is buried under them. The real difference is **one inbox for every Claude profile plus Antigravity, answered from your phone with no relay, and an engine that never touches your sessions**.

**Pitch vs. reality:**
- "Dual-Interface Experience" and the Ops Lounge are not built (the README says so, but gives them most of the space).
- "Platform: macOS / Linux" is false.
- "No Gatekeeper warning" via brew is true, but brew installs the old build.
- "a website or a stray script can't approve a prompt with a blind POST" (`README.md:249`) is literally true. But a script needs only one GET first (B1), so readers will take it as stronger protection than it is.

## 13. GTM % breakdown

| Dimension (weight) | Score | Why |
|---|---|---|
| Product works (25) | 6 | Core loop and partner app verified against real Claude Code on the owner's Mac. One bad agy line kills it (B3), a stopped engine blocks prompts (B2), the public build lacks the partner app, and push on a real phone is unverified. |
| Quality and verification (15) | 6 | Small, readable, 42 + 4 tests, strict tsc. No CI, no malformed-input or hang tests, and one test asserts the leaky behaviour. |
| Security and privacy (15) | 4 | Good transport and remote design, but the local secret is one GET away (B1), held tool input is readable without auth, there are no framing headers, and the tailnet details are in a public file. |
| Legal and compliance (10) | 4 | Apache-2.0 landed. The formula says MIT, scraped Reddit text and a client's name are public, and the name is unprotectable. |
| Market validation (15) | 1 | Zero users besides the owner, and no launch yet. |
| Deploy and operations (10) | 3 | Stale release and formula, no service or CI, unsigned, no logs. |
| Claims honesty (10) | 5 | The judge and README are mostly candid, with `shortcut:` notes. But the README's download and Linux badge are wrong, its "blind POST" wording oversells the secret, and the judge marks B1 fixed. |
| **Weighted** | **43.5** | 15 + 9 + 6 + 4 + 1.5 + 3 + 5 |
| **Cap** | **30** | Launching now would ship a download without the headline feature, public screenshots with a client's name, and a prompt-approval path any local process can drive. |
| **Final** | **30%** | Same as the scorecard (40.5 weighted, cap 30). I score Security lower and Legal higher. |

## 14. What to cut or stop doing

- **Stop building surface area.** No Ops Lounge or PixiJS, no File Attention Heatmap, no burn forecasting, no agy answering until someone other than the owner uses the tool. Remove them from the README's main sections; keep one line in "Roadmap".
- **Cut the lore from the README:** ASCII banner, Avalokiteśvara, "philosophical calm", the "swarms" paragraph and the mermaid diagram of components that don't exist. Lead with a 20-second GIF of a phone answering a held question.
- **Delete `combo_of_these.md`.** Move `findings.md` to a `docs/research.md` or delete it. Trim `TODO.md` to open items, without tailnet details.
- **Hide or drop jargon on cards:** show the tier name, or nothing, instead of `SQ-20`.
- **Stop treating the Mac widget as a deliverable** until the app can be signed. The menu bar app is enough.
- **Don't add more hook kinds** before B2 is fixed. Every new blocking hook widens the hang.

## 15. Top 10 next actions

| # | Action | Effort | Who |
|---|---|---|---|
| 1 | Close B1: stop embedding the secret in HTML. Pair the local deck with a one-time token, gate local `GET /api/flights` and `/ws`, add `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY` to both listeners, and flip the test to assert the page does *not* carry the secret. | 0.5 day | agent |
| 2 | Close B3: shape checks in both parsers, try/catch per line, catch in the poll and watch timer, `unhandledRejection` logging, and a junk-shapes fixture test. | 1-2 h | agent |
| 3 | Close B2: a `tracon hook` command wrapper with connect and first-byte deadlines, and an engine heartbeat while holding. Verify with SIGSTOP against real Claude Code. | 1 day | agent, then owner verifies with real Claude |
| 4 | Remove the tailnet names and IPs from `TODO.md`, delete `combo_of_these.md`, and re-shoot `slides/screenshots/*` on a made-up home. | 1 h | owner |
| 5 | Close B4 with a `PostToolUse` release hook, and B5 with Write content and Edit diffs on permission cards. Add B6 (401 shows the pair form). | 0.5 day | agent |
| 6 | Cut `beta_0.2` from HEAD and update the tap formula (version, sha256, `license "Apache-2.0"`). Fix `README.md:186`, the Linux badge and the Caffeinate path at `:243`. | 0.5 day | agent builds, owner publishes |
| 7 | Add a GitHub Actions workflow running `scripts/check.sh` on macOS with Node 24+, and a launchd plist or brew `service` block with KeepAlive and a log file. | 0.5 day | agent |
| 8 | Real-phone test: iPhone Home Screen app subscribes, a push arrives with the phone locked, and a question, plan and permission are each answered from it. | 1 h | owner |
| 9 | Rewrite the README's first screen around the one real difference (multi-profile inbox, no relay, read-only engine), with a GIF. Drop "stretch limits" framing. | 2 h | agent drafts, owner approves |
| 10 | Launch once (Show HN plus r/ClaudeCode). Decide from stars and issues within two weeks whether to keep investing or freeze it as a portfolio piece. | 1 h + follow-up | owner |
