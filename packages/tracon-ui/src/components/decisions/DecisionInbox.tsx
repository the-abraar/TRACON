import { Check, ClipboardList, KeyRound, MessageCircleQuestion, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Answer, Decision } from "../../../../avalokita-engine/src/types.ts";
import { post } from "../../lib/remote.ts";
import { permissionTarget, questionAnswer, questionsOf } from "./answer.ts";

const KIND: Record<Decision["kind"], { label: string; icon: LucideIcon }> = {
  question: { label: "QUESTION", icon: MessageCircleQuestion },
  plan: { label: "PLAN APPROVAL", icon: ClipboardList },
  permission: { label: "PERMISSION", icon: KeyRound },
};

const since = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
};

const btn = "rounded border px-3 py-2 font-mono text-xs disabled:opacity-40 min-h-11";
const input = "w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none";

/** Prompts held open by Claude Code hooks, answerable from any paired device. Answered cards vanish with the next snapshot. */
export function DecisionInbox({ decisions, focus }: { decisions: Decision[]; focus?: string }) {
  if (!decisions.length) return null;
  return (
    <section aria-label="Held decisions" className="mb-4 grid gap-3">
      <h2 className="font-mono text-xs tracking-widest text-amber-300">HELD DECISIONS · {decisions.length}</h2>
      {decisions.map((d) => (
        <DecisionCard key={d.id} d={d} focused={d.id === focus} />
      ))}
    </section>
  );
}

function DecisionCard({ d, focused }: { d: Decision; focused: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focused]);

  const send = async (a: Answer) => {
    setBusy(true);
    setError(undefined);
    const r = await post("/api/answer", a).catch(() => undefined);
    setBusy(false);
    if (!r) setError("Engine unreachable. Check Tailscale and that tracon is running.");
    else if (r.status === 409) setError("Already answered, or handed back to the terminal.");
    else if (!r.ok) setError("The engine did not accept this answer.");
  };
  const { label, icon: Icon } = KIND[d.kind];

  return (
    <article ref={ref} className={`rounded-lg border bg-slate-900/80 p-4 ${focused ? "border-amber-300 ring-2 ring-amber-400/60" : "border-amber-500/70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />
            <span className="font-mono text-base font-bold text-slate-100">{d.callsign}</span>
            <span className="rounded bg-amber-500 px-1.5 font-mono text-[10px] font-semibold text-black">{label}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500" title={d.cwd}>
            {d.cwd.split("/").slice(-2).join("/") || "unknown cwd"} · waiting {since(d.createdAt)}
          </div>
        </div>
      </div>
      <div className="mt-3">
        {d.kind === "question" && <QuestionForm d={d} busy={busy} send={send} />}
        {d.kind === "plan" && <PlanForm d={d} busy={busy} send={send} />}
        {d.kind === "permission" && <PermissionForm d={d} busy={busy} send={send} />}
      </div>
      {error && (
        <p role="alert" className="mt-2 font-mono text-xs text-red-300">
          {error}
        </p>
      )}
    </article>
  );
}

type FormProps = { d: Decision; busy: boolean; send: (a: Answer) => void };

function QuestionForm({ d, busy, send }: FormProps) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const answer = questionAnswer(d, picked, other);
  const toggle = (q: string, label: string, multi?: boolean) =>
    setPicked((p) => {
      const cur = p[q] ?? [];
      return { ...p, [q]: multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
    });
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer) send(answer);
      }}
    >
      {questionsOf(d).map((q) => (
        <fieldset key={q.question} className="grid gap-2">
          <legend className="mb-1 text-sm text-slate-100">
            {q.header && <span className="mr-2 rounded border border-slate-700 px-1 font-mono text-[10px] text-slate-400">{q.header}</span>}
            {q.question}
            {q.multiSelect && <span className="ml-1 text-xs text-slate-500">(pick any)</span>}
          </legend>
          {q.options.map((o) => {
            const on = picked[q.question]?.includes(o.label) ?? false;
            return (
              <button
                key={o.label}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(q.question, o.label, q.multiSelect)}
                className={`rounded border px-3 py-2 text-left min-h-11 ${on ? "border-amber-400 bg-amber-500/15 text-amber-100" : "border-slate-700 text-slate-200 hover:border-slate-500"}`}
              >
                <div className="text-sm">{o.label}</div>
                {o.description && <div className="text-xs text-slate-400">{o.description}</div>}
              </button>
            );
          })}
          <input
            className={input}
            aria-label={`Other answer to: ${q.question}`}
            placeholder="Other: type your own answer"
            value={other[q.question] ?? ""}
            onChange={(e) => setOther((o) => ({ ...o, [q.question]: e.target.value }))}
          />
        </fieldset>
      ))}
      <button type="submit" disabled={busy || !answer} className={`${btn} border-amber-400 bg-amber-500 font-semibold text-black`}>
        SEND ANSWER
      </button>
    </form>
  );
}

function PlanForm({ d, busy, send }: FormProps) {
  const [feedback, setFeedback] = useState("");
  return (
    <div className="grid gap-2">
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-950/70 p-3 text-xs text-slate-200">{String(d.input.plan ?? "")}</pre>
      <textarea className={input} rows={2} aria-label="Feedback if you reject the plan" placeholder="Feedback (sent if you reject)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => send({ id: d.id, kind: "plan", approve: false, feedback })} className={`${btn} flex items-center justify-center gap-1 border-red-700 text-red-200`}>
          <X className="h-3.5 w-3.5" aria-hidden /> REJECT
        </button>
        <button type="button" disabled={busy} onClick={() => send({ id: d.id, kind: "plan", approve: true })} className={`${btn} flex items-center justify-center gap-1 border-emerald-500 bg-emerald-600 font-semibold text-black`}>
          <Check className="h-3.5 w-3.5" aria-hidden /> APPROVE
        </button>
      </div>
    </div>
  );
}

function PermissionForm({ d, busy, send }: FormProps) {
  const [message, setMessage] = useState("");
  const desc = typeof d.input.description === "string" ? d.input.description : undefined;
  return (
    <div className="grid gap-2">
      <div className="text-sm text-slate-200">
        <span className="font-mono text-cyan-200">{d.tool}</span>
        {desc && <span className="text-slate-400"> · {desc}</span>}
      </div>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950/70 p-3 text-xs text-slate-200">{permissionTarget(d)}</pre>
      <input className={input} aria-label="Reason if you deny" placeholder="Reason (sent if you deny)" value={message} onChange={(e) => setMessage(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => send({ id: d.id, kind: "permission", allow: false, message })} className={`${btn} flex items-center justify-center gap-1 border-red-700 text-red-200`}>
          <X className="h-3.5 w-3.5" aria-hidden /> DENY
        </button>
        <button type="button" disabled={busy} onClick={() => send({ id: d.id, kind: "permission", allow: true })} className={`${btn} flex items-center justify-center gap-1 border-emerald-500 bg-emerald-600 font-semibold text-black`}>
          <Check className="h-3.5 w-3.5" aria-hidden /> ALLOW
        </button>
      </div>
    </div>
  );
}
