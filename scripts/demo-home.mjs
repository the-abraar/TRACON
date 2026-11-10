#!/usr/bin/env node
// A made-up HOME for TRACON demos, screenshots and the hero clip: 5 Claude profiles, 11 sessions in acme/api, demo/web
// and oss/cli (one with three subagents), an Antigravity conversation, and a question that waits on you. Every name,
// path and number is invented; nothing is read from the real HOME.
//
//   node scripts/demo-home.mjs <dir>                 writes <dir>/home and prints the env to run an engine on it
//   node scripts/demo-home.mjs <dir> --hero <out>    also runs a scratch engine and headless Chrome on it and records
//                                                    <out>/hero.mp4 and <out>/hero.gif (about 26 s)
// CHROME and FFMPEG override the browser and ffmpeg paths.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [dirArg, flag, outArg] = process.argv.slice(2);
if (!dirArg || (flag && (flag !== "--hero" || !outArg))) {
  console.error("usage: node scripts/demo-home.mjs <dir> [--hero <outdir>]");
  process.exit(2);
}
const dir = resolve(dirArg);
const home = join(dir, "home");
const NOW = Date.now();
const iso = (t) => new Date(t).toISOString();
const put = (f, s) => (mkdirSync(join(f, ".."), { recursive: true }), writeFileSync(f, s));
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n";

// ---- Claude Code transcripts (shape of Claude Code 2.1.30x, as in packages/avalokita-engine/test/fixtures/claude)

/** Lines for one session. steps: ["user", text] | ["tool", name, input, result?] | ["tools", [[name, input], ...]] | ["text", text]. */
function claudeLines({ id, cwd, start, gap = 4000, side = false, steps }) {
  let t = start, n = 0;
  const out = [];
  const at = () => ({ isSidechain: side, timestamp: iso(t), cwd, sessionId: id });
  const usage = () => ({ input_tokens: 900 + ((n * 7919) % 5200), cache_creation_input_tokens: 400, cache_read_input_tokens: 42_000, output_tokens: 60 + ((n * 131) % 700) });
  const said = (content, stop) => out.push({ type: "assistant", ...at(), message: { id: `msg_${id.slice(0, 4)}_${++n}`, model: "claude-demo", role: "assistant", stop_reason: stop, content, usage: usage() } });
  for (const s of steps) {
    if (s[0] === "user") out.push({ type: "user", ...at(), message: { role: "user", content: s[1] } });
    if (s[0] === "text") {
      said([{ type: "text", text: s[1] }], "end_turn");
      t += 300;
      out.push({ type: "system", subtype: "turn_duration", ...at(), durationMs: gap * 3 });
    }
    if (s[0] === "tool" || s[0] === "tools") {
      const calls = s[0] === "tool" ? [[s[1], s[2]]] : s[1];
      const ids = calls.map((_c, i) => `toolu_${id.slice(0, 4)}_${n + 1}_${i}`);
      said(calls.map(([name, input], i) => ({ type: "tool_use", id: ids[i], name, input })), "tool_use");
      if (s[0] === "tool" && s[3] !== undefined) {
        t += gap / 2;
        out.push({ type: "user", ...at(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: ids[0], content: s[3] }] } });
      }
    }
    t += gap;
  }
  return out;
}

