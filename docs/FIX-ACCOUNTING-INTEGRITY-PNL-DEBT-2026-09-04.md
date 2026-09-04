# Fix Report — Financial Accounting Integrity & P&L / Debt Correction

Targeted corrections to Quick Pay, Realized P&L unification, the Accounting-Liability vs Future-Obligation separation, and the IRT/USD FX anchoring rules. No accounting-core change, no FIFO-engine change, no DB schema/migration.

---

## 1. Quick Pay — an installment settlement posts the PAYMENT-rate USD, never the creation-time USD

**Root cause.** `payInstallment` (Quick Pay) computed the frozen Toman correctly (`settledToman` = contractual `amount_toman`), but then posted the ledger legs with the **legacy USD** `inst.amountBase` (`amount = D(inst.amountBase)`) — the creation-time figure. When FX moved between creation and payment, the ledger (and the debt balance) recorded the stale USD, not `Toman ÷ payment_rate`. The Payment Form (`createTransactionAction`) already posted `irtAmount ÷ serverRate`, so the two payment paths disagreed.

**Fix (one shared calculation, used by both paths).**

- `src/features/planning/installmentFx.ts`: introduced `calculateInstallmentPayment({ amountToman, fxRate })` — the single deterministic payment math (`paidUsd = amount_toman ÷ fx_rate`). `buildInstallmentPaymentSnapshot` is now a thin delegate to it, so every existing caller inherits the same arithmetic.
- `src/features/planning/service.ts` — `payInstallment`: posts `paymentUsd = paid_toman ÷ payment_fx_rate` as the `baseValue` of **both** the cash and the debt legs, and derives native `quantity` from that same value via `unitsFor`. The frozen `paidToman` stays the contractual 909,090 Toman.
- `src/app/actions.ts`: the linked-installment freeze now calls `calculateInstallmentPayment` directly (same function as Quick Pay).

**Pinned result.** 909,090 Toman created at 280,000 IRT/USD, paid at 300,000 → ledger legs ±3.0303 USD; `amount_usd_created` stays ≈ 3.24675 USD; `amount_toman` stays 909,090.

---

## 2. Realized P&L is unified — FIFO financial assets + real assets (Real Estate / RWA)

**Root cause.** `getRealizedPnl()` summed only `lot_consumptions.realized_pnl`, so a real-asset sale (a real-estate property, or a sold vehicle) never appeared in the portfolio's realized-P&L KPI.

**Fix (read model only — `src/features/ledger/queries.ts`).**

- **Real estate / ledger-carried real assets**: posts its realized result to the 4100 account on a `sell` entry with **no** `lot_consumptions`. A FIFO sell always consumes lots, so `not exists (lot_consumptions …)` cleanly separates the two. Added to `total` as `-Σ base_value` of those 4100 legs.
- **Sold vehicles** (registry-carried, never led through 4100 — their disposal goes to opening equity): added from `vehicle_assets` as `sale_value_usd − purchase_value_usd` for `status = 'sold'`.
- `bySymbol` is unchanged (FIFO-only breakdown).

**Real-estate sale write path (`src/features/rwa/realEstate/service.ts`).** New `sellRealEstateAsset` books, in one transaction through the existing `postEntry`:
1. carrying value out of the real-estate asset account (qty −1, `purchase_value_usd`),
2. sale proceeds into the chosen cash account (sale-date rate),
3. the difference into the realized-P&L account (4100) when non-zero,
4. removal of the property row + soft-delete of the asset + `prices` cleanup + a frozen `entry_fx_snapshots` row (sale Toman + rate) + an audit event.

`src/app/actions/realEstate.ts` exports `sellRealEstateAction` (no UI form required for the action itself). Real-asset realized P&L is **never** forced through `consumeFifo()`.

**Pinned result.** 5B → 7.2B Toman property: realized +2.2B Toman (+10,000 USD), unrealized 0 after the sale, unified `getRealizedPnl.total` includes +10,000.

