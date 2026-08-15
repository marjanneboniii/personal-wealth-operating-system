import LedgerPage from "@/app/ledger/page";

export const dynamic = "force-dynamic";

export const metadata = { title: "سوابق مالی" };

/**
 * «سوابق مالی» — the user-facing name of the General Ledger.
 *
 * TERMINOLOGY (see src/lib/nav.ts):
 *   UI label   → سوابق مالی
 *   Technical  → Ledger / General Ledger / Journal Entry / Posting
 *
 * This route is a pure PRESENTATION ALIAS. It renders the existing ledger
 * server component verbatim — same queries, same data, same guards
 * (`ensureAuth`), same `?entry=<id>` deep-link contract. It intentionally
 * introduces NO new query, NO new read model and NO second financial state.
 *
 * `/ledger` is deliberately kept alive: `src/features/integrity/service.ts`
 * (protected core) and existing asset deep-links point at it.
 */
export default LedgerPage;
