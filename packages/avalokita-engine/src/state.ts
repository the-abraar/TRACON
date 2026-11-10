import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import webpush, { type PushSubscription } from "web-push";

/**
 * TRACON's own files under ~/.config/tracon (TRACON_STATE overrides): the device token, the local secret, the web-push
 * keys, the subscribed devices and the hooks' socket (engine.sock). The only engine module that writes, and only these
 * names in that directory (scripts/check.sh).
 */
type Name = "token" | "secret" | "vapid.json" | "subscriptions.json";

/** Constant-time comparison; nothing on disk = nothing is authorized. */
function same(given: string | undefined, want: string | undefined): boolean {
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class State {
  readonly dir: string;
  /** The Unix socket the hooks (`tracon hook`) talk to. */
  readonly sock: string;

  constructor(dir = process.env.TRACON_STATE ?? join(homedir(), ".config", "tracon")) {
    this.dir = dir;
    this.sock = join(dir, "engine.sock");
  }

  private read(name: Name): string | undefined {
    try {
      return readFileSync(join(this.dir, name), "utf8");
    } catch {
      return undefined;
    }
  }

  private write(name: Name, data: string): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(this.dir, name), data, { mode: 0o600 });
  }

  token(): string | undefined {
    return this.read("token")?.trim() || undefined;
  }

  /** New random device token; every paired device has to pair again, and gets no pushes until it has. */
  rotateToken(): string {
    const t = randomBytes(32).toString("hex");
    this.write("token", t + "\n");
    this.saveSubscriptions([]);
    return t;
  }

  /** Check of a token a device sent. */
  tokenOk(given: string | undefined): boolean {
    return same(given, this.token());
  }

  /** The secret that state-changing requests to the local port carry (hooks, the deck, the CLI). Made on first use, then kept. */
  secret(): string {
    const s = this.read("secret")?.trim();
    if (s) return s;
    const t = randomBytes(32).toString("hex");
    this.write("secret", t + "\n");
    return t;
  }

  /** A new secret; the old one stops working at once. Open Flight Deck pages need a reload. */
  rotateSecret(): string {
    const t = randomBytes(32).toString("hex");
    // temp file + rename: a hook or secret() reading at the same moment sees the old or the new secret, never an empty file
    // A leftover temp file (crash, reused pid) may have wider permissions: remove it and create a fresh one exclusively.
    const tmp = join(this.dir, `secret.${process.pid}.tmp`);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    rmSync(tmp, { force: true });
    writeFileSync(tmp, t + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmp, join(this.dir, "secret"));
    return t;
  }

  secretOk(given: string | undefined): boolean {
    return same(given, this.read("secret")?.trim());
  }

  /**
   * Readies the socket path for the engine to listen on: the state dir made 0700 (so no other user can connect), and a
   * socket a dead engine left behind removed. Refuses while another engine still answers on it.
   */
  async freeSocket(): Promise<string> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    chmodSync(this.dir, 0o700);
    if (existsSync(this.sock)) {
      const live = await new Promise<boolean>((ok) => {
        const s = connect(this.sock).once("connect", () => (s.destroy(), ok(true))).once("error", () => ok(false));
      });
      if (live) throw new Error(`another engine is already listening on ${this.sock}`);
      rmSync(this.sock, { force: true });
    }
    return this.sock;
  }

  vapid(): { publicKey: string; privateKey: string } {
    try {
      const k = JSON.parse(this.read("vapid.json") ?? "");
      if (k.publicKey && k.privateKey) return k;
    } catch {
      /* first run: generate below */
    }
    const k = webpush.generateVAPIDKeys();
    this.write("vapid.json", JSON.stringify(k));
    return k;
  }

  subscriptions(): PushSubscription[] {
    try {
      const s = JSON.parse(this.read("subscriptions.json") ?? "[]");
      return Array.isArray(s) ? s : [];
    } catch {
      return [];
    }
  }

  saveSubscriptions(subs: PushSubscription[]): void {
    this.write("subscriptions.json", JSON.stringify(subs, null, 1));
  }
}
