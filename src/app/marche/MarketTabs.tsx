import Link from "next/link";

// Sub-navigation between the Marché pages.
export default function MarketTabs({ current }: { current: "etudes" | "stacks" }) {
  return (
    <nav className="mk-tabs" aria-label="Pages Marché">
      <Link href="/marche" className={current === "etudes" ? "active" : ""} aria-current={current === "etudes" ? "page" : undefined}>
        Demande &amp; offre par pays
      </Link>
      <Link href="/marche/stack" className={current === "stacks" ? "active" : ""} aria-current={current === "stacks" ? "page" : undefined}>
        Stacks rentables
      </Link>
    </nav>
  );
}
