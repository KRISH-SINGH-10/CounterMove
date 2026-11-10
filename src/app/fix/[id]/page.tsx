import { Suspense } from "react";
import BuyerFix from "@/components/BuyerFix";

export const metadata = { title: "Help with your order · Countermove" };

export default function FixPage({ params }: PageProps<"/fix/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Loading...</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: PageProps<"/fix/[id]">["params"] }) {
  const { id } = await params;
  return <BuyerFix invoice={decodeURIComponent(id)} />;
}
