# Coding standards (judgement calls)

`scripts/check.sh` covers types, stray files and the engine's read-only rule; these need a reviewer.

- **Observe, don't touch**: scanners read transcripts and config; they never write, lock, move or delete anything in a Claude or Gemini profile. Tolerate partial lines and files that change mid-read.
- **Fail open for the user**: any engine error, timeout or missing state hands the prompt back to the terminal. A held prompt that never returns is the worst bug this app can have.
- **First answer wins**: a decision answered at the terminal, on a device or by timeout resolves once; later answers are rejected, not applied.
- **Local by default**: new endpoints go on the local listener. Anything on the remote listener checks the device token and is reviewed for what it exposes from transcripts.
- **No secrets in transcripts' wake**: never log or push prompt text, tool input or tokens beyond what the inbox needs to show the decision.
- **Real data shapes**: fixtures copy the shape of real Claude Code transcript and hook payloads; note the Claude Code version they came from.
