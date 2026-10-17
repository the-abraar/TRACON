import webpush, { type PushSubscription } from "web-push";
import type { State } from "./state.ts";
import type { Decision } from "./types.ts";

// Apple's push service rejects VAPID subjects without a real-looking address
const SUBJECT = "mailto:tracon@users.noreply.github.com";

/** A device's push subscription as the browser's PushSubscription.toJSON() gives it; undefined if malformed. */
export function parseSubscription(v: any): PushSubscription | undefined {
  const ok = typeof v?.endpoint === "string" && /^https:\/\//.test(v.endpoint) && typeof v.keys?.p256dh === "string" && typeof v.keys?.auth === "string";
  return ok ? { endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } } : undefined;
}

/** Notification text for a held decision: the first question, the plan's title, or the command/file. */
export function pushBody(d: Decision): { title: string; body: string; id: string } {
  const i = d.input as Record<string, any>;
  const first =
    d.kind === "question"
      ? String(i.questions?.[0]?.question ?? "Question")
      : d.kind === "plan"
        ? `Plan approval: ${(String(i.plan ?? "").split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "")}`
        : `${d.tool}: ${String(i.command ?? i.file_path ?? i.url ?? i.pattern ?? JSON.stringify(i))}`;
  return { title: `${d.callsign} needs you`, body: first.slice(0, 160), id: d.id };
}

/** Web push (encrypted end to end; Apple/Google relay it) to every subscribed device. Dead subscriptions are dropped. */
export class Pusher {
  private state: State;

  constructor(state: State) {
    this.state = state;
  }

  key(): string {
    return this.state.vapid().publicKey;
  }

  subscribe(sub: PushSubscription): void {
    const subs = this.state.subscriptions().filter((s) => s.endpoint !== sub.endpoint);
    this.state.saveSubscriptions([...subs, sub]);
  }

  async send(d: Decision): Promise<void> {
    const subs = this.state.subscriptions();
    if (!subs.length) return;
    const { publicKey, privateKey } = this.state.vapid();
    const payload = JSON.stringify(pushBody(d));
    const dead = new Set<string>();
    await Promise.all(
      subs.map((s) =>
        webpush.sendNotification(s, payload, { TTL: 3600, urgency: "high", vapidDetails: { subject: SUBJECT, publicKey, privateKey } }).catch((e: { statusCode?: number }) => {
          if (e.statusCode === 404 || e.statusCode === 410) dead.add(s.endpoint);
        }),
      ),
    );
    if (dead.size) this.state.saveSubscriptions(this.state.subscriptions().filter((s) => !dead.has(s.endpoint)));
  }
}
