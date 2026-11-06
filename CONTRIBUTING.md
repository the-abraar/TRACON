# Contributing to TRACON

Thanks for helping. TRACON is a local, read-only monitor for AI coding agent sessions (Claude Code, Antigravity) with a browser Flight Deck and a phone partner app.

## Setup

Needs Node 23.6 or newer (the engine runs TypeScript through Node's type stripping, no build step).

```bash
npm ci            # installs all workspaces in packages/
npm start         # builds the UI and runs the engine + Flight Deck on http://127.0.0.1:4040
npm run dev:ui    # Vite dev server for packages/tracon-ui
```

## Checks

```bash
scripts/check.sh          # everything: typecheck, guards, tests, UI build
scripts/check.sh --fast   # typecheck and guards only
npm test                  # tests only
```

`scripts/check.sh` must pass before a PR is merged. One guard is strict: the engine (`packages/avalokita-engine/src`) must never write to agent config dirs such as `~/.claude*` or `~/.gemini`. Only `state.ts` writes, and only under `~/.config/tracon`.

## Picking an issue

- Start with issues labelled [`good first issue`](https://github.com/the-abraar/TRACON/labels/good%20first%20issue) or [`help wanted`](https://github.com/the-abraar/TRACON/labels/help%20wanted). Each has a `difficulty:` label.
- Comment on the issue before you start so two people don't build the same thing.
- Unsure about the design? Ask on the issue first. `PLAN.md` holds the spec, `CODING_STANDARDS.md` the house style.

## Pull requests

- One change per PR, linked to its issue (`Fixes #N`).
- Add or update a test in the package's `test/` folder for any logic change. Parser changes come with a small fixture in `packages/avalokita-engine/test/fixtures/`.
- Never commit real session transcripts: they can hold secrets and private code. Write a minimal fake one.
- Say in the PR what you ran (`scripts/check.sh` output) and, for UI changes, add a screenshot.

By contributing you agree your work is licensed under the Apache License 2.0 (see `LICENSE`).