---

## 3. Net Worth = Assets − Accounting Liabilities only; future obligations reported separately

**Root cause.** `getCurrentNetWorth` folded the debt **installment schedule** (principal + future interest) into liabilities whenever any debt row existed. That replaced the ledger-principal liability with the full future-payments total and inflated the liability side by unaccrued interest (e.g. a 1.2B-Toman ledger principal with a 1.38B-Toman schedule showed 1.38B as a liability).

**Fix (`src/features/portfolio/service.ts`).**

- `totalLiabilities` / `totalLiabilitiesToman` now come **only** from ledger liability balances (`getAccountBalances` rows with `type = 'liability'`).
- `netWorth = valuation.totalNetWorth − totalLiabilitiesUsd`.
- The schedule is exposed separately as `futureObligationsUsd` / `futureObligationsToman` (reporting-only, never subtracted from net worth).

`getLiabilitiesTotal` (ledger) and the reports/net-worth pages already read the ledger-only liability figure, so they now agree.

---

## 4. IRT-anchored vs USD-anchored FX — verified, no code change

The existing read model (`getPortfolioValuation`) already implements the required anchoring:

- IRT balance → Toman is canonical (`currentValueToman = quantity`); USD equivalent = `Toman ÷ rate`.
- USD balance → USD is canonical (`currentValue = quantity`); Toman equivalent = `USD × rate`.

No mutation was needed. A regression test locks it (10B Toman stays 10B Toman across a 200k→250k FX move; $50,000 stays $50,000 while its Toman equivalent follows the rate).

---

## Acceptance criteria — verification map

| Criterion | Where verified |
|---|---|
| Quick Pay FX: 909,090 IRT @ creation 280k / payment 300k → `paymentUsd` ≈ 3.0303; `amountUsdCreated` ≈ 3.24675 unchanged | `tests/accounting-integrity-fixes.test.ts`; `tests/installment-fx-freeze.test.ts` |
| FIFO realized P&L intact | `tests/db-integration.test.ts`, `tests/fx-architecture.test.ts`, `tests/comprehensive-spec.test.ts`, `tests/fifo-reversal.test.ts` |
| Real-asset sale 5B → 7.2B: realized +2.2B, unrealized 0 | `tests/accounting-integrity-fixes.test.ts` |
| FX revaluation: IRT stays 10B Toman; USD stays $50k | `tests/accounting-integrity-fixes.test.ts` |
| Net Worth = Assets − Accounting Liabilities only | `tests/accounting-integrity-fixes.test.ts`; `tests/net-worth-snapshot-isolation.test.ts` |
| Σ(base_value) = 0 on every entry | `tests/security-accounting-invariant.test.ts`; assertions inside the new test file |

---

## Files changed

| File | Change |
|---|---|
| `src/features/planning/installmentFx.ts` | `calculateInstallmentPayment` (shared math); `buildInstallmentPaymentSnapshot` delegates to it |
| `src/features/planning/service.ts` | `payInstallment` posts payment-rate USD legs (`paymentUsd`) instead of creation-time `amountBase` |
| `src/app/actions.ts` | Payment-Form freeze uses `calculateInstallmentPayment` directly |
| `src/features/ledger/queries.ts` | `getRealizedPnl.total` adds real-asset (4100 non-FIFO) + sold-vehicle realized P&L; `bySymbol` unchanged |
| `src/features/portfolio/service.ts` | net-worth liabilities = ledger-only; `futureObligationsUsd/Toman` added |
| `src/features/rwa/realEstate/service.ts` | `sellRealEstateAsset` write path (non-FIFO sale through `postEntry`) |
| `src/app/actions/realEstate.ts` | `sellRealEstateAction` export |
| `tests/accounting-integrity-fixes.test.ts` | **new** regression suite (5 tests) |

## Explicitly NOT changed (scope lock honored)

