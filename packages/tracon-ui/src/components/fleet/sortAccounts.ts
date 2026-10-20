import type { Account, QuotaWindow } from "../../../../avalokita-engine/src/types.ts";

const reset = (w?: QuotaWindow) => (w?.resetsAt ? Date.parse(w.resetsAt) : undefined);

/** Lower rank = better (more quota left, sooner reset, fewer tokens). undefined = no data. */
export const SORTS = {
  profile: { label: "Profile", rank: (_: Account, i: number): number | undefined => i },
  fiveLeft: { label: "5-hour left", rank: (a: Account) => a.fiveHour?.pct },
  weekLeft: { label: "Weekly left", rank: (a: Account) => a.weekly?.pct },
  fiveReset: { label: "5-hour reset", rank: (a: Account) => reset(a.fiveHour) },
  weekReset: { label: "Weekly reset", rank: (a: Account) => reset(a.weekly) },
  tokens: { label: "Tokens used", rank: (a: Account) => a.tokens },
};
export type SortKey = keyof typeof SORTS;

/** Best first unless `worstFirst`; accounts without the data always go last. */
export function sortAccounts(accounts: Account[], key: SortKey, worstFirst: boolean): Account[] {
  return accounts
    .map((a, i) => ({ a, v: SORTS[key].rank(a, i) }))
    .sort((x, y) => (x.v === undefined ? (y.v === undefined ? 0 : 1) : y.v === undefined ? -1 : worstFirst ? y.v - x.v : x.v - y.v))
    .map((x) => x.a);
}

/** How far apart two accounts are on the sort's measure; undefined in profile order or when either lacks the data. */
export function gap(key: SortKey, a: Account, b: Account): number | undefined {
  if (key === "profile") return undefined;
  const rank: (a: Account, i: number) => number | undefined = SORTS[key].rank;
  const x = rank(a, 0);
  const y = rank(b, 0);
  return x === undefined || y === undefined ? undefined : Math.abs(x - y);
}
