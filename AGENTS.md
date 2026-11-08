# AGENTS.md

- Run `scripts/check.sh` before finishing; `--fast` skips the engine tests and the UI build. Node >= 23.6 (the engine runs TypeScript through Node's type stripping).
- npm workspaces in `packages/`: `avalokita-engine` (server, scanners, decisions, push), `tracon-cli` (`tracon` command, TUI, hooks installer), `tracon-ui` (Flight Deck and partner-app PWA).
- **The engine is a read-only observer of `~/.claude*` and `~/.gemini`.** It writes only under `~/.config/tracon` (`src/state.ts`). `check.sh` greps for write calls outside `state.ts`; keep it passing.
- `tracon hooks install|uninstall` is the only code that writes a profile's `settings.json`, and it backs each file up first. Tests must pass temp dirs to `applyHooks`; a shell with `CLAUDE_CONFIG_DIR` set once let a test write to the real `~/.claude-biz/settings.json`.
- Three listeners: local (127.0.0.1, default 4040: deck, `/api`, `/ws`), remote (127.0.0.1:4041, published only through `tailscale serve`, every request needs a paired-device token) and the hooks' Unix socket (`<TRACON_STATE>/engine.sock`, dir 0700: `/hook/*` only, reached through `tracon hook`). `/hook/*` must never be served on a TCP listener. Every hook call and every POST to the local listener needs the local secret (`x-tracon-secret`, from `State.secret()`). `/ws` takes its credential as the subprotocol `["tracon", <secret or token>]` and echoes only `"tracon"`. Both TCP listeners check `Host` (remote: loopback, `*.ts.net`, or `TRACON_REMOTE_HOST`).
- If the engine is down or slow, Claude Code's prompts must behave exactly as without TRACON. Never make a hook block past `HOLD_MAX_MS`. `tracon hook` must exit 0 with empty stdout on every failure, and the engine must keep its heartbeat (a space every 5 s) on held hooks, or `tracon hook` drops them after 15 s.
- Open setup and verification items: `TODO.md`. Gaps and next steps: `judge.md` (last section first). Design: `PLAN.md`.
- Review standard: `CODING_STANDARDS.md`.
