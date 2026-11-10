import Link from "next/link";

// Any address the app doesn't have. The top bar (tabs, mode switch, Simulator tools) comes
// from the layout, so the seller is never stranded.
export default function NotFound() {
  return (
    <section className="rounded-lg border border-line bg-panel p-4 sm:p-6">
      <h1 className="text-lg font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-2 max-w-prose text-sm text-muted">The link may be old or mistyped. Your disputes, paid orders and insights are one click away.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/" className="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-panel hover:opacity-90">Open all disputes</Link>
        <Link href="/protect" className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent">Protect</Link>
        <Link href="/insights" className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent">Insights</Link>
      </div>
    </section>
  );
}