// live sessions' last calls are recent: a call with no result for 60 s shows as holding (normalizer.ts HOLD_AFTER_MS)
const PROFILES = ["", "acme", "demo", "oss", "team"]; // ~/.claude, ~/.claude-acme, ...
const profileDir = (p) => join(home, p ? `.claude-${p}` : ".claude");
const projectDir = (p, cwd) => join(profileDir(p), "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
const API = "/Users/demo/acme/api", WEB = "/Users/demo/demo/web", CLI = "/Users/demo/oss/cli";
const min = 60_000, hr = 60 * min;
const subagentBase = (s, i) => join(projectDir(s.p, s.cwd), s.id, "subagents", `agent-a${i}f${i}c${i}`);

/** A finished piece of work: prompt, a few tools, a reply. */
const done = (prompt, cwd, tools, reply) => [["user", prompt], ...tools.map(([n, i, r]) => ["tool", n, i, r ?? "ok"]), ["text", reply]];

const SESSIONS = [
  // live: a test run in flight (the clip finishes it and starts the next step)
  { p: "acme", id: "a7c31f0e-4b2d-4e7a-9c11-0d5e6f7a8b90", cwd: API, start: NOW - 40_000, gap: 2500, live: true, steps: [
    ["user", "Add idempotency keys to POST /orders and cover the retry path"],
    ["tool", "Read", { file_path: `${API}/src/routes/orders.ts` }, "export async function createOrder(...)"],
    ["tool", "Grep", { pattern: "idempotency", path: `${API}/src` }, "No matches"],
    ["tool", "Edit", { file_path: `${API}/src/routes/orders.ts`, old_string: "const order = await db.insert(", new_string: "const key = req.header(\"Idempotency-Key\");\n  const order = await db.insertOnce(key, " }, "ok"],
    ["tool", "Write", { file_path: `${API}/test/orders.retry.test.ts`, content: "test('a retried POST returns the same order', ...)" }, "ok"],
    ["tool", "Bash", { command: "npm test -- --run test/orders.retry.test.ts", description: "Run the retry tests" }],
  ] },
  // live: three subagents working in parallel under one turn
  { p: "acme", id: "c51e2a77-90b1-4c3d-8e2f-61a0b9c8d7e6", cwd: API, start: NOW - 20_000, live: true, subagents: true, steps: [
    ["user", "Find why p95 latency on /search doubled since Monday and propose a fix"],
    ["tool", "Bash", { command: "git log --since=monday --oneline -- src/search", description: "Recent search commits" }, "4f1a2b3 search: add fuzzy ranking"],
    ["tools", [
      ["Agent", { subagent_type: "Explore", description: "Map the search query path", prompt: "Trace a /search request from route to SQL" }],
      ["Agent", { subagent_type: "general-purpose", description: "Profile the ranking step", prompt: "Time each ranking stage on the fixture set" }],
      ["Agent", { subagent_type: "Plan", description: "Draft an index plan", prompt: "Propose indexes for the fuzzy query" }],
    ]],
  ] },
  // live: front-end work; the clip asks a question here
  { p: "demo", id: "8b2f4d1c-3e5a-4f6b-a7c8-d9e0f1a2b3c4", cwd: WEB, start: NOW - 40_000, gap: 2500, live: true, steps: [
    ["user", "Set up a preview environment for pull requests"],
    ["tool", "Read", { file_path: `${WEB}/package.json` }, "{ \"name\": \"demo-web\" }"],
    ["tool", "Glob", { pattern: "**/*.config.ts", path: WEB }, "vite.config.ts"],
    ["tool", "Write", { file_path: `${WEB}/.github/workflows/preview.yml`, content: "name: preview" }, "ok"],
  ] },
  { p: "oss", id: "0f3e9a8b-7c6d-4e5f-8a9b-0c1d2e3f4a5b", cwd: CLI, start: NOW - 90_000, steps: [
    ["user", "Why does `cli init --force` keep the old config?"],
    ["tool", "Read", { file_path: `${CLI}/src/commands/init.rs` }, "fn init(force: bool)"],
  ] },
  { p: "team", id: "5a90c3d2-1b0e-4f9a-8d7c-6b5a49382716", cwd: API, start: NOW - 40_000, steps: [["user", "Review the open PR for the rate limiter"]] },
  // landed
  { p: "demo", id: "d2df7e6c-5b4a-4392-8170-6f5e4d3c2b1a", cwd: WEB, start: NOW - 42 * min, steps: done("Fix the dark-mode flash on first load", WEB, [["Read", { file_path: `${WEB}/index.html` }], ["Edit", { file_path: `${WEB}/index.html`, old_string: "<html>", new_string: "<html class=\"dark\">" }], ["Bash", { command: "npm run build", description: "Build" }]], "The theme class is now set before first paint.") },
  { p: "", id: "77aa1c2b-3d4e-4f5a-9b6c-7d8e9f0a1b2c", cwd: API, start: NOW - 2 * hr, steps: done("Bump the Node version in CI to 24", API, [["Read", { file_path: `${API}/.github/workflows/ci.yml` }], ["Edit", { file_path: `${API}/.github/workflows/ci.yml`, old_string: "node-version: 22", new_string: "node-version: 24" }]], "CI now runs on Node 24.") },
  { p: "", id: "3d19b8a7-6c5d-4e3f-a2b1-c0d9e8f7a6b5", cwd: CLI, start: NOW - 70 * min, steps: done("Add a --json flag to `cli status`", CLI, [["Read", { file_path: `${CLI}/src/commands/status.rs` }], ["Edit", { file_path: `${CLI}/src/commands/status.rs`, old_string: "println!", new_string: "if json { serde_json::to_writer(...) }" }], ["Bash", { command: "cargo test status", description: "Run status tests" }]], "Done: `cli status --json` prints one object per target.") },
  { p: "oss", id: "ebab4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d", cwd: CLI, start: NOW - 3 * hr, steps: done("Write release notes for 0.9.0", CLI, [["Bash", { command: "git log v0.8.0..HEAD --oneline", description: "Changes since 0.8.0" }], ["Write", { file_path: `${CLI}/CHANGELOG.md`, content: "## 0.9.0" }]], "Release notes are in CHANGELOG.md.") },
  { p: "team", id: "e0e1f2a3-b4c5-4d6e-8f70-81a2b3c4d5e6", cwd: WEB, start: NOW - 5 * hr, steps: done("Translate the settings page to German", WEB, [["Read", { file_path: `${WEB}/src/i18n/en.json` }], ["Write", { file_path: `${WEB}/src/i18n/de.json`, content: "{}" }]], "Added de.json with 48 strings.") },
  { p: "acme", id: "19c4d5e6-f7a8-4b9c-8d0e-1f2a3b4c5d6e", cwd: API, start: NOW - 6 * hr, steps: done("Rotate the staging database password in the docs", API, [["Grep", { pattern: "STAGING_DB", path: `${API}/docs` }], ["Edit", { file_path: `${API}/docs/staging.md`, old_string: "old", new_string: "see the vault" }]], "The docs now point at the vault entry.") },
];

const SUBAGENTS = [
  ["Explore", [["user", "Trace a /search request from route to SQL"], ["tool", "Grep", { pattern: "fuzzyRank", path: `${API}/src` }, "src/search/rank.ts"], ["tool", "Read", { file_path: `${API}/src/search/rank.ts` }]]],
  ["general-purpose", [["user", "Time each ranking stage on the fixture set"], ["tool", "Bash", { command: "node bench/rank.mjs --stages", description: "Benchmark ranking stages" }]]],
  ["Plan", [["user", "Propose indexes for the fuzzy query"], ["tool", "Read", { file_path: `${API}/db/schema.sql` }, "CREATE TABLE items (...)"]]],
];

function writeHome() {
  rmSync(home, { recursive: true, force: true });
  for (const p of PROFILES) mkdirSync(join(profileDir(p), "projects"), { recursive: true });
  for (const [i, s] of SESSIONS.entries()) {
    const file = join(projectDir(s.p, s.cwd), `${s.id}.jsonl`);
    put(file, JSON.stringify({ type: "permission-mode", permissionMode: "default", sessionId: s.id }) + "\n" + jsonl(claudeLines(s)));
    if (s.live) put(join(profileDir(s.p), "sessions", `${process.pid}${i}.json`), JSON.stringify({ pid: process.pid, sessionId: s.id, status: "busy" }));
    if (s.subagents)
      SUBAGENTS.forEach(([type, steps], i) => {
        const base = subagentBase(s, i);
        put(`${base}.jsonl`, jsonl(claudeLines({ id: s.id, cwd: s.cwd, start: NOW - 10_000 + i * 1000, gap: 3000, side: true, steps })));
        put(`${base}.meta.json`, JSON.stringify({ agentType: type, description: steps[0][1] }));
      });
  }
  // Antigravity: <brain>/<conversation>/.system_generated/logs/transcript.jsonl (shape of test/fixtures/agy)
  const t0 = NOW - 25 * min, ts = (i) => iso(t0 + i * 20_000), q = (s) => JSON.stringify(s);
  put(join(home, ".gemini", "antigravity-cli", "brain", "37ac5e10-9d8c-4b7a-a6f5-e4d3c2b1a090", ".system_generated", "logs", "transcript.jsonl"), jsonl([
    { type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", step_index: 0, created_at: ts(0), content: "Add shell completions for zsh and fish" },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", step_index: 1, created_at: ts(1), input_tokens: 4200, output_tokens: 310, tool_calls: [{ name: "view_file", args: { AbsolutePath: q(`${CLI}/src/main.rs`), toolSummary: "Read main.rs" } }] },
    { type: "GENERIC", source: "MODEL", status: "DONE", step_index: 2, created_at: ts(2), content: "fn main()" },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", step_index: 3, created_at: ts(3), input_tokens: 5100, output_tokens: 820, tool_calls: [{ name: "write_to_file", args: { TargetFile: q(`${CLI}/src/completions.rs`), CodeContent: "pub fn zsh()", toolSummary: "Write completions" } }] },
    { type: "GENERIC", source: "MODEL", status: "DONE", step_index: 4, created_at: ts(4), content: "written" },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", step_index: 5, created_at: ts(5), input_tokens: 5600, output_tokens: 140, tool_calls: [{ name: "run_command", args: { CommandLine: "cargo build", Cwd: q(CLI), toolSummary: "Build" } }] },
    { type: "GENERIC", source: "MODEL", status: "DONE", step_index: 6, created_at: ts(6), content: "Finished" },
    { type: "PLANNER_RESPONSE", source: "MODEL", status: "DONE", step_index: 7, created_at: ts(7), input_tokens: 5900, output_tokens: 95, tool_calls: [] },
  ]));
  // usage mirrors in the statusline-usage.py format (packages/avalokita-engine/src/quota.ts)
  const reset = (h) => new Date(NOW + h * hr).toISOString().replace("T", " ").slice(0, 16) + " +00";
  [["", 42, 61], ["acme", 88, 47], ["demo", 12, 38], ["oss", 64, 22], ["team", 5, 91]].forEach(([p, five, week], i) =>
    put(join(home, "usage", `usage-${p || "default"}.md`), `# Claude usage (mirror)\n\n**5-hour window: ${five}% used.** Resets ${reset(1 + i * 0.5)}\n**7-day window: ${week}% used.** Resets ${reset(30 + i * 9)}\n\nUpdated: (epoch ${Math.floor(NOW / 1000) - 40})\n`),
  );
}

/** The engine settings for this home (state outside it: the socket path must stay under 104 bytes). */
const engineEnv = (state, port, remotePort) => ({
  PATH: process.env.PATH,
  HOME: home,
  TRACON_STATE: state,
  TRACON_PORT: String(port),
  TRACON_REMOTE_PORT: String(remotePort),
  TRACON_WINDOW_MIN: "480",
  TRACON_TIERS: "ACME=team_100,DEMO=team_100,TEAM=api_usage",
  TRACON_QUOTA: PROFILES.map((p) => `${p.toUpperCase()}=${join(home, "usage", `usage-${p || "default"}.md`)}`).join(","),
}); // no CLAUDE_CONFIG_DIR: the engine must scan only this home

writeHome();

if (!flag) {
  const env = engineEnv(join(dir, "state"), 4140, 4141);
  console.log(`Wrote ${home}. Run an engine on it:\n  ${Object.entries(env).filter(([k]) => k !== "PATH").map(([k, v]) => `${k}='${v}'`).join(" ")} node packages/tracon-cli/bin/tracon.js start --no-open`);
  process.exit(0);
}

// ---- --hero: scratch engine + headless Chrome over CDP, frames to ffmpeg
const repo = fileURLToPath(new URL("..", import.meta.url));
const out = resolve(outArg);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
const scratch = mkdtempSync(join(tmpdir(), "tracon-demo-"));
const kids = [];
process.on("exit", () => { for (const k of kids) k.kill(); rmSync(scratch, { recursive: true, force: true }); });

const [port, remotePort] = [await freePort(), await freePort()];
const env = engineEnv(join(scratch, "state"), port, remotePort);
const tracon = (...args) => spawn(process.execPath, [join(repo, "packages/tracon-cli/bin/tracon.js"), ...args], { env, stdio: ["pipe", "pipe", "inherit"] });
kids.push(tracon("start", "--no-open"));
const base = `http://127.0.0.1:${port}`;
for (let i = 0; !(await fetch(`${base}/api/flights`).then((r) => r.ok, () => false)); i++) {
  if (i > 100) throw new Error("engine did not start");
  await sleep(100);
}
execFileSync(process.execPath, [join(repo, "packages/tracon-cli/bin/tracon.js"), "away", "on"], { env, stdio: "ignore" }); // questions are held only while away

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${join(scratch, "chrome")}`, "--hide-scrollbars", "--no-first-run", "--window-size=1440,900", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
kids.push(chrome);
const wsUrl = await new Promise((ok) => { let s = ""; chrome.stderr.on("data", (c) => { s += c; const m = /DevTools listening on (ws:\S+)/.exec(s); if (m) ok(m[1]); }); });
const page = (await (await fetch(`http://${new URL(wsUrl).host}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((ok) => (ws.onopen = ok));
let seq = 0;
const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); waiting.get(m.id)?.(m); waiting.delete(m.id); };
const cdp = (method, params = {}) => new Promise((ok, no) => { const id = ++seq; waiting.set(id, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result))); ws.send(JSON.stringify({ id, method, params })); });
const js = (expr) => cdp("Runtime.evaluate", { expression: expr, awaitPromise: true });
const click = (text, scope = "button") => js(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); b?.scrollIntoView({ block: "center" }); b?.click(); return !!b; })()`);

await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }); // the deck's default look
await cdp("Page.navigate", { url: base });
await sleep(2500);

// the timeline: what changes while the camera runs (ms from the start of the clip)
const live = SESSIONS[0], ask = SESSIONS[2], subs = SESSIONS[1];
const fileOf = (s) => join(projectDir(s.p, s.cwd), `${s.id}.jsonl`);
const more = (s, steps, start = Date.now()) => appendFileSync(fileOf(s), jsonl(claudeLines({ ...s, start, gap: 1500, steps })));
const pendingId = (s) => { const l = readFileSync(fileOf(s), "utf8").trim().split("\n").map((x) => JSON.parse(x)); return l.findLast((x) => x.message?.content?.[0]?.type === "tool_use").message.content[0].id; };
const result = (s, content) => appendFileSync(fileOf(s), JSON.stringify({ type: "user", isSidechain: false, timestamp: iso(Date.now()), cwd: s.cwd, sessionId: s.id, message: { role: "user", content: [{ type: "tool_result", tool_use_id: pendingId(s), content }] } }) + "\n");
const QUESTION = { questions: [{ question: "Which database should preview environments use?", header: "Database", multiSelect: false, options: [{ label: "Postgres", description: "Same engine as production, one container per preview" }, { label: "SQLite", description: "Starts instantly, no container" }] }] };
let hook;
const timeline = [
  [2000, () => (result(live, "2 passed"), more(live, [["tool", "Bash", { command: "npm run lint -- src/routes", description: "Lint the routes" }]]))],
  [4000, () => appendFileSync(`${subagentBase(subs, 0)}.jsonl`, jsonl(claudeLines({ id: subs.id, cwd: subs.cwd, start: Date.now(), side: true, steps: [["tool", "Read", { file_path: `${API}/src/search/index.ts` }]] })))],
  [6000, () => {
    more(ask, [["tool", "AskUserQuestion", QUESTION]]);
    const h = tracon("hook", "pre-tool-use");
    hook = new Promise((ok) => { let s = ""; h.stdout.on("data", (c) => (s += c)); h.on("close", () => ok(s.trim())); });
    h.stdin.end(JSON.stringify({ hook_event_name: "PreToolUse", session_id: ask.id, transcript_path: fileOf(ask), cwd: ask.cwd, tool_name: "AskUserQuestion", tool_input: QUESTION }));
  }],
  [8000, () => js("window.scrollTo(0, 0)")],
  [11500, () => click("Postgres")],
  [13000, () => click("SEND ANSWER")],
  [14000, () => (result(ask, "User answered: Postgres"), more(ask, [["tool", "Edit", { file_path: `${WEB}/.github/workflows/preview.yml`, old_string: "services: {}", new_string: "services:\n  db: postgres:17" }]]))],
  [15000, () => (result(live, "0 problems"), more(live, [["text", "Idempotency keys are in; the retry test passes."]]))],
  [17500, () => js(`(() => { const a = [...document.querySelectorAll("article")].find((e) => e.textContent.includes("CL-ACME-C51E")); const b = [...(a?.querySelectorAll("button") ?? [])].find((e) => e.textContent.includes("VIEW DAG")); b?.click(); window.scrollTo(0, 0); return !!b; })()`)],
];
const CLIP_MS = 26_000;
const frames = join(scratch, "frames");
mkdirSync(frames);
const t0 = Date.now();
let next = 0, n = 0;
while (Date.now() - t0 < CLIP_MS) {
  while (next < timeline.length && Date.now() - t0 >= timeline[next][0]) await timeline[next++][1]();
  const { data } = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 92 });
  writeFileSync(join(frames, `f${String(n++).padStart(4, "0")}.jpg`), Buffer.from(data, "base64"));
}
const fps = (n / (Date.now() - t0)) * 1000;
const dom = (await js("document.body.innerText")).result.value;
writeFileSync(join(dir, "hero-text.txt"), dom); // for the privacy grep
console.log(`tracon hook printed: ${(await hook).slice(0, 160)}`); // the answer Claude Code would get

mkdirSync(out, { recursive: true });
const ff = (...a) => execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", fps.toFixed(3), "-i", join(frames, "f%04d.jpg"), ...a]);
ff("-vf", "fps=15,format=yuv420p", "-c:v", "libx264", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", join(out, "hero.mp4"));
ff("-vf", "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", join(out, "hero.gif"));
for (const f of ["hero.mp4", "hero.gif"]) console.log(`${join(out, f)}: ${(statSync(join(out, f)).size / 1e6).toFixed(2)} MB, ${n} frames at ${fps.toFixed(1)} fps`);
process.exit(0);
