"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BuyerOrder, FixKind, FixRequest, FixWants } from "@/lib/fixfirst";
import { money } from "./format";
import { BUTTON } from "./ui";

// The buyer's "fix it first" page: a shop links it from its order emails, so a buyer with
// a problem gets tracking, a refund or a replacement here instead of opening a PayPal
// dispute. In the demo it runs in the seller's own browser, as a preview.

const STATE_LABEL: Record<BuyerOrder["state"], string> = { PAID_NOT_SHIPPED: "Paid, being packed", SHIPPED: "On its way", DELIVERED: "Delivered" };

export default function BuyerFix({ invoice }: { invoice: string }) {
  const [order, setOrder] = useState<BuyerOrder | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [kind, setKind] = useState<FixKind | null>(null);
  const [wants, setWants] = useState<FixWants>("REFUND");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<FixRequest | null>(null);

  useEffect(() => {
    fetch(`/api/fix/${encodeURIComponent(invoice)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, json: await r.json() }))
      .then(({ ok, json }) => (ok ? setOrder(json.order) : setMissing(json.error ?? "We couldn't find that order.")))
      .catch(() => setMissing("We couldn't reach the shop. Try again in a minute."));
  }, [invoice]);

  async function submit(k: FixKind) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/fix/${encodeURIComponent(invoice)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: k, wants: k === "PROBLEM" ? wants : null, note }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setError(json.error ?? "That didn't go through. Try again.");
      setSent(json.request);
    } catch {
      setError("We couldn't reach the shop. Try again in a minute.");
    } finally {
      setBusy(false);
    }
  }

  const preview = (
    <p className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">
      Preview of the page your buyer sees, linked from the order email. It shows the buyer&apos;s first name, the item and the shipping status only.{" "}
      <Link href="/protect" className="text-accent underline">Back to Protect</Link>
    </p>
  );

  if (missing) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        {preview}
        <section className="rounded-lg border border-line bg-panel p-5">
          <h1 className="text-lg font-semibold">We couldn&apos;t find order {invoice}</h1>
          <p className="mt-2 text-sm text-muted">{missing}</p>
        </section>
      </div>
    );
  }
  if (!order) return <p className="text-muted">Loading...</p>;

  const choices: Array<{ id: FixKind; label: string; hint: string; show: boolean }> = [
    { id: "WHERE", label: "Where is my order?", hint: "See the latest from the carrier right now.", show: true },
    { id: "PROBLEM", label: "Something is wrong with it", hint: "Damaged, not as described, or it never arrived.", show: true },
    { id: "CANCEL", label: "Cancel and refund", hint: "It hasn't shipped yet, so it can be cancelled.", show: order.state === "PAID_NOT_SHIPPED" },
  ];

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {preview}
      <section className="rounded-lg border border-line bg-panel p-5">
        <p className="text-sm text-muted">Order {order.invoice_id}</p>
        <h1 className="text-xl font-semibold tracking-tight">Hi {order.buyer_first_name}, how can we help?</h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg px-3 py-2 text-sm">
          <span className="font-medium">{order.item}</span>
          <span className="tabular">{money(order.amount)}</span>
          <span className="w-full text-xs text-muted">{STATE_LABEL[order.state]}{order.tracking_number ? ` · ${order.carrier} ${order.tracking_number}` : ""}</span>
        </div>

        {sent ? (
          <div className="mt-4 space-y-3" data-testid="fix-result">
            <div className="rounded-md border p-3 text-sm" style={{ borderColor: "var(--fight)" }}>
              <p className="font-medium">
                <span aria-hidden style={{ color: "var(--fight)" }}>✓ </span>
                {sent.status === "ANSWERED" ? "Here's the latest" : "The shop has your request"}
              </p>
              <p className="mt-1 text-muted">
                {sent.answer ??
                  (sent.wants === "REPLACEMENT"
                    ? "You asked for a replacement. The shop answers within one business day, and you don't need to open a PayPal dispute to get it."
                    : "You asked for a refund. The shop answers within one business day, and the refund goes back through PayPal to the way you paid.")}
              </p>
            </div>
            <button onClick={() => { setSent(null); setKind(null); setNote(""); }} className={BUTTON.secondary}>Ask something else</button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2" role="radiogroup" aria-label="What do you need help with?">
              {choices.filter((c) => c.show).map((c) => (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={kind === c.id}
                  disabled={busy}
                  onClick={() => (c.id === "WHERE" ? submit("WHERE") : setKind(c.id))}
                  className="rounded-md border px-3 py-2.5 text-left text-sm hover:border-accent disabled:opacity-60"
                  style={kind === c.id ? { borderColor: "var(--accent)" } : { borderColor: "var(--line)" }}
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-xs text-muted">{c.hint}</span>
                </button>
              ))}
            </div>

            {kind === "PROBLEM" ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="text-muted">What went wrong?</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} placeholder="For example: the left toe box arrived dented" className="mt-1 w-full rounded-md border border-line bg-bg p-2.5 text-sm" />
                </label>
                <div className="flex flex-wrap items-center gap-2 text-sm" role="radiogroup" aria-label="What would you like?">
                  <span className="text-muted">I&apos;d like</span>
                  {(["REFUND", "REPLACEMENT"] as FixWants[]).map((w) => (
                    <button key={w} role="radio" aria-checked={wants === w} onClick={() => setWants(w)} className="rounded-md border px-3 py-1" style={wants === w ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 600 } : { borderColor: "var(--line)" }}>
                      {w === "REFUND" ? "a refund" : "a replacement"}
                    </button>
                  ))}
                </div>
                <button onClick={() => submit("PROBLEM")} disabled={busy || note.trim().length < 5} className={BUTTON.primary}>{busy ? "Sending…" : "Send to the shop"}</button>
              </div>
            ) : null}

            {kind === "CANCEL" ? (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-muted">The shop cancels the order and refunds {money(order.amount)} through PayPal to the way you paid.</p>
                <button onClick={() => submit("CANCEL")} disabled={busy} className={BUTTON.primary}>{busy ? "Sending…" : "Ask the shop to cancel and refund"}</button>
              </div>
            ) : null}
          </>
        )}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{order.returns_policy}</p>
      </section>
    </div>
  );
}
