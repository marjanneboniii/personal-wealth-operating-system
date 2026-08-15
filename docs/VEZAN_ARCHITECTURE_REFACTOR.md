# VEZAN — Controlled Product Architecture Refactor

> Presentation-layer refactor executed on top of an **unchanged** Financial Core.
> Brand: **تراز → وِزان (VEZAN)**.

---

## PHASE 0 — Preflight (read-only)

### A. Project tree (relevant)

```
src/app/**            27 route folders + 9 API routes
src/components/**     layout, ui, forms, charts, registry, overview, portfolio, assets
src/domain/           accounting.ts · decimal.ts · fifo.ts        ← FROZEN
src/features/         ledger · integrity · portfolio · analytics · planning
                      assetRegistry · rwa · valuation · fx · pricing · categories
src/db/               schema.ts · index.ts · config.ts · init-schema.ts
                      migrate-multiuser.ts · seed.ts              ← FROZEN
drizzle/              0000_initial.sql · 0001_production_schema_hardening.sql
                      meta/                                       ← FROZEN
tests/                28 suites / 222 tests
```

### B. Financial Core map (Protected)

| Concern | Files |
|---|---|
| Accounting | `src/domain/accounting.ts` |
| Decimal | `src/domain/decimal.ts` |
| FIFO / Cost basis | `src/domain/fifo.ts` |
| Ledger engine | `src/features/ledger/service.ts`, `queries.ts` |
| Integrity | `src/features/integrity/service.ts` |
| Database | `src/db/**`, `drizzle.config.ts` |
| Migrations | `drizzle/0000_initial.sql`, `drizzle/0001_production_schema_hardening.sql`, `drizzle/meta/**` |
| Audit | `src/lib/audit.ts`, `src/app/audit/page.tsx` |
| Security | `src/lib/auth.ts`, `auth-actions.ts`, `authGuard.ts`, `accessControl.ts`, `rateLimit.ts`, `validation.ts`, `src/app/api/auth/**`, `middleware.ts`, `next.config.ts` |
| Backup / Restore | `src/app/api/backup/route.ts`, `src/app/api/restore/route.ts`, `src/components/RestorePanel.tsx` |
| Financial mutations | `src/app/actions.ts` (server actions that post entries) |
| Tests | `tests/**` |

**Protected baseline:** SHA-256 recorded for all 64 protected files before any edit
(`/tmp/vezan/protected-baseline.txt`) and re-verified in Phase 4.

### C. Route map (before)

`/` `/app` `/about` `/privacy` `/terms` `/login` `/register` `/setup` `/offline`
`/accounts` `/transactions` `/new` `/cash-flow` `/ledger`
`/portfolio` `/crypto` `/net-worth` `/analytics`(→`/net-worth`) `/asset-registry`
`/planning` `/budgets` `/goals` `/debts` `/installments`
`/reports` `/audit` `/settings`

### D. Navigation map (before)

5 flat groups: ثروت · پول · دارایی‌ها · برنامه‌ریزی · گزارش‌ها.
Debt + Installments sat **under برنامه‌ریزی**. `دفترکل` sat **under پول**.
`حسابرسی` sat next to گزارش‌ها. All submenus permanently expanded.

### E–H. Dependency findings that constrained the plan

1. `src/features/integrity/service.ts` (PROTECTED) hardcodes
   `{ href: "/ledger", label: "مشاهده در دفترکل" }`. → **`/ledger` must keep working.**
2. `RealEstateCard.tsx` and `TransactionsView.tsx` deep-link `/ledger?entry=<id>`.
   → **`/ledger` query contract must not change.**
3. `src/app/actions.ts#refreshAll()` revalidates the existing path list.
   New pages are `force-dynamic`, so **no change to `actions.ts` is required**.
4. `getAnalyticsSummary()` **INSERTs** into `analytics_runs` on every call.
   → New Wealth/Insights pages must **not** call it; otherwise page loads would
   multiply append-only analytics writes (violates §62/§63).
5. `obligations` are read by `/goals`; Debt presentation must **re-read** the same
   `listObligations()` service, never fork state.
6. `tests/landing-pwa.test.ts` and `tests/stage7-*.test.ts` assert literal strings
   inside `Shell.tsx` (`publicHome`, `!isPublicChrome && (`, `aria-keyshortcuts`,
   `aria-expanded`, `aria-live`, `InstallPromotion`, `usePwaInstallState`,
   `isLanding || isMarketing`). → All must survive the sidebar rewrite.
7. The Persian word **«تراز»** is *both* the old brand *and* an accounting term
   (`تراز آزمایشی` = trial balance, `سند تراز نیست` = entry not balanced).
   `tests/stage3|4|5` assert `/تراز نیست|balanced/`.
   → **Only brand occurrences are renamed. Accounting vocabulary is untouched.**

### I. Test coverage baseline

`222 passed / 0 failed` · typecheck clean · lint: **2 pre-existing errors**
(`no-html-link-for-pages` in `login/page.tsx`, `register/page.tsx`) — left as found.

---

## PHASE 1 — Change Plan

### Classification summary

