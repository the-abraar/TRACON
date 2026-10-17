// A paired device (reaching the engine through `tailscale serve`) sends the token from its `tracon pair` link with every
// request; the deck on the Mac itself needs none.
const KEY = "tracon.token";

/** Saves the token of a #pair=<token> link and takes it out of the address bar. */
export function takePairToken(): void {
  if (!/^#pair=[0-9a-f]{64}$/.test(location.hash)) return;
  savePairToken(location.hash);
  history.replaceState(null, "", location.pathname);
}

/** Saves the token from a pasted pair link (or the bare token). The Home Screen app on iOS has its own storage and no
 * address bar, so pasting is how it pairs. Returns false when the text holds no token or storage is blocked. */
export function savePairToken(text: string): boolean {
  const m = /(?:^|#pair=)([0-9a-f]{64})$/.exec(text.trim());
  if (!m) return false;
  try {
    localStorage.setItem(KEY, m[1]!);
    return true;
  } catch {
    return false; // storage blocked: this device cannot stay paired
  }
}

export function token(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export const isLocal = () => /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

export function api(path: string, init: RequestInit = {}): Promise<Response> {
  const t = token();
  return fetch(path, { ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(t ? { authorization: `Bearer ${t}` } : {}) } });
}

export const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

export function wsUrl(): string {
  const t = token();
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${t ? `?t=${t}` : ""}`;
}
