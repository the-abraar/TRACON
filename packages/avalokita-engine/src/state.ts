import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import webpush, { type PushSubscription } from "web-push";

/**
 * TRACON's own files under ~/.config/tracon (TRACON_STATE overrides): the device token, the web-push keys and the
 * subscribed devices. The only engine module that writes, and only these names in that directory (scripts/check.sh).
 */
type Name = "token" | "vapid.json" | "subscriptions.json";

export class State {
  readonly dir: string;

  constructor(dir = process.env.TRACON_STATE ?? join(homedir(), ".config", "tracon")) {
    this.dir = dir;
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

  /** New random device token; every paired device has to pair again. */
  rotateToken(): string {
    const t = randomBytes(32).toString("hex");
    this.write("token", t + "\n");
    return t;
  }

  /** Constant-time check of a token a device sent. No token on disk = nothing is authorized. */
  tokenOk(given: string | undefined): boolean {
    const t = this.token();
    if (!t || !given) return false;
    const a = Buffer.from(given), b = Buffer.from(t);
    return a.length === b.length && timingSafeEqual(a, b);
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
