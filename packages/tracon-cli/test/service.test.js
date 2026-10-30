import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { LABEL, onPath, plist, plistPath, serviceState, traconEnv } from "../src/service.js";

const tmp = mkdtempSync(join(tmpdir(), "tracon-service-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const mac = process.platform === "darwin";

test("the plist keeps the engine alive, starts at login, logs, and escapes paths", () => {
  const body = plist(["/a&b/node", "/x/tracon.js", "start", "--no-open"], "/L<og>/tracon.log");
  for (const key of ["KeepAlive", "RunAtLoad"]) assert.match(body, new RegExp(`<key>${key}</key>\\s*<true/>`));
  assert.match(body, /<string>\/a&amp;b\/node<\/string>\s*<string>\/x\/tracon.js<\/string>\s*<string>start<\/string>\s*<string>--no-open<\/string>/);
  assert.match(body, /<key>StandardErrorPath<\/key>\s*<string>\/L&lt;og&gt;\/tracon.log<\/string>/);
  assert.equal(plistPath("/h"), `/h/Library/LaunchAgents/${LABEL}.plist`);
  if (mac) {
    writeFileSync(join(tmp, "t.plist"), body);
    execFileSync("plutil", ["-lint", join(tmp, "t.plist")]); // throws if launchd couldn't parse it
  }
});

test("the plist carries the shell's TRACON_* settings, and only those", () => {
  const env = traconEnv({ TRACON_PORT: "5050", TRACON_STATE: "/s&t", HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
  assert.deepEqual(env, { TRACON_PORT: "5050", TRACON_STATE: "/s&t" });
  const body = plist(["/node"], "/log", env);
  assert.match(body, /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>TRACON_PORT<\/key>\s*<string>5050<\/string>\s*<key>TRACON_STATE<\/key>\s*<string>\/s&amp;t<\/string>\s*<\/dict>/);
  assert.doesNotMatch(plist(["/node"], "/log"), /EnvironmentVariables/);
  if (mac) {
    writeFileSync(join(tmp, "e.plist"), body);
    execFileSync("plutil", ["-lint", join(tmp, "e.plist")]);
  }
});

test("onPath prefers the PATH entry over the fallback and skips relative entries", () => {
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "node"), "");
  chmodSync(join(bin, "node"), 0o755);
  assert.equal(onPath("node", `relative:${join(tmp, "none")}:${bin}`, "/fallback"), join(bin, "node"));
  assert.equal(onPath("node", "", "/fallback"), "/fallback");
  assert.equal(onPath("node", undefined, "/fallback"), "/fallback");
});

test("serviceState reads launchctl print", () => {
  assert.equal(serviceState("gui/501/x = {\n\tpath = /p\n\tstate = running\n\tpid = 709\n\t\tstate = active\n}"), "running, pid 709");
  assert.equal(serviceState("x = {\n\tstate = not running\n}"), "not running");
  assert.equal(serviceState(undefined), undefined);
});

test("service install --dry-run on a temp HOME prints the plist and writes nothing", { skip: !mac && "launchd is macOS only" }, () => {
  const home = join(tmp, "home");
  mkdirSync(home);
  const cli = join(import.meta.dirname, "../bin/tracon.js");
  // PATH without launchctl: even if --dry-run broke, this test could never boot out the owner's running engine
  const env = { ...process.env, HOME: home, PATH: join(tmp, "no-bin"), TRACON_PORT: "5050" };
  const out = execFileSync(process.execPath, [cli, "service", "install", "--dry-run"], { encoding: "utf8", env });
  assert.match(out, new RegExp(`would write ${plistPath(home)}`));
  assert.match(out, /<key>KeepAlive<\/key>/);
  assert.match(out, /<key>TRACON_PORT<\/key>\s*<string>5050<\/string>/, "the shell's port reaches the agent");
  assert.match(out, /would run: launchctl bootstrap gui\/\d+ /);
  assert.equal(existsSync(join(home, "Library")), false);
});
