// A paired device (reaching the engine through `tailscale serve`) sends the token from its `tracon pair` link with every
// request; the deck on the Mac itself needs none.
const KEY = "tracon.token";

/** Saves the token of a #pair=<token> link and takes it out of the address bar. */
export function takePairToken(): void {
  const m = /^#pair=([0-9a-f]{64})$/.exec(location.hash);
  if (!m) return;
  try {
    localStorage.setItem(KEY, m[1]!);
  } catch {
    /* storage blocked: this device cannot stay paired */
  }
  history.replaceState(null, "", location.pathname);
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
