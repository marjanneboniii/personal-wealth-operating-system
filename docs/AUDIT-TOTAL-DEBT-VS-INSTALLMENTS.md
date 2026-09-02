# AUDIT — «مانده کل بدهی» vs «مانده اقساط»

**Date:** 2026-09-02
**Branch:** `arena/01a0601f-personal-wealth-operating-syst`
**Status:** Root-caused, fixed, regression-tested.

---

## 1. Symptom

| Location | Label | Value |
|---|---|---|
| `/debts` (نمای کلی بدهی‌ها) | «مانده کل بدهی» | `۷۱٬۳۰۰٬۰۰۰ تومان` · معادل: `۳۳۹.۵۲ دلار` |
| `/installments` | «مانده اقساط» | `۸۶٬۸۱۸٬۱۸۰ تومان` · معادل فعلی: `۴۱۳.۴۲ دلار` |

Gap: **۱۵٬۵۱۸٬۱۸۰ تومان**.

### Currency is provably NOT the cause

Both figures divide by the **same** rate:

```
71,300,000 / 339.52 = 210,002
86,818,180 / 413.42 = 210,000      (delta is 2-decimal USD rounding only)
```

The FX path is identical on both sides. The whole gap lives in the **Toman base**.

---

## 2. Trace

```
/debts  (src/app/debts/page.tsx:33)
  └─ sumToman(debts.map(d => d.outstandingToman))
       └─ listDebts()                      src/features/planning/service.ts:250
            ├─ SELECT * FROM debts WHERE deleted_at IS NULL AND user-scoped
            ├─ SELECT * FROM installments
            └─ outstandingToman = principal_toman − Σ(paid installments)   ← BUG

/installments  (src/app/installments/page.tsx:57)
  └─ sumToman(pending.map(r => r.fx.amountToman))
       └─ listInstallmentSchedule()        src/features/planning/service.ts:379
            ├─ installments INNER JOIN debts (user-scoped)
            └─ fx = buildInstallmentFxView(row, rate)   src/features/planning/installmentFx.ts
                 └─ amountToman = paid_toman (paid) | amount_toman (pending) | amount_base × rate (legacy)

/debts/obligations  (src/app/debts/obligations/page.tsx:96)
  └─ next90 = rows.filter(r => r.date >= today && daysUntil(r.date) <= 90)
       rows = upcomingInstallments(100) ∪ listObligations()[pending] ∪ listEvents()[planned]
```

Two **independent** formulas for what is nominally one concept: *what is still owed*.

---

## 3. Domain definitions (extracted, not invented)

| Term | Persian label in code | Real definition | Evidence |
|---|---|---|---|
| **Total Debt** | «مانده کل بدهی» / per-debt «مانده قابل پرداخت» | Sum, over the tenant's debts, of what is **still payable**. | `src/app/debts/page.tsx:72,146`, `src/app/debts/loans/page.tsx:132` |
| **Remaining Installments** | «مانده اقساط» | Sum of `amount_toman` over installments with `status != 'paid'`. | `src/app/installments/page.tsx:51-57` |
| **Future Obligations** | «مجموع تعهدات پیش‌رو» | Installments ∪ `obligations(status=pending)` ∪ `events(status=planned)` with `date >= today`. Planned ≠ actual; carries **no** ledger effect. | `src/app/debts/obligations/page.tsx:97,117-120` |
| **90-Day Obligations** | «۹۰ روز آینده» | **Count** of the above rows with `due_date ∈ [today, today+90d]`. A time-window *slice*, never a debt total. | `src/app/debts/obligations/page.tsx:96,130` |

### Entity semantics (from schema + relations, not from names)

* **`debts`** — a facility: `creditor`, `principal_toman` (contractual, authoritative), `interest_rate`, optional `account_id` (ledger liability). `status: active | settled`.
* **`installments`** — a schedule row of exactly one debt (`debt_id NOT NULL → debts.id ON DELETE CASCADE`). `amount_toman` is the frozen obligation; `paid_toman/paid_usd/paid_fx_rate` freeze at settlement. `status: pending | paid`.
* **`obligations`** — a **standalone** commitment. No `debt_id`, no installment link, no ledger account. It is *not* debt and never enters Total Debt.
* **`Loan` vs `Installment`** — a Loan is a debt with financing (`isRealLoanDebt`: `interest_rate > 0 || account_id != null`); an installment plan with 0% interest and no ledger account is **not** a loan. They overlap by construction (`Loan └── Installments`), so summing both double counts.

### Critical lifecycle fact

