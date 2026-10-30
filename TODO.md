# TODO

## Partner app (built and committed 2026-10-17 as 94d03fa; fixes since then not committed)

Setup is done, apart from push on the phone. Design and spike results: PLAN.md section 8.

### Start here tomorrow
- [ ] **Install the engine as a service** (one line, restarts the engine once): `tracon service install && tracon service status`. It replaces the hand-copied `com.blackbird.tracon` plist (same label) with one the CLI writes; KeepAlive and RunAtLoad as before. On 2026-10-27 the old agent was already loaded and running (`launchctl list` showed pid 709), so this is a tidy-up, not a rescue. Undo: `tracon service uninstall`. `tailscale serve` is separate; check it with `tailscale serve status`.
- [ ] **Push is blocked: the engine has no subscription from the iPhone.** `~/.config/tracon/subscriptions.json` is `[]`, even though the app's notifications button shows "on".
  - Known so far: the engine side works. A probe POST to `/api/push/subscribe` over the tailnet was saved, then removed. The button's "on" used to reflect only the phone's own registration, so it never showed whether the engine had it.
  - Fix in place, not committed: `pushStatus()` in `packages/tracon-ui/src/lib/push.ts` now re-sends the device's subscription on every open, so "on" means the engine has it.
  - To do: swipe the TRACON Home Screen app closed, reopen it, then run `cat ~/.config/tracon/subscriptions.json`.
  - Still `[]`? The phone isn't sending at all. Connect the iPhone to the Mac and use Safari > Develop > iPhone to read the web app's console and network log. Suspects: the token missing in the Home Screen app, or `pushManager.subscribe` failing on iOS. If nothing helps, toggle notifications off and on in iOS Settings > Notifications > TRACON.
- [ ] **Then test a real push:** run `tracon away on`, start a Claude session that asks a question (AskUserQuestion), lock the phone, and wait for the notification. Tap it, answer, and check that the session carries on. Run `tracon away auto` afterwards.

### Not verified yet
- [ ] Push on a real phone (blocked by the item above).
- [ ] The paste-the-link pairing form on the iPhone Home Screen app. You paired, so it probably worked, but nobody checked which way the pairing happened. Added because iOS Home Screen apps have their own storage, separate from Safari, so the `#pair=` token Safari saved never reached the app (every request got a 401).
- [ ] A plan approval and a permission prompt answered from the phone. They were tested only from the "phone" port on the Mac, never on a real device.
- [x] Do sessions disappear when they've been stuck a long time? Answered from the code 2026-10-30 (issue #4): a Claude card stays while its process runs (pid in `sessions/<pid>.json`), whatever the 30-minute window; profiles without pid files and Antigravity drop out after 30 minutes without a transcript line. The held prompt stays in the inbox and `tracon status` until `HOLD_MAX_MS` (about 58 min), then goes back to the terminal dialog, before Claude Code's own 3600 s hook timeout. Not a bug.
- [ ] Answering Antigravity prompts. You can see them but not answer them yet. Needs the owner (2026-10-30): no agy approval prompt has ever been captured, and agy has no known hook to hold one, so first catch one live and record what agy writes.

### Housekeeping
- [x] (done in `3b12d51`) Commit the fixes made after 94d03fa: `App.tsx` (pair form), `lib/remote.ts` (`savePairToken`), `lib/push.ts` (re-send the subscription), and `test/ui.test.ts` (a `savePairToken` test). `scripts/check.sh` passes all 7 steps.
- [x] Make the engine start at login (a launchd agent, or the Homebrew service) so the phone doesn't go dark after a reboot. Done 2026-10-24: launchd agent `com.blackbird.tracon` (hand-copied plist, installed in `~/Library/LaunchAgents`, log `~/Library/Logs/tracon.log`); README "Start at login" (now `tracon service install`, 2026-10-27). KeepAlive checked: a killed engine came back in about 6 s.
- [x] Put `tracon` on PATH (`npm link` in `packages/tracon-cli`, or the Homebrew install from the README). Done 2026-10-24: `npm link` (`/opt/homebrew/bin/tracon` → this checkout); `bin/tracon.js` got its missing `#!/usr/bin/env node` line.
- [ ] Decide what to do with the untracked `dev/agy_autostrategy.md`. It's from 14:50 on 2026-10-17, before this work started, and was left alone.

### Done
- [x] Tailscale on the Mac and the iPhone 15.
- [x] `tracon hooks install`: all 5 profiles, backups in `~/.config/tracon/backups`, and `ensure_caveman.py check` still ALL GOOD (it won't strip them). Undo with `tracon hooks uninstall`.
- [x] Tailscale Serve enabled and running: `https://<mac>.<tailnet>.ts.net/` → `127.0.0.1:4041`. Turn it off with `tailscale serve --https=443 off`.
- [x] `tracon pair`: the iPhone opened the link and sees the app. The token hasn't been rotated; rotate it with `tracon pair --rotate` if the link leaks.

### Notes

**What it does:** any Claude session that stops for a question, a plan approval or a permission prompt shows up in an inbox on your phone, laptop or browser. You answer there and the session at home carries on.
- **Who answers:** "AUTO" (the default) means you count as away after 3 minutes without keyboard or mouse input on the Mac. While you're away, questions and plans wait for your devices. Touch the Mac and they go straight back to the terminal dialog. You can also pin it with `tracon away on|off|auto` or the switch at the top of the app.
- **Permission prompts** always appear in the inbox. The terminal shows its own dialog at the same time, and whichever answers first wins. If you answer at the terminal, the inbox entry clears a couple of seconds later.
- **Safety net:** if TRACON isn't running, every prompt behaves exactly as it does today.
- **Security:** only devices on your Tailscale network can reach it, and each one needs the token from `tracon pair`. The part Claude Code talks to is never reachable from outside the Mac.

**What the test showed that changed the design:** Claude Code shows its permission dialog alongside the hook, and doesn't cancel the hook when you answer at the terminal. So the engine watches the session transcript to notice that, rather than waiting on the hook.

**What was verified:**
- **Tests:** `scripts/check.sh` passes all 7 steps with 34 tests.
- **Real sessions (Claude Code 2.1.302):**
  - A question answered from the "phone" port reached Claude as "Green / Olives, Basil".
  - A plan was approved remotely, then a Bash command was allowed remotely, and the file was created.
  - A held question went back to the terminal when switched to "at desk"; the dialog appeared only then.
  - A permission answered at the terminal cleared from the inbox 2.6 s later.
- **Web push:** a fake push service decrypted the notification correctly, and a dead subscription was removed.
- **App:** at 375 px wide it fits a phone screen, and clicking its real buttons answered all three kinds.
- **Binary:** the bun-built binary still works, with the app files included.

**Slip during testing:** the install/uninstall test also wrote the hooks into the real `~/.claude-biz/settings.json`, because that shell had `CLAUDE_CONFIG_DIR` set. The uninstall in the same run removed them less than a second later, and the file is byte-identical to its backup. The test sessions' transcripts and plan files were deleted from `~/.claude-biz`.
