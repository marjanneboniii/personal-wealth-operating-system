# Fix Report — Personal Wealth Operating System

Four bugs in the Persian wealth app were root-caused and fixed at the correct layer (query / mapper / service / UI). No refactor, no financial-core change, no DB schema change.

---

## 1. Installment ≠ Loan — records that are only installments appear in «وام‌ها»

**Root cause.** `src/app/debts/loans/page.tsx` filtered loans with:

```ts
debts.filter((d) => Number(d.interestRate) > 0 || d.totalCount > 0)
```

`totalCount > 0` is true for *any* repayment schedule, including a planning-only 0%-interest installment plan (e.g. a store «قسط فرش» with 1 installment). Those records are not loans, but they were rendered as loans. The schema has no `kind` column, so this cannot be distinguished by a DB field.

**Fix (loans UI + shared predicate in planning/service).** A real Loan / Facility is defined as:

- a debt with financing (`interestRate > 0`), **or**
- a debt already booked in the double-entry ledger against a liability account (`accountId` non-empty — the money was actually received).

```ts
export function isRealLoanDebt(d) {
  return Number(d.interestRate ?? 0) > 0 || (d.accountId != null && d.accountId !== "");
}
```

- `loans = debts.filter(isRealLoanDebt)` in the Loans UI.
- Subtitle and empty-state text updated to state the rule.
- **No data is hidden or deleted:** planning-only quarterly debts still appear in «بدهی‌ها» and their schedule still appears in «اقساط». `listDebts`, `upcomingInstallments`, `payInstallment` are unchanged.
- Seed loans (18%, 21%) survive the filter.

**Tests.** `tests/installment-loan-classifier.test.ts`, `tests/installment-loan-separation.test.ts`.

---

## 2. «نقدینگی تجمیعی / تجمعی» removed from the forward-liquidity UI

**Root cause.** The Reports forward-liquidity table showed a cumulative column that duplicates the role of /planning's end-of-year KPI and was the source of the confusing «۹۸۴,۴۷۴,۲۷۸,۸۰۰,۰۰۰»-style double-conversion outputs.

**Fix (UI only — service logic preserved).**

- `src/app/reports/page.tsx`: removed the «نقدینگی تجمعی» `<th>` and the two cells (`cumulative` Toman + USD hint) from the forward-liquidity table.
- `src/features/planning/service.ts` is **unchanged** on this point — `ProjectionPoint.cumulative` / `cumulativeUsd` still exist because `/planning` reads them for «نقدینگی پایان ۱۲ ماه». (Verified; deliberately not deleted.)
- Test `tests/reports-forward-liquidity-toman.test.ts` updated to assert the column is gone and stale cumulative figures/hints are not rendered. The monthly Toman figure stays fixed; the USD hint stays a ÷-rate display-only conversion (909,090 Toman ÷ 200,000 = 4.55 USD).

---

## 3. Obligation bucketed in the actual Jalali month of its due date (۱۴۰۵/۰۸/۰۱ → آبان, never مهر)

**Root cause.** The projection bucketed obligations by the **Gregorian month start**:

```ts
const bucketKey = (iso) => iso.slice(0, 8) + "01"; // 2026-10-01
```

Jalali months begin ~11 days after the Gregorian month start. A due date of ۱۴۰۵/۰۸/۰۱ (2026-10-23) was therefore bucketed under 2026-10-01 and displayed as مهر (۱۴۰۵/۰۷) instead of آبان (۱۴۰۵/۰۸) — the off-by-one month. The `ProjectionPoint.month` was also that wrong key, so the chart/labels inherited the shift.

**Fix (planning service, bucket keys derived from the Jalali calendar).** Verified Jalali boundaries first:

- `toJalali("2026-10-23") = 1405/8/1` (آبان), `toJalali("2026-11-21") = 1405/8/30`, `toJalali("2026-11-22") = 1405/9/1` (آذر), `jalaliToIso(1405, 8, 1) = "2026-10-23"`.

New helpers in `src/features/planning/service.ts`:

```ts
export function jalaliMonthBucketKey(iso: string): string {
  const { y, m } = toJalali(iso);
  return `${y}/${String(m).padStart(2, "0")}`;   // 1405/08, never 1405/7
}

export function jalaliMonthStarts(months: number, fromIso?: string) {
  // ISO first days of the next `months` Jalali months, starting at fromIso's own month
}
```

