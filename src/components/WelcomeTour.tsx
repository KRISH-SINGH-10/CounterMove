"use client";

import { useEffect, useState } from "react";
import { TOUR_EVENT } from "./TopBar";
import { BUTTON } from "./ui";

const SEEN_KEY = "rebuttal.tour.seen.v2";

const STEPS = [
  {
    title: "Before: stop scammers before you ship",
    body: "This is Protect. Sellers share proof when a buyer is caught lying (only a one-way hash of the PayPal email), and every paid PayPal order is checked against that network before it ships. One click refunds a risky order through PayPal instead of shipping it.",
  },
  {
    title: "During: settle the rest without a fight",
    body: "On Disputes, the agent investigates each PayPal dispute through PayPal's own APIs, compares photos, writes the evidence, and negotiates partial refunds inside a ceiling the buyer never sees. Nothing reaches PayPal without your approval, except what your autopilot rules allow.",
  },
  {
    title: "After: what it saved, and what to fix",
    body: "Insights shows money protected, what to keep aside for the next 30 days, the causes behind your refunds with one fix each, and every PayPal call on the API trail. Judge mode in the top bar plays the whole story in under a minute.",
  },
];

// A three-step welcome on the first visit; Simulator tools can open it again.
export default function WelcomeTour() {
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setStep(0);
    } catch {
      // storage blocked: skip the tour
    }
    const open = () => setStep(0);
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);

  function close() {
    setStep(null);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {}
  }

  if (step === null) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label="Welcome to Countermove">
      <div className="w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Step {step + 1} of {STEPS.length}</p>
        <h2 className="mt-1 text-lg font-semibold">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i <= step ? "var(--accent)" : "var(--line)" }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={close} className={BUTTON.ghost}>Skip</button>
            <button onClick={() => (last ? close() : setStep(step + 1))} className={BUTTON.primary}>{last ? "Start" : "Next"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
