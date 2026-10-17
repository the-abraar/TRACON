# TODO

## Partner app (built 2026-10-17, not committed)

The partner app is built and working, but you have four setup steps before you can use it from outside. Every flow worked against real Claude Code sessions, but push on a real phone and `tracon pair` with Tailscale are untested, since Tailscale isn't installed on this Mac. Design and spike results: PLAN.md section 8.

### Setup
- [ ] Install Tailscale on the Mac and your devices.
- [ ] Restart `tracon`. The one running on port 4040 is the old version.
- [ ] Run `tracon hooks install`, which adds two hooks to each profile's `settings.json` and backs each file up first.
- [ ] Run `tracon pair` and open the link it prints on each device. On iPhone, Add to Home Screen first, or push notifications won't work.

### Still to verify
- [ ] Push on a real iPhone or Android phone.
- [ ] `tracon pair` itself.
- [ ] Answering Antigravity prompts. You can see them but not answer them yet.

### Housekeeping
- [ ] Commit the partner app work.
- [ ] Decide what to do with the untracked `dev/agy_autostrategy.md`. It's from 14:50 on 2026-10-17, before this work started, and was left alone.

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
