"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "./ui";

// Demo orders a judge can open as the buyer: a tracking question, a damaged delivery, an order not shipped yet.
const DEMO = [
  { id: "JK-1063", what: "Sneaker care kit with spare laces", ask: "Where is my order?" },
  { id: "JK-1057", what: "Kestrel Low 'Sail', delivered", ask: "It arrived damaged" },
  { id: "JK-1090", what: "Crease guards, paid, not shipped yet", ask: "Change or cancel before it ships" },
];

export default function FixLookup() {
  const router = useRouter();
  const [order, setOrder] = useState("");
  const id = order.trim().toUpperCase();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Laceline Resale · help with your order</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Fix it with the shop first</h1>
        <p className="mt-1 text-sm text-muted">Tracking questions are answered at once from the shop&apos;s shipping records. Refunds and replacements go straight to the seller, before anyone has to open a PayPal dispute.</p>
      </div>
      <Card title="Your order number" subtitle="It is on your PayPal receipt, for example JK-1063.">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (id) router.push(`/fix/${encodeURIComponent(id)}`);
          }}
        >
          <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="JK-1063" aria-label="Order number" className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2 text-sm" />
          <button type="submit" disabled={!id} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-panel disabled:opacity-60">Find my order</button>
        </form>
      </Card>
      <Card title="Try a demo order" subtitle="Open the page a buyer of the demo shop would see.">
        <ul className="divide-y divide-line">
          {DEMO.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{d.what}</div>
                <div className="text-xs text-muted">{d.ask}</div>
              </div>
              <Link href={`/fix/${d.id}`} className="shrink-0 text-sm text-accent underline">{d.id}</Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