| # | File | Change | Class |
|---|---|---|---|
| 1 | `src/lib/nav.ts` | Rewrite IA into 9 intent-domains w/ collapsible sub-items | YELLOW |
| 2 | `src/components/layout/Shell.tsx` | Collapsible group rendering, new mobile tabs, brand | YELLOW |
| 3 | `src/app/layout.tsx` | Brand metadata | GREEN |
| 4 | `public/manifest.webmanifest`, `public/sw.js` | Brand strings | GREEN |
| 5 | `BrandMark.tsx`, `LandingChrome/LandingPage`, `about/privacy/terms/login/register/offline`, `i18n/fa.ts` | Brand labels only | GREEN |
| 6 | `src/app/ledger/page.tsx` | Title → «سوابق مالی» + progressive-disclosure copy | GREEN |
| 7 | `src/app/financial-records/page.tsx` | **NEW** — user-facing alias of the ledger view | YELLOW |
| 8 | `src/app/debts/installments/page.tsx`, `loans`, `obligations` | **NEW** — Debt sub-domain, read-only over existing services | YELLOW |
| 9 | `src/app/assets/page.tsx`, `assets/financial`, `assets/real` | **NEW** — Asset hub / financial view / redirect to registry | YELLOW |
| 10 | `src/app/insights/page.tsx` | **NEW** — read-only Insights (health / spending / assets / alerts) | YELLOW |
| 11 | `src/app/net-worth/page.tsx`, `src/app/reports/page.tsx` | Section anchors only (`id=`) | GREEN |
| 12 | `src/app/settings/page.tsx` | «پیشرفته» block → سوابق مالی + حسابرسی | GREEN |
| 13 | `src/app/debts/page.tsx`, `installments/page.tsx` | Cross-links to new sub-routes | GREEN |
| 14 | `src/components/transactions/TransactionsView.tsx`, `ui/CommandPalette.tsx` | Label «دفترکل» → «سوابق مالی» | GREEN |
| — | **Any protected-core file** | — | **RED — NOT EXECUTED** |

### Detail (representative entries)

```
File:                    src/lib/nav.ts
Current responsibility:  Single source of truth for IA (flat groups)
Proposed change:         9 intent domains, nested items, collapsible metadata
Why:                     Debt must be its own domain (§17); nav by user intent (§52)
Dependency:              Shell.tsx, CommandPalette.tsx (ALL_NAV_ITEMS)
Risk:                    Broken active-state / palette entries
Impact:                  Presentation only — zero data access
Rollback:                Revert single file
Classification:          YELLOW
```

```
File:                    src/app/financial-records/page.tsx  (NEW)
Current responsibility:  —
Proposed change:         Render the SAME server component as /ledger
Why:                     §6 UI term «سوابق مالی»; §49 keep technical path traceable
Dependency:              src/app/ledger/page.tsx (unchanged logic)
Risk:                    Duplicate ledger logic → avoided by re-export, not copy
Impact:                  Read-only; no new query, no new state
Rollback:                Delete one file
Classification:          YELLOW
```

```
File:                    src/app/debts/{loans,installments,obligations}/page.tsx (NEW)
Current responsibility:  —
Proposed change:         Read-only views over listDebts / installments / listObligations
Why:                     §17 Debt independent domain, §18 Installments under Debt
Dependency:              features/planning/service.ts (READ ONLY, unchanged)
Risk:                    Duplicate debt state → avoided; every page calls the
                         existing service, no local derivation of truth
Impact:                  No mutation, no schema change
Rollback:                Delete folder; /installments and /debts still intact
Classification:          YELLOW
```

### RED changes required

**NONE.** Every target-architecture requirement was satisfiable at the
UI / navigation / read-query-composition layer. See §Database Change Gate below.

### Database Change Gate (§37)

> *Can this be solved at UI / query / feature composition layer?* — **YES, for every item.**
> Therefore: **Database change = 0.** No schema edit, no migration, no new table,
> no new column, no index change.

---

## PHASE 2/3 — Executed changes

### Route decisions (§50/§51)

| Old | New | Compatibility |
|---|---|---|
| `/ledger` | `/ledger` **kept** + `/financial-records` added | Both live. Integrity-service deep-links and `?entry=` links unchanged. |
| `/installments` | `/installments` **kept** + `/debts/installments` added | Both live; `/new?type=debt_repayment&installmentId=` untouched. |
| — | `/debts/loans`, `/debts/obligations` | New, additive |
| — | `/assets`, `/assets/financial` | New, additive |
| `/asset-registry` | kept; `/assets/real` redirects to it | No duplication of the RWA workspace |
| — | `/insights` | New, additive |
| `/net-worth`, `/reports` | unchanged paths; anchors added | Sub-nav uses `#` deep-links — **no page duplication, no extra `analytics_runs` writes** |

**No route was deleted, renamed or moved.**

### Why Wealth/Insights/Reports sub-items are anchors, not new pages

`getAnalyticsSummary()` performs an append-only INSERT into `analytics_runs`.
Splitting `/net-worth` into four pages would have multiplied that write on every
navigation — a duplicate-work/concurrency regression (§62, §63) for zero user
benefit. Sections were given stable `id`s and the sidebar deep-links to them.

---

## PHASE 4/5 — Verification

Recorded in the final report: protected-file SHA-256 diff, `git diff --stat`
restricted to protected paths, typecheck, lint, full test suite, production build.
