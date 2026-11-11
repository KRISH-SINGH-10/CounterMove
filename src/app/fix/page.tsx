import FixLookup from "@/components/FixLookup";

export const metadata = { title: "Help with your order · Countermove" };

// The buyer's way in: an order number from the receipt opens /fix/<order>.
export default function FixIndex() {
  return <FixLookup />;
}
