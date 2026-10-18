# AGENTS.md

- Run `scripts/check.sh` before finishing; `--fast` skips the engine tests and the UI build. Node >= 23.6 (the engine runs TypeScript through Node's type stripping).
- npm workspaces in `packages/`: `avalokita-engine` (server, scanners, decisions, push), `tracon-cli` (`tracon` command, TUI, hooks installer), `tracon-ui` (Flight Deck and partner-app PWA).
- **The engine is a read-only observer of `~/.claude*` and `~/.gemini`.** It writes only under `~/.config/tracon` (`src/state.ts`). `check.sh` greps for write calls outside `state.ts`; keep it passing.
- `tracon hooks install|uninstall` is the only code that writes a profile's `settings.json`, and it backs each file up first. Tests must pass temp dirs to `applyHooks`; a shell with `CLAUDE_CONFIG_DIR` set once let a test write to the real `~/.claude-biz/settings.json`.
- Two listeners, both on 127.0.0.1: local (default 4040: deck, `/api`, `/ws`, `/hook/*`) and remote (4041, published only through `tailscale serve`, every request needs a paired-device token). `/hook/*` must never be reachable from the remote listener. Every POST to the local listener needs the local secret (`x-tracon-secret`, from `State.secret()`).
- If the engine is down or slow, Claude Code's prompts must behave exactly as without TRACON. Never make a hook block past `HOLD_MAX_MS`.
- Open setup and verification items: `TODO.md`. Gaps and next steps: `judge.md` (last section first). Design: `PLAN.md`.
- Review standard: `CODING_STANDARDS.md`.