`src/domain/accounting.ts`, `src/domain/fifo.ts` (and `consumeFifo`), `src/db/schema.ts` + DDL + `init-schema.ts`, `journal_entries` / `postings` / `lots` / `lot_consumptions` structures, `reverseEntry()`, `assertBalanced()`, FIFO cost basis, and every other ledger write path. No seed change, no UI change beyond the action export, no DB migration.

## Database migration

**None required.** All changes are write/read-model code. No new tables or columns.

## Test results

- `npx tsc --noEmit` → **0 errors**.
- ESLint on all changed/new files → **clean**; `git diff --check` → **clean**.
- New suite `tests/accounting-integrity-fixes.test.ts` → **5/5 pass**.
- Targeted affected suites → **all pass**: `installment-fx-freeze` (7), `debt-total-source-of-truth` (11), `debt-toman-migration` (12), `debt-planning-toman-fixed`, `debt-toman-model`, `installment-loan-*`, `hotfix-ledger-tenancy-fees` + `security-accounting-invariant` + `reports-forward-liquidity-toman` + `db-integration` + `fx-architecture` + `comprehensive-spec` (42/42), `portfolio-valuation` + `net-worth-snapshot-isolation` + `valuation-toman-consistency` + `opening-balance-display` + `wealth-health-return-fix` (28/28), multi-user/currency/analytics isolation + fail-closed + isolation-hardening (39 pass of 43 — the 4 failures are the pre-existing `global-system-directive` display tests, below), `stage3/stage4/stage5` regression + `cash-flow-toman-freeze` + `liquidity-forecast-month-buckets` + `obligations-90day-scope` + `fifo-reversal` + `holdings-zero-tone` + `account-denomination-fx`.
- Full suite (`node --experimental-test-module-mocks --import tsx --test "tests/**/*.test.ts"`) → **480 tests, 456 pass, 24 fail**. All 24 are **pre-existing** and were re-confirmed against the clean baseline (`git stash` → same failures → `git stash pop`):

| Pre-existing failure family | Files / count |
|---|---|
| Money-display bidi-isolate / Persian-digit ordering (in `src/lib/format.ts`) | `e2e-smoke-denomination-fx` (1), `global-system-directive` (4), `landing-pwa` (2), `money-display` (4) = 11 |
| RWA compact-symbol `001` unique collision (`nextRwaSymbol` id-generation bug, see `AUDIT-REAL-ESTATE-CLEANUP.md`) | `vehicle-module` (7), `real-estate-module` / `real-estate-valuation-history` / `real-estate-actions.smoke` (5) = 12 |
| `listBudgets` N+1 batch-query assertion | `stage6-performance-caching-scalability` (1) |

## Findings recorded (not fixed — per scope lock)

- **P3 — Real-estate ledger accounts are global.** `ensureRealEstateLedgerAccounts` provisions the 1600 asset account and 3015 opening-equity account with `user_id NULL` (shared rows). Read isolation holds because balances/realized-P&L are scoped at the journal-entry level (`je.user_id`), but the CoA rows themselves are not tenant-owned. Left as-is; noted for the multi-tenant follow-up.
- **P2/Future — wallet/custody FIFO account limitation.** Not exercised by the touched paths; left as-is per instruction (recorded, not fixed).
- The 24 full-suite failures above are pre-existing and out of scope for this correction; they are documented here for completeness, not addressed in this change.

## Scope audit

- Quick Pay → fixed at the shared payment-calculation layer (`calculateInstallmentPayment`), consumed identically by Quick Pay and the Payment Form.
- Realized P&L → fixed at the read model (`getRealizedPnl`); the real-estate sale writes through the existing `postEntry` write path; nothing is forced into FIFO.
- Net-worth liabilities → fixed at the portfolio read model; the schedule is surfaced as a separate field, never folded into net worth.
- IRT/USD anchoring → verified correct; locked with a regression test; no mutation introduced.
