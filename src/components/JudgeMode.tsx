"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCases } from "./CasesProvider";
import { JUDGE_EVENT } from "./TopBar";
import { BUTTON } from "./ui";

// Judge mode: one click plays the whole story in the Simulator, before, during and
// after a dispute. It drives the same pages and the same API routes a seller uses,
// in order, with a caption for each step; nothing here is a recording.

const REFRESH = "countermove:refresh";
const FIGHT_CASE = "PP-D-27800";

type Step = { title: string; text: string };
const STEPS: Step[] = [
  { title: "Getting a fresh demo shop", text: "Resetting your private Simulator so the story starts clean." },
  { title: "Before: a risky order is caught", text: "On Protect, the pre-ship check reads each paid PayPal order. A $236 bag going to a package forwarder under another name is flagged HIGH." },
  { title: "Before: refunded before it ships", text: "One action: Countermove refunds the payment through PayPal's Payments API, so there is nothing to dispute later." },
  { title: "Before: a buyer gets help first", text: "A buyer asks where their print is on the fix-it-first page and gets the answer at once, with no PayPal dispute." },
  { title: "During: a dispute arrives", text: "A buyer opens a $28 claim. PayPal's webhook reaches the agent, it investigates, and autopilot refunds within your $30 rule." },
  { title: "During: the agent investigates", text: "A $184 “never arrived” chargeback. The agent reads the PayPal dispute, order, tracking and the buyer's history, and finds the delivery signature." },
  { title: "During: you approve the fight", text: "The evidence goes to PayPal's Disputes API with your approval. PayPal's side then plays out in the Simulator." },
  { title: "After: what it saved, and what to fix", text: "Insights shows money protected, the 30-day Dispute Reserve, the Dispute Doctor's fixes and every PayPal call on the API trail." },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function JudgeMode() {
  const router = useRouter();
  const { data, reload, switchMode } = useCases();
  const [step, setStep] = useState<number | null>(null);
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const mode = useRef(data?.mode);
  mode.current = data?.mode;

  const run = useCallback(async () => {
    stop.current = false;
    setError(null);
    setState("running");
    // Each step is skipped once the judge presses Stop.
    const at = async (i: number, fn: () => Promise<void>) => {
      if (stop.current) return;
      setStep(i);
      await fn();
    };
    const until = async (check: () => Promise<boolean>, maxMs: number) => {
      const end = Date.now() + maxMs;
      while (Date.now() < end && !stop.current) {
        if (await check().catch(() => false)) return true;
        await wait(900);
      }
      return false;
    };
    const post = async (url: string, body?: unknown) => {
      const res = await fetch(url, body === undefined ? { method: "POST" } : json(body));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${url} failed`);
      return res;
    };
    const refresh = async () => {
      await reload();
      window.dispatchEvent(new Event(REFRESH));
    };

    try {
      await at(0, async () => {
        if (mode.current === "sandbox") await switchMode("mock");
        await post("/api/demo/reset");
        await reload();
        await wait(1200);
      });
      await at(1, async () => {
        router.push("/protect");
        // The shield checks each order in the background; wait for the forwarder order.
        await until(async () => {
          const o = (await (await fetch("/api/orders", { cache: "no-store" })).json()).orders as Array<{ invoice_id: string; verdict?: unknown }>;
          return Boolean(o?.find((x) => x.invoice_id === "JK-1088")?.verdict);
        }, 45_000);
        await wait(4500);
      });
      await at(2, async () => {
        await post("/api/orders/JK-1088/action", { action: "REFUND" });
        await refresh();
        await wait(4500);
      });
      await at(3, async () => {
        await post("/api/fix/JK-1063", { kind: "WHERE" });
        await refresh();
        document.querySelector("[data-judge=fix]")?.scrollIntoView({ behavior: "smooth", block: "center" });
        await wait(5000);
      });
      await at(4, async () => {
        router.push("/");
        await wait(1200);
        const filed = (await (await post("/api/demo/dispute")).json()) as { id: string };
        await until(async () => {
          await reload();
          const c = await (await fetch(`/api/cases/${filed.id}`, { cache: "no-store" })).json();
          return Boolean(c?.outcome || c?.autopilot);
        }, 30_000);
        await wait(4000);
      });
      await at(5, async () => {
        // The dispute page starts the investigation itself and streams the agent's steps.
        router.push(`/cases/${FIGHT_CASE}`);
        await until(async () => (await (await fetch(`/api/cases/${FIGHT_CASE}`, { cache: "no-store" })).json())?.status === "READY", 60_000);
        await wait(4500);
      });
      await at(6, async () => {
        const c = await (await fetch(`/api/cases/${FIGHT_CASE}`, { cache: "no-store" })).json();
        const r = c?.recommendation;
        if (r && !c.submitted) await post(`/api/cases/${FIGHT_CASE}/approve`, { decision: r.decision, response: r.response_to_paypal, ...(r.decision === "OFFER" ? { offer_amount: r.offer_amount } : {}) });
        await refresh();
        // The page's own countdown plays PayPal's ruling a few seconds later.
        await until(async () => Boolean((await (await fetch(`/api/cases/${FIGHT_CASE}`, { cache: "no-store" })).json())?.outcome), 20_000);
        await refresh();
        await wait(4500);
      });
      await at(7, async () => {
        router.push("/insights");
        await reload();
        await wait(1500);
      });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "A step failed.");
      setState("error");
    }
  }, [reload, router, switchMode]);

  useEffect(() => {
    const start = () => {
      if (step !== null && state === "running") return;
      run();
    };
    window.addEventListener(JUDGE_EVENT, start);
    return () => window.removeEventListener(JUDGE_EVENT, start);
  }, [run, step, state]);

  if (step === null) return null;
  const s = STEPS[step];
  const close = () => {
    stop.current = true;
    setStep(null);
  };
  return (
    <aside role="status" aria-live="polite" data-testid="judge-mode" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl rounded-lg border border-accent bg-panel p-4 shadow-xl sm:inset-x-auto sm:right-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            Judge mode · step {step + 1} of {STEPS.length}
          </p>
          <h2 className="mt-0.5 text-base font-semibold">{state === "done" ? "That's the whole story" : s.title}</h2>
        </div>
        <button onClick={close} className={BUTTON.ghost} aria-label={state === "running" ? "Stop Judge mode" : "Close"}>{state === "running" ? "Stop" : "Close"}</button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {state === "error" ? <span className="text-danger">This step didn&apos;t finish: {error} You can carry on by hand, or run it again.</span> : state === "done" ? "Before, during and after a dispute, on live pages. Everything you saw is yours to click through now: try Ask the grid, the API trail, or the Dispute Doctor's fixes." : s.text}
      </p>
      <div className="mt-3 flex gap-1" aria-hidden>
        {STEPS.map((_, i) => (
          <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < step || state === "done" ? "var(--accent)" : i === step ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "var(--line)" }} />
        ))}
      </div>
      {state !== "running" ? (
        <div className="mt-3 flex gap-2">
          <button onClick={run} className={BUTTON.secondary}>Play it again</button>
        </div>
      ) : null}
    </aside>
  );
}
