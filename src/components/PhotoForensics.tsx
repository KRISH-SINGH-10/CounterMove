"use client";

import { useEffect, useState } from "react";
import type { EvidencePhoto, ForensicsResult } from "@/lib/forensics";
import { BUTTON } from "./ui";

// Photo forensics on a dispute page: the listing, packing and buyer photos side by side,
// and Gemini's comparison of them. The saved comparison shows at once; "Compare again"
// runs it live.

const VERDICT: Record<ForensicsResult["verdict"], { label: string; color: string }> = {
  DAMAGED_IN_TRANSIT: { label: "Damaged in transit", color: "var(--offer)" },
  NOT_AS_DESCRIBED: { label: "Not as described", color: "var(--danger)" },
  DIFFERENT_ITEM: { label: "A different item", color: "var(--danger)" },
  MATCHES_LISTING: { label: "Matches the listing", color: "var(--fight)" },
  INCONCLUSIVE: { label: "Photos can't settle it", color: "var(--muted)" },
};
const SUPPORT = { YES: { mark: "✓", color: "var(--danger)", word: "Supported" }, NO: { mark: "✗", color: "var(--fight)", word: "Not supported" }, UNCLEAR: { mark: "?", color: "var(--muted)", word: "Unclear" } } as const;

export default function PhotoForensics({ caseId }: { caseId: string }) {
  const [photos, setPhotos] = useState<EvidencePhoto[] | null>(null);
  const [result, setResult] = useState<ForensicsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/cases/${caseId}/photos`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((j) => setPhotos(j.photos ?? []))
      .catch(() => setPhotos([]));
  }, [caseId]);

  async function compare(fresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cases/${caseId}/photos${fresh ? "?fresh=1" : ""}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setError(json.error ?? "The AI couldn't compare the photos. Try again.");
      setResult(json);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!photos?.length) return null;
  const v = result ? VERDICT[result.verdict] : null;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-panel p-4" data-testid="photo-forensics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Photo forensics</h2>
        {result ? (
          <button onClick={() => compare(true)} disabled={busy} className={`${BUTTON.ghost} !px-0 text-xs underline`}>{busy ? "Comparing…" : "Compare again"}</button>
        ) : (
          <button onClick={() => compare(false)} disabled={busy} className={BUTTON.primary}>{busy ? "Comparing…" : "Compare photos with Gemini"}</button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <figure key={p.kind} className="space-y-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={p.caption} className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
            <figcaption className="text-xs leading-tight text-muted">{p.caption}</figcaption>
          </figure>
        ))}
      </div>
      <p className="text-xs text-muted">Demo images are illustrations made for this project, standing in for real photos.</p>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {result && v ? (
        <div className="space-y-2 rounded-md border p-3 text-sm" style={{ borderColor: v.color }}>
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ color: v.color, border: "1px solid currentColor" }}>{v.label}</span>
            <span className="text-xs text-muted tabular">{Math.round(result.confidence * 100)}% confident · {result.replayed ? `saved run from ${result.saved_at.slice(0, 10)}` : "live"} · {result.model}</span>
          </p>
          <p>{result.summary}</p>
          {result.claim_checks.length ? (
            <ul className="space-y-1">
              {result.claim_checks.map((c, i) => {
                const s = SUPPORT[c.supported];
                return (
                  <li key={i} className="flex gap-2 leading-snug">
                    <span className="font-semibold" style={{ color: s.color }} aria-label={s.word}>{s.mark}</span>
                    <span>
                      <span className="font-medium">{c.claim}</span> <span className="text-muted">({s.word.toLowerCase()}: {c.why})</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <ul className="space-y-0.5 text-xs text-muted">
            {result.findings.map((f, i) => (
              <li key={i}><span className="font-medium capitalize">{f.photo} photo:</span> {f.observation}</li>
            ))}
          </ul>
          <p className="border-t border-line pt-2"><span className="font-medium">Suggested:</span> {result.suggested_response}</p>
        </div>
      ) : null}
    </section>
  );
}