`payInstallment` (service.ts:466) and `createTransaction` (actions.ts:784) **never write `debts.principal_toman`**. They only flip the installment to `paid` and set `debts.status = 'settled'` once the pending count reaches zero. The debt's balance is therefore *driven entirely by the schedule* — `principal_toman` is a static contractual figure, not a maintained balance.

---

## 4. Root cause

`listDebts().outstandingToman = principal_toman − Σ(paid installment amount_toman)`

a **principal-amortisation** view, wrong in three independent ways:

1. **Under-counting (interest dropped).** A schedule totals *more* than its principal — it carries interest. Seed data: principal `1,520,000,000` vs 24 × `74,100,000` = `1,778,400,000`. The `258,400,000` interest share silently vanished from Total Debt.
2. **Not a maintained balance.** `principal_toman` is never written back on payment, so the subtraction drifts away from reality as installments are paid.
3. **Clamp-to-zero.** Once `Σ(paid) > principal_toman` the result goes negative and is clamped to `0` — a debt reporting **zero** owed while unpaid installments remain.

Reproduced against the real service (before fix):

```
  debt Amortizing  principal=100000000 outstanding=        0 status=active paid/total=3/4
  TOTAL DEBT (listDebts)      :  95000000
  REMAINING INSTALLMENTS      : 135000000
```

`Amortizing` has one unpaid `40,000,000` installment and reported `0`.

**Rejected hypotheses:** B Filtering (no status/date filter existed on the debt query) · C Paid/Original swap (paid rows were correctly excluded) · **D Double counting** (the old code counted *less*, not more) · E Missing entity (obligations are correctly out of scope) · G Tenant scope (verified isolated) · §13 Currency (proved identical rate above).

---

## 5. Fix (minimum necessary)

One definition of "remaining", taken from the schedule, in the one place that
computes it. `src/features/planning/service.ts::listDebts`:

```
outstandingToman = Σ resolveInstallmentToman(i, rate)  for i in installments where status != 'paid'
                   └─ falls back to principal_toman − Σ(paid) only when the debt has NO schedule
```

`resolveInstallmentToman` is the **existing** helper `listInstallmentSchedule`
already uses, so both pages now read the same rule by construction.

No double counting: a debt contributes **either** its schedule **or** (only when
it has none) its principal — never both.

Companion fix in `src/app/debts/loans/page.tsx`: «بازپرداخت‌شده» was derived as
`principal − outstanding`, an identity that is false for an interest-bearing
schedule. It now uses the newly exposed `paidToman` (what was actually paid).

**Not changed:** the 90-day window, the FX path, `obligations`, the ledger.

---

## 6. Database

**No migration required.** The fix is a read-path aggregation change. No schema,
column, index, or data change; `drizzle/` and `src/db/schema.ts` are untouched
(`git diff --name-only -- drizzle/ src/db/schema.ts` → 0 files).

---

## 7. Verification

* `tests/debt-total-source-of-truth.test.ts` — 11 tests, real in-memory schema, real service.
  **6 of them fail against the pre-fix code** (verified by `git stash`), so they are genuine regressions.
* `tests/obligations-90day-scope.test.ts` — 5 tests rendering the real page; all pass **unchanged**,
  confirming the 90-day scope was already correct and needed no edit.
* Full suite: **456 tests, 432 pass, 24 fail**. The 24 failures are **pre-existing and
  byte-identical** to the baseline run on unmodified `main` (real-estate / vehicle /
  money-formatting / CoinGecko-offline specs). **Zero failures introduced.**
* **End-to-end on the project's own seed data** (`ALLOW_DEMO_SEED=true`, real
  `seedIfEmpty` → real `listDebts` / `listInstallmentSchedule`):

  ```
    وام مسکن     principal=  1520000000 outstanding=  1333800000 paid=  444600000 active 6/24
    اقساط خودرو  principal=  1140000000 outstanding=  1003200000 paid=  250800000 active 4/20
    مانده کل بدهی  : 2337000000
    مانده اقساط    : 2337000000
    MATCH          : true
  ```

  Cross-check by hand: `18 × 74,100,000 = 1,333,800,000` and
  `16 × 62,700,000 = 1,003,200,000`. The old formula produced
  `1,964,600,000` — short by exactly `372,400,000`, which is precisely the two
  loans' interest (`258,400,000 + 114,000,000`). Root cause confirmed numerically.
* `tsc --noEmit` clean · `eslint` clean on every changed file.
* Accounting Core, General Ledger, FIFO, Cost Basis, PnL and the Transaction
  Engine: **not touched** — `git diff --name-only` returns only
  `src/app/debts/loans/page.tsx`, `src/features/planning/service.ts` and the two
  new test files.