- `projectCashflow` builds buckets from `jalaliMonthStarts(months)`; each obligation is pushed with `jalaliMonthBucketKey(dueDate)` — the conventional calendar month of the due date itself.
- Recurring obligations iterate Jalali months from their due date (no Gregorian month arithmetic).
- `ProjectionPoint.month` = ISO first day of that Jalali month (e.g. ۱۴۰۵/۰۸ → 2026-10-23), so `toJalali()`/`jalaliMonthKey()` labels always derive the correct month.
- No ±1-day shift, no timezone conversion, no change to `todayIso()`.

**Test.** `tests/liquidity-forecast-month-buckets.test.ts` covers the آبان boundary, month-end, next-month rollover, zero-padded keys, and recurring obligations.

---

## 4. Negative «بازده تعدیل‌شده» ≈ −29.99% and «بازده سرمایه‌گذاری خالص» = −۶٬۷۵۷٬۳۷۴٬۷۷۷ تومان (≈ −۳۲٬۱۷۷.۹۸ دلار)

**Root cause — double subtraction against a non-existent starting snapshot.**

1. The UI's «ثبت اسنپ‌شات» button (`takeSnapshotAction`) writes the **legacy `snapshots`** table. **`portfolio_snapshots` is never written by the UI.**
2. `getAnalyticsSummary` read only `portfolio_snapshots` → saw **zero** history → fell back to **today's total cost basis** as the "period start".
3. Today's cost basis already embeds every deposit/withdrawal of the period. The analytics layer then subtracted `netExternalFlows` **again** from that value → a synthetic "loss" equal to −(net external flows):
   - −6,757,374,777 Toman at 210,000 IRT/USD = −32,177.98 USD (the exact reported figure).
4. The adjusted-return denominator also used **gross** inflows while the numerator subtracts **net** flows — internally inconsistent.

Additionally, `capitalFlows.ts` tested `isOpening` **before** `isCapitalWithdrawal`; a negative withdrawal leg booked with an `opening`-type entry was treated as "opening" (positive-only) and dropped — a pure withdrawal appeared as zero flows and looked like a fake investment loss.

**Fix at the analytics layer (no UI workaround, no financial-core change).**

`src/features/analytics/service.ts`:

- **Merged snapshot history**: reads both the legacy series (`getSnapshotSeries`, already tenant-scoped) and `portfolio_snapshots`; on the same date the portfolio snapshot wins; ghost/inactive RWA values subtracted; sorted ascending.
- `periodStart` = oldest **real** snapshot date (no more `2025-01-01` placeholder / today-fallback starting value).
- `flowStart` = the day **after** the starting snapshot, so flows already captured inside the starting snapshot are never subtracted twice.
- `startingVal` = the earliest snapshot's value. With **no snapshot at all**: `hasMissingData: true`, `startingVal: "0"`, and a Persian reason («برای محاسبه بازده تعدیل‌شده به حداقل یک اسنپ‌شات تاریخی نیاز است…») instead of a fabricated percentage.
- Risk metrics now use the same unified real history.

`src/features/analytics/performance.ts`:

```ts
// BEFORE
capitalBase = start + (externalInflows || netExternalFlows.gt(0) ? netExternalFlows : "0");
// AFTER — numerator and denominator both use NET external flows
capitalBase = start + netExternalFlows;
```

`src/features/analytics/capitalFlows.ts`:

- **Direction-first classification**: `isCapitalWithdrawal` is checked before `isOpening`, so a negative «برداشت سرمایه» leg is an outflow even when its entry type is `opening`; positive opening/deposit legs unchanged.

**Formula before / after.**

| | Numerator (net investment return) | Denominator (adjusted return) | Start value |
|---|---|---|---|
| Before | `(end − start) − netExternalFlows` | `start + grossInflows` | today's total cost basis when no `portfolio_snapshot` exists (already flow-inclusive) |
| After | `(end − start) − netExternalFlows` (same) | `start + netExternalFlows` | oldest real snapshot (legacy+portfolio merged); flows counted only after that date; missing snapshot ⇒ `missing_data` |

**Behavior pins (tests):** deposit-only ⇒ net return `"0.00"`, adjusted `"0.00"`; withdrawal-only ⇒ `"0.00"`/`"0.00"`; no snapshot ⇒ status `missing_data`, startingValue `"0.00"`; genuine +500 gain ⇒ return `"500.00"`, adjusted `"1.00"`; multi-user A=50k / B=70k isolated.

