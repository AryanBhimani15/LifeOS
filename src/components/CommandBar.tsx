"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckSquare,
  Command,
  FileText,
  Folder,
  HelpCircle,
  Loader2,
  Search,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { useToast } from "./ToastProvider";

/**
 * The AI command bar.
 *
 * This is the client half of the pipeline in src/lib/ai. It never mutates
 * anything directly: it POSTs the sentence, renders the returned PLAN, and only
 * then asks the server to execute it. Destructive plans require a second,
 * explicit confirmation — and that requirement is enforced server-side, so the
 * dialog below is a courtesy rather than the control.
 */

interface PlanAction {
  type: string;
  title?: string;
  name?: string;
  description?: string;
  taskTitle?: string;
  dueAt?: string;
  priority?: string;
  subtasks?: string[];
  milestones?: { title: string }[];
  kind?: string;
}

interface Ambiguity {
  query: string;
  candidates: { id: string; label: string }[];
}

interface QueryAnswer {
  kind: string;
  headline: string;
  items: { id: string; label: string; detail?: string }[];
}

interface Plan {
  planId: string | null;
  summary: string;
  actions: PlanAction[];
  needsConfirm: boolean;
  clarification?: string | null;
  ambiguities?: Ambiguity[] | null;
}

const ACTION_ICON: Record<string, typeof CheckSquare> = {
  create_task: CheckSquare,
  update_task: CheckSquare,
  complete_task: CheckSquare,
  delete_task: Trash2,
  create_project: Folder,
  create_event: CalendarDays,
  create_goal: Target,
  create_note: FileText,
  complete_habit: Sparkles,
  log_expense: Wallet,
  query: HelpCircle,
};

const SUGGESTIONS = [
  "Break my Azure project into steps",
  "What's putting my deadlines at risk?",
  "Log a 4.50 coffee",
];

export function CommandBar() {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [answers, setAnswers] = useState<QueryAnswer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setInput("");
    setPlan(null);
    setAnswers([]);
    setError("");
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError("");
    setPlan(null);
    setAnswers([]);

    try {
      const response = await fetch("/api/ai/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error?.message ?? "That didn't work. Try rephrasing.");
        return;
      }
      setPlan(payload as Plan);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function execute(confirmed: boolean) {
    if (!plan?.planId || busy) return;
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/ai/plans/${plan.planId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const payload = await response.json();

      if (!response.ok) {
        if (payload?.error?.code === "CONFIRMATION_REQUIRED") {
          // The server refused because this plan is destructive. Keep the panel
          // open so the user can confirm deliberately.
          setError("This will delete something. Confirm to continue.");
          return;
        }
        setError(payload?.error?.message ?? "Could not run that.");
        return;
      }

      if (payload.answers?.length) {
        setAnswers(payload.answers as QueryAnswer[]);
        setPlan(null);
        return;
      }

      const count = payload.executed ?? 0;
      toast(count === 1 ? "Done — 1 change applied." : `Done — ${count} changes applied.`);
      close();
      // The pages are Server Components, so a refresh re-runs their queries and
      // shows the new rows.
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && (
        <div
          className="command-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="LifeOS command menu"
          onMouseDown={close}
        >
          <div className="command-panel" onMouseDown={(e) => e.stopPropagation()}>
            <form
              className="command-input"
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
            >
              {busy ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What do you want to do?"
                disabled={busy}
              />
              <button type="button" onClick={close} aria-label="Close">
                <X size={16} />
              </button>
            </form>

            {error && (
              <p className="command-error" role="alert">
                <AlertTriangle size={14} /> {error}
              </p>
            )}

            {/* Idle: suggestions */}
            {!plan && !answers.length && !busy && (
              <>
                <p className="command-hint">SUGGESTED FOR YOU</p>
                {SUGGESTIONS.map((item, index) => (
                  <button
                    key={item}
                    className="command-option"
                    onClick={() => {
                      setInput(item);
                      submit(item);
                    }}
                  >
                    <span>{index + 1}</span>
                    {item}
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </>
            )}

            {busy && !plan && <p className="command-hint">Thinking…</p>}

            {/* Could not resolve: show the question, not a guess */}
            {plan && !plan.planId && (
              <div className="plan-block">
                <p className="command-hint">NEEDS CLARIFICATION</p>
                <p className="plan-clarify">{plan.clarification}</p>
                {plan.ambiguities?.map((amb) => (
                  <div key={amb.query} className="plan-ambiguity">
                    <small>Which “{amb.query}”?</small>
                    {amb.candidates.map((c) => (
                      <button
                        key={c.id}
                        className="command-option"
                        onClick={() => {
                          const refined = `${input} (the one called "${c.label}")`;
                          setInput(refined);
                          submit(refined);
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* The plan receipt */}
            {plan?.planId && (
              <div className="plan-block">
                <p className="command-hint">{plan.needsConfirm ? "CONFIRM TO CONTINUE" : "PLAN"}</p>
                <p className="plan-summary">{plan.summary}</p>

                <ul className="plan-actions">
                  {plan.actions.map((action, i) => {
                    const Icon = ACTION_ICON[action.type] ?? Sparkles;
                    const destructive = action.type === "delete_task";
                    const label =
                      action.taskTitle ??
                      action.title ??
                      action.name ??
                      action.kind ??
                      action.type;
                    return (
                      <li key={i} className={`plan-action ${destructive ? "destructive" : ""}`}>
                        <Icon size={15} />
                        <span className="plan-verb">{action.type.replace(/_/g, " ")}</span>
                        <span className="plan-target">{label}</span>
                        {action.subtasks?.length ? (
                          <span className="plan-chip">{action.subtasks.length} subtasks</span>
                        ) : null}
                        {action.milestones?.length ? (
                          <span className="plan-chip">{action.milestones.length} milestones</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                <div className="plan-buttons">
                  <button className="plan-cancel" onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    className={plan.needsConfirm ? "plan-confirm destructive" : "plan-confirm"}
                    onClick={() => execute(plan.needsConfirm)}
                    disabled={busy}
                  >
                    {busy ? "Working…" : plan.needsConfirm ? "Yes, delete" : "Run"}
                  </button>
                </div>
              </div>
            )}

            {/* Answers to read-only questions, computed from the database */}
            {answers.map((answer) => (
              <div className="plan-block" key={answer.kind}>
                <p className="command-hint">{answer.kind.replace(/_/g, " ").toUpperCase()}</p>
                <p className="plan-summary">{answer.headline}</p>
                <ul className="plan-actions">
                  {answer.items.slice(0, 8).map((item) => (
                    <li key={item.id} className="plan-action">
                      <span className="plan-target">{item.label}</span>
                      {item.detail && <span className="plan-chip">{item.detail}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="command-footer">
              <span>
                <Command size={12} /> Run command
              </span>
              {/* The theme switch lived here too. One setting, one control —
                  it is in the top bar. */}
              <span>esc Close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