**Test.** `tests/wealth-health-return-fix.test.ts`.

---

## 5. Toman/USD conversion, unit scaling, multi-user isolation (verification)

No defect found, **no code change made** — the existing implementation is correct:

- FX lookup is per-user (`getLatestUsdIrtRateForUser`, `src/lib/fx.ts`).
- Toman is the authoritative unit for planning/loans; USD hints are display-only ÷-rate conversions (tests assert no second ×rate multiplication).
- All analytics/liquidity queries are tenant-scoped (`userId` / `hasMultipleUsers` gate).

Covered by passing suites: `analytics-layer`, `analytics-isolation`, `multi-user-isolation`, `net-worth-snapshot-isolation`, `debt-planning-toman-fixed`, `reports-forward-liquidity-toman`, `real-estate-module`.

---

## Files changed

| File | Change |
|---|---|
| `src/features/planning/service.ts` | `isRealLoanDebt`, `jalaliMonthBucketKey`, `jalaliMonthStarts`; Jalali bucket engine in `projectCashflow`; `ProjectionPoint.month` = Jalali-month first day |
| `src/features/analytics/service.ts` | merged legacy+portfolio snapshot history, real `periodStart`, flow window after snapshot, `hasMissingData` + Persian reason, unified risk history |
| `src/features/analytics/performance.ts` | adjusted-return denominator = `start + netExternalFlows` |
| `src/features/analytics/capitalFlows.ts` | direction-first withdrawal classification |
| `src/app/debts/loans/page.tsx` | filter `isRealLoanDebt`, subtitle/empty-state |
| `src/app/reports/page.tsx` | removed «نقدینگی تجمعی» column |
| `tests/reports-forward-liquidity-toman.test.ts` | updated for removed column |
| `tests/installment-loan-classifier.test.ts` | **new** |
| `tests/installment-loan-separation.test.ts` | **new** |
| `tests/liquidity-forecast-month-buckets.test.ts` | **new** |
| `tests/wealth-health-return-fix.test.ts` | **new** |

## Explicitly NOT changed (scope lock honored)

Accounting Core, GL, journal entries, double-entry, FIFO / cost basis, realized & unrealized PnL, transaction engine, payment logic, asset core, cash/currency logic, multi-user architecture, auth, `src/db/schema.ts` + DDL + `init-schema.ts`, seed, `src/features/ledger/*` (queried, not modified), `/planning` page, `/cash-flow`, `/insights`, wallet/watch-only, Market Data/CoinGecko.

## Database migration

**None required.** No schema change was made — debts/installments/snapshots/portfolio_snapshots keep their existing shapes. The in-memory test DB uses `src/db/init-schema.ts`; a real PostgreSQL deployment needs no `npm run db:migrate` step.

## Test results

- `npx tsc --noEmit` → **0 errors**.
- ESLint on all changed/new files → **clean**. `git diff --check` → **clean**.
- Targeted new/updated tests — **16/16 pass**:
  `installment-loan-classifier`, `installment-loan-separation`, `liquidity-forecast-month-buckets`, `wealth-health-return-fix`, `reports-forward-liquidity-toman`.
- Broader targeted run (11 files: analytics layer/isolation, multi-user, net-worth isolation, debt-planning Toman, real-estate, plus the five above) — **72/72 pass**.
- Full suite (`node --experimental-test-module-mocks --import tsx --test "tests/**/*.test.ts"`) — **440 tests, 416 pass, 24 fail**. All 24 failures are **pre-existing** and live in 7 files untouched by this work (`vehicle-module` 11 fails; `money-display`, `global-system-directive`, `landing-pwa`, `e2e-smoke-denomination-fx`, `real-estate-valuation-history`, `stage6-performance-caching-scalability` 17 fails). Confirmed by stashing the working tree and re-running the same files on the clean baseline (`git stash -u` → identical failures → `git stash pop`).

## Scope audit

- Bug 1 → fix at UI filter + shared predicate (no schema change, no data hidden).
- Bug 2 → UI-only removal; service `cumulative` retained for /planning.
- Bug 3 → fixed at the bucket-key layer in the planning service; date utilities (`toJalali`, `jalaliToIso`) and `todayIso()` untouched; no timezone hacks.
- Bug 4 → fixed at the analytics source-of-truth layer (snapshot history + flow window + denominator), never by hiding the minus sign; `capitalFlows` classifier made direction-first.
- Bug 5 → verified, no change.
