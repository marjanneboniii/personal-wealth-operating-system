# Financial & Accounting Logic Audit — توازن (PWOS)

**Date:** 2026-08-21
**Branch:** `arena/01a022c6-personal-wealth-operating-syst` (off `main` @ `106289b`)
**Scope:** Audit only. No code, migration, database, UI, or package changes were made.

> How to read this report: every Finding is labeled with `Status` (PASS / FAIL / PARTIAL / MISSING), `Evidence` (file / component / function / table), `Current Behavior`, `Expected Behavior`, `Impact`, and `Severity` (Critical / High / Medium / Low). A final status table closes the report.

---

## 1. Executive Summary

The project is a **genuine double-entry accounting system** built on an immutable ledger (`journal_entries` + `postings` with `Σ base_value = 0`), FIFO lot tracking, and a well-separated valuation layer. The **base/functional currency of the entire ledger is USD**; Iranian Toman (`IRT`) is a *denominated asset* held inside accounts, not a first-class currency of record.

The most important finding of this audit:

> **The system has no “Contractual / Fixed Toman Amount” concept for debts and installments.**
> A debt is captured in Toman at the form (`principalIrt`), immediately divided by the *current* FX rate, and **only the resulting USD value is stored** (`debts.principalBase`, `installments.amountBase`). The original Toman figure (e.g. 909,090) is **discarded**. Every later Toman display is re-derived as `USD × current rate`, so **raising the dollar rate silently raises the Toman amount of unpaid debts and installments** — exactly the behavior the business rule forbids.

Secondary critical issues:

1. **Two disconnected USD↔IRT rate systems** produce inconsistent Toman balances: display/valuation uses `user_fx_settings` / `exchange_rates` / `settings.irt_rate` (default 190,000), while ledger *quantity* conversion for cash postings uses the `prices` table (seed `IRT = 0.00001`, i.e. 100,000 Toman/USD, and **absent** for per-user setups). The two are never synchronized.
2. **Sell/Swap has no per-holding-location (wallet/account) source model for crypto.** Crypto assets get **one** account per asset per user (`registerMarketAssetAction`), with no `walletId`. FIFO lots are consumed **globally per asset**, ignoring the source account, and no overdraft guard runs on the individual source account during a sale.
3. **"Creditor/Payee/Payment-method" are not distinct concepts.** `debts.creditor` is a free-text label; the actual double-entry counterpart is an internal account (liability `2xxx` or expense `5xxx`), and there is no field for payment destination/method other than free-text `description`/`memo`.
4. **Debt creation never touches the ledger** (planning-only), so there is **no FX snapshot** at debt creation; the two payment paths behave inconsistently (one freezes an FX snapshot, the other does not).

What is done well (PASS): immutable ledger + reversal-only corrections; realized P&L via FIFO is frozen and historical; unrealized P&L and market valuation are correctly dynamic; real-estate/vehicle valuation snapshots are insert-only and rate-frozen; net worth correctly revalues *assets* with FX.

---

## 2. Current Architecture

| Concern | Location | Notes |
|---|---|---|
| Debt UI (frontend) | `src/app/debts/page.tsx`, `src/app/debts/loans/page.tsx`, `src/app/debts/installments/page.tsx`, `src/app/debts/obligations/page.tsx`, `src/app/installments/page.tsx`, `src/components/forms/DebtForm.tsx`, `src/components/forms/DebtInstallmentExplorer.tsx` | Debt list + manual debt form + repayment explorer |
| Debt backend / API | `src/app/actions.ts` (`createDebtAction`, `createTransactionAction` → `debt_repayment`, `payInstallmentAction`), `src/features/planning/service.ts` (`listDebts`, `payInstallment`, `upcomingInstallments`) | Server Actions (no REST route for debts) |
| DB schema | `src/db/schema.ts` — `debts`, `installments`, `obligations`, `planned_transactions`, `journal_entries`, `postings`, `accounts`, `assets`, `wallets`, `lots`, `lot_consumptions`, `entry_fx_snapshots`, `prices`, `exchange_rates`, `user_fx_settings`, `snapshots`, `portfolio_valuations` | 30+ tables; single write path `postEntry` |
| Currency / FX logic | `src/lib/fx.ts` (`getLatestUsdIrtRateForUser`), `src/features/fx/*` (`convert.ts`, `rates.ts`, `userRate.ts`, `types.ts`), `src/components/settings/FxSettings.tsx`, `src/lib/auth-actions.ts` (`updateFxRateAction`) | Two rate stores: `user_fx_settings` (per user) and `exchange_rates` (global) + legacy `settings.irt_rate` |
| USD-equivalent computation | `src/lib/format.ts` (`irtToUsd`, `usdToIrt`, `formatDualMoneyFromIrt`), `src/lib/fx.ts` (`previewIrtToUsd`); frozen copies in `entry_fx_snapshots` | Display-only until commit, then frozen |
| Net worth | `src/features/portfolio/service.ts` (`getPortfolioValuation`, `getCurrentNetWorth`), `src/features/ledger/queries.ts` (`getNetWorth` legacy), `src/app/net-worth/page.tsx` | Assets = market value; liabilities = ledger-derived |
| Unrealized P&L | `src/features/valuation/service.ts` (`calculateMarketValuation`), `src/features/portfolio/valuation.ts` (`calculateUnrealizedPnl`) | Computed on the fly, never posted |
| Realized P&L | `src/features/ledger/service.ts` (`recordSell`), `src/domain/fifo.ts` (`consumeFifo`), `src/features/ledger/queries.ts` (`getRealizedPnl`), table `lot_consumptions` | Frozen in immutable rows |
| Sale / sell asset | `src/features/ledger/service.ts` (`recordSell`), `src/app/actions.ts` (`createTransactionAction` sell branch), `src/components/forms/TransactionForm.tsx` (`type === "sell"`) | Single “sell” transaction type |
| Wallet / account / custody | `src/features/accounts/service.ts` (`registerMoneyAccount`), `src/app/actions/pricing.ts` (`registerMarketAssetAction`), tables `wallets`, `accounts` | Money accounts (IRT/USD/USDT) are per-wallet; crypto accounts are not |

**Can one asset be held in multiple locations?**
- **IRT / USD / USDT (money accounts): YES** — each `registerMoneyAccount` call creates a new `wallets` row + `accounts` row linked by `walletId`.
- **Crypto (ETH/BTC/USDC/XAUT/…): NO** — `registerMarketAssetAction` reuses/creates exactly **one** asset account per (asset, user), with `walletId = NULL`.

**Is crypto balance stored per holding location?** **NO.** `getHoldings()` (`src/features/ledger/queries.ts`) aggregates `quantity`/`costBase` **by asset only** (`group by ast.id`). The read-only “custody” breakdown on `src/app/crypto/page.tsx` is derived from `getAccountBalances()` and can only reflect wallets for money accounts.

---

## 3. Debt / Installment Findings

### Finding 3.1 — Debt principal is stored in USD only; Toman is discarded
- **Status:** FAIL (Critical)
- **Evidence:** `debts.principalBase` (`numeric`) and `installments.amountBase` (`numeric`) in `src/db/schema.ts`; `createDebtAction` in `src/app/actions.ts` (`principalBase = principalIrt.div(rate)`, `installmentBase = installmentIrt.div(rate)`). No `*_toman` column exists anywhere on `debts`/`installments`.
- **Current Behavior:** The form collects `principalIrt` (Toman) and `installmentIrt` (Toman), then immediately converts to USD and stores only USD. There is **no journal entry and no `entry_fx_snapshots` row** at creation, so the original Toman amount and the creation-time rate are not persisted.
- **Expected Behavior:** Toman must be the stored, authoritative contractual amount; USD should be a derived/display equivalent that may change while the debt is unpaid.
- **Impact:** The legally/contractually fixed Toman amount cannot be reconstructed; reports and future payments drift with FX.
- **Severity:** Critical

### Finding 3.2 — Raising the FX rate changes the Toman amount of unpaid debts/installments
- **Status:** FAIL (Critical)
- **Evidence:** `DebtInstallmentExplorer`/`TransactionForm.handleSelectInstallment` (`src/components/forms/TransactionForm.tsx`): `irt = D(inst.amountBase).mul(effectiveRate)`. `listDebts` (`src/features/planning/service.ts`) returns only USD (`outstandingBase`, `principalBase`); debts page renders `formatMoney(...)` (defaults to **USD**, `src/lib/format.ts`).
- **Current Behavior:** When repaying via the form, the Toman field is re-derived as `stored USD × today's rate`. If the rate rose from 280,000 to 300,000, the user is prompted to pay **974,025 Toman** for an installment originally **909,090 Toman**.
- **Expected Behavior:** The Toman amount must remain 909,090 regardless of the new rate; only the USD equivalent may change before payment.
- **Impact:** Users overpay/underpay relative to their contractual obligation; debt totals on `/debts` are shown in USD (Toman not even displayed as primary).
- **Severity:** Critical

### Finding 3.3 — “USD equivalent dynamic / Toman fixed” is implemented backwards
- **Status:** FAIL (Critical)
- **Evidence:** Same as 3.1/3.2. The stored field (`principalBase`) is the USD value (static); the Toman value is the derived, dynamic quantity.
- **Expected Behavior:** Toman fixed (stored), USD derived and dynamic until payment.
- **Impact:** The core business invariant for liabilities is inverted.
- **Severity:** Critical

### Finding 3.4 — No FX snapshot at debt creation
- **Status:** MISSING (High)
- **Evidence:** `createDebtAction` only inserts `debts`/`installments`; `entry_fx_snapshots` is only written inside `createTransactionAction` after a journal entry.
- **Expected Behavior:** Freeze (IRT, USD, rate, source, date) at creation so the original 909,090 Toman and its rate are auditable.
- **Impact:** Cannot prove the creation-time conversion; historical debt record is lossy.
- **Severity:** High

### Finding 3.5 — Two payment paths: only one freezes the FX snapshot
- **Status:** PARTIAL (High)
- **Evidence:** `createTransactionAction` (`debt_repayment` + `installmentId`) writes `entry_fx_snapshots` at commit. `payInstallment` in `src/features/planning/service.ts` (used by “پرداخت سریع” via `payInstallmentAction`/`RowAction`) posts `baseValue = inst.amountBase` **without** any `entry_fx_snapshots` row.
- **Current Behavior:** Payment through the transaction form is frozen (immutable Toman/USD/rate). Payment through “پرداخت سریع” records only USD and no Toman snapshot.
- **Expected Behavior:** Every paid installment must freeze (Toman paid, USD equivalent, rate) immutably.
- **Impact:** Inconsistent historical audit trail depending on which button was used.
- **Severity:** High

### Finding 3.6 — Payment history vs FX change
- **Status:** PARTIAL (High)
- **Evidence:** Paid installments are stored with `amountBase` (USD) and `paidAt`/`paidEntryId` (`installments`). For the form path, `entry_fx_snapshots` freezes the Toman. For the quick-pay path, no Toman snapshot exists.
- **Current Behavior:** Ledger entries are immutable (PASS), but the *quick-pay* installment has no frozen Toman; the remaining unpaid installments re-derive Toman at the current rate.
- **Expected Behavior:** Paid Toman + USD + rate frozen; unpaid debt Toman fixed, USD dynamic.
- **Impact:** Historical records partially complete; unpaid amounts continue to drift.
- **Severity:** High

### Finding 3.7 — Planning-only debts have no liability account
- **Status:** PARTIAL (Medium)
- **Evidence:** `createDebtAction` sets `accountId: null` (“planning-only”). `payInstallment` throws `"حساب بدهی تعریف نشده است"` when `!debt.accountId`. The form path books the outflow against an *expense* account instead (type `debt_repayment`, excluded from expense aggregations).
- **Current Behavior:** User-created debts do not create a liability in the ledger; their “liability” only exists in the planning layer until repaid.
- **Expected Behavior:** Consistent ledger-backed liability for every debt (or an explicit, consistent planning-only model).
- **Impact:** Net-worth liability total for user-created debts is not ledger-derived until repayment; two divergent debt models coexist.
- **Severity:** Medium

### Finding 3.8 — Example trace: 909,090 Toman
- **Status:** FAIL (documented)
- **Trace:**
  1. Day 0, rate 280,000: user creates debt `principalIrt = 909090` → `principalBase = 909090 / 280000 = 3.24675` (USD). Installment `amountBase = 3.24675` (USD). **909,090 Toman is lost.**
  2. Day 1, rate 300,000: `/debts` still shows `3.25 دلار` outstanding; the debt’s *Toman* value is nowhere stored.
  3. Repay via form: `irtAmount = 3.24675 × 300000 = 974,025` Toman → user is charged **974,025** Toman, not 909,090.
  4. Repay via “پرداخت سریع”: `payInstallment` posts `3.24675` USD; no Toman snapshot; the bank IRT quantity is reduced by `3.24675 / latestPrice(IRT)` (see §4.2 — the quantity itself is wrong).
- **Impact:** The system cannot honor “Toman amount is fixed” in any path.

---

## 4. Currency / FX Findings

### Finding 4.1 — Rate sources exist but are layered, with a stale legacy key
- **Status:** PARTIAL (Low)
- **Evidence:** `src/lib/fx.ts` priority: `user_fx_settings → exchange_rates → settings.irt_rate → 190000`; `src/features/fx/userRate.ts` (24h update throttle); `src/features/fx/rates.ts` (`recordFxRate`, `getLatestFxRate`).
- **Current Behavior:** Multiple rate stores; only `user_fx_settings` is user-editable through `FxSettings`. `exchange_rates` is only written by vehicle demo data in practice.
- **Expected Behavior:** One canonical per-user rate with a clear historical table.
- **Impact:** Low (works, but confusing).
- **Severity:** Low

### Finding 4.2 — Two inconsistent USD↔IRT conversions (ledger quantity vs display rate)
- **Status:** FAIL (Critical)
- **Evidence:** Display/valuation uses `getLatestUsdIrtRateForUser` (`src/lib/fx.ts`). Ledger *native quantity* for IRT accounts uses `latestPrice(assetId)` → `prices` table (`src/app/actions.ts` `latestPrice`, `src/features/ledger/service.ts` `unitsFor`). Seed sets `prices.IRT = 0.00001` (= 100,000 Toman/USD, `src/db/seed.ts:201`) while `settings.irt_rate = 190000` and `user_fx_settings.currentRate` default 190,000. `updateUserFxRate` never touches `prices`.
- **Current Behavior:** A 909,090 Toman expense is booked as `usdAmount = 909090 / rate`. The bank (IRT) account quantity is then reduced by `usdAmount / 0.00001` (seed) or `/ 1` (per-user setup, no IRT price row) — **not** 909,090. The two conversion paths disagree whenever `rate ≠ 100000`.
- **Expected Behavior:** IRT account quantity must equal the Toman amount (1 unit = 1 Toman), i.e. quantity conversion must use `1 / rate`, consistently with the setup/account-registration path (`bookUsdFromAccountNative`, `src/features/setup/service.ts`).
- **Impact:** Bank/cash balances in Toman are silently wrong; `formatMoney` may show a wrong Toman figure; double-entry remains balanced in USD so the error is invisible to the integrity check.
- **Severity:** Critical

### Finding 4.3 — FX rate changes do not touch historical entries (good)
- **Status:** PASS
- **Evidence:** `entry_fx_snapshots` frozen at commit; `journal_entries`/`postings`/`lot_consumptions` are insert-only; `vehicle_valuation_snapshots` and real-estate purchase/valuation FX fields are frozen at insert (`src/db/schema.ts`).
- **Impact:** Historical transactions are correctly immutable.
- **Severity:** — (PASS)

### Finding 4.4 — No “Contractual Amount vs Market Value” distinction in the currency engine
- **Status:** MISSING (High)
- **Evidence:** `src/features/fx/*` and `src/lib/fx.ts` expose only generic conversions; there is no type/flag separating contractual (debt) amounts from market-valued amounts.
- **Impact:** The debt logic cannot be corrected without adding this distinction.
- **Severity:** High

---

## 5. Realized P&L Findings

### Finding 5.1 — Realized P&L is frozen and historical
- **Status:** PASS
- **Evidence:** `recordSell` → `consumeFifo` (`src/domain/fifo.ts`) computes `costBase`/`proceedsBase`/`realizedPnl`, persisted in `lot_consumptions` (immutable) and posted to account `4100` in the immutable journal. Sale IRT/USD/rate frozen in `entry_fx_snapshots` (form path).
- **Current Behavior:** Sale proceeds, cost basis, realized P&L, Toman and USD at trade time do not change when FX moves later.
- **Expected Behavior:** Matches requirement.
- **Impact:** Correct.
- **Severity:** — (PASS)

### Finding 5.2 — FIFO cost basis is global per asset, not per source account
- **Status:** FAIL (High)
- **Evidence:** `postEntry` closeLot path and `recordSell` select open lots by `eq(lots.assetId, …)` + user only (`src/features/ledger/service.ts`); `lots.accountId` is populated on buy but **ignored** during consumption.
- **Current Behavior:** Selling “0.6 ETH from Wallet A” consumes the oldest ETH lots across **all** accounts holding ETH, mis-attributing cost basis when the same asset lives in several places.
- **Expected Behavior:** FIFO consumption scoped to the source account (or explicit lot selection).
- **Impact:** Realized P&L is wrong for multi-location holdings even though it is “frozen”.
- **Severity:** High

---

## 6. Unrealized P&L Findings

### Finding 6.1 — Unrealized P&L is dynamic and never posted
- **Status:** PASS
- **Evidence:** `calculateMarketValuation` (`src/features/valuation/service.ts`), `calculateUnrealizedPnl` (`src/features/portfolio/valuation.ts`); valuation reads CoinGecko price + current FX each request. No ledger write.
- **Current Behavior:** USD value, Toman value, and unrealized P&L all move with price and FX until sale.
- **Expected Behavior:** Matches requirement.
- **Impact:** Correct.
- **Severity:** — (PASS)

### Finding 6.2 — Cost-basis Toman for unrealized P&L
- **Status:** PARTIAL (Medium)
- **Evidence:** `historicalTomanCostByAsset` joins `lots × entry_fx_snapshots` (`src/features/portfolio/service.ts`). For assets bought before `entry_fx_snapshots` existed (or bought via seed), historical Toman cost falls back to `unrealizedPnlUsd × currentRate`.
- **Impact:** Toman unrealized P&L may mix historical cost with current rate for legacy lots.
- **Severity:** Medium

---

## 7. Net Worth Findings

### Finding 7.1 — Assets are market-valued; FX moves their Toman value
- **Status:** PASS
- **Evidence:** `getPortfolioValuation` values crypto/stable via CoinGecko, USD face value 1, IRT face value, real assets via manual valuation rows; `currentValueToman = currentValue × fx.rate` (dynamic).
- **Expected Behavior:** Matches requirement for market-valued assets.
- **Severity:** — (PASS)

### Finding 7.2 — Liabilities in Net Worth are ledger USD; Toman is re-derived at current rate
- **Status:** FAIL (High)
- **Evidence:** `getCurrentNetWorth` (`src/features/portfolio/service.ts`): `liabilities = Σ ledger baseValue (USD, historical)`; `liabilitiesToman = liabilities × currentFxRate`.
- **Current Behavior:** The debt’s USD is frozen at posting-time; the displayed Toman liability **changes with FX** — the inverse of the required “Toman fixed, USD dynamic”.
- **Expected Behavior:** Debt Toman fixed; USD equivalent (in net worth) dynamic.
- **Impact:** Net worth Toman figure for debt is wrong as rates move.
- **Severity:** High

### Finding 7.3 — Market-valued class set
- **Status:** PARTIAL (Low)
- **Evidence:** `MARKET_CLASS_CODES = {crypto, stable, stock, security}` (`src/features/portfolio/service.ts`). Gold (XAUT) is priced via CoinGecko (class `crypto` in practice; `gold` class seed asset `GOLD18` is manual). Real estate/vehicle have their own frozen valuation modules.
- **Impact:** Gold/XAUT works because XAUT is registered under the crypto class; physical `GOLD18` is manual-only. Acceptable but worth noting.
- **Severity:** Low

---

## 8. Sell Asset Findings

### Finding 8.1 — A sell flow exists but is not the full “sell-from-source” scenario
- **Status:** PARTIAL (High)
- **Evidence:** `TransactionForm` type `sell`; `createTransactionAction` sell branch; `recordSell` (`src/features/ledger/service.ts`).
- **Current Behavior:** User can pick the asset (CoinGecko catalog → account), enter quantity and a Toman amount, and choose a destination (counter) account. But: no per-source balance display, no wallet/source picker for crypto, no received-asset semantics, no trade price field.
- **Expected Behavior:** Explicit source (account/wallet) + sellable balance + destination + received amount + price + preview.
- **Impact:** Cannot reliably execute the “sell ETH from Wallet A to pay an installment” scenario with correct balances and cost basis.
- **Severity:** High

### Finding 8.2 — Sell proceeds use the *counter account’s* asset as the “cash” leg
- **Status:** PARTIAL (Medium)
- **Evidence:** `createTransactionAction` sell branch: `cashAssetId = accountAsset(counterAccountId)`, `cashQuantity = amount / latestPrice(cashAssetId)`, then `recordSell`. P&L leg (`4100`) is denominated in the counter asset’s units (`assetId: cmd.cashAssetId`).
- **Current Behavior:** Selling ETH “to USDT” works mechanically (destination USDT account), but the realized-P&L posting is denominated in the destination asset rather than base USD, and the cost basis still comes from global FIFO.
- **Expected Behavior:** A clear asset→asset model with base-currency P&L and explicit legs.
- **Impact:** Realized P&L presentation and multi-leg correctness are fragile.
- **Severity:** Medium

### Finding 8.3 — No per-account overdraft guard on sale
- **Status:** FAIL (High)
- **Evidence:** `createTransactionAction` does not pass `preventOverdraft`; `recordSell` relies only on the **global** FIFO `unmatchedQty` check (`src/features/ledger/service.ts`).
- **Current Behavior:** You can sell 0.6 ETH “from Wallet A” even if Wallet A holds 0.1 ETH, as long as total ETH across all accounts ≥ 0.6; Wallet A’s posting goes negative.
- **Expected Behavior:** Per-source balance must be enforced; overselling a source must be blocked.
- **Impact:** Negative balances per account; misleading custody view.
- **Severity:** High

---

## 9. Crypto → Toman Findings

### Finding 9.1 — Crypto → Toman sale
- **Status:** PARTIAL (Medium)
- **Evidence:** Sell with destination = an IRT account (`recordSell` credits the IRT account; `entry_fx_snapshots` freezes Toman/USD/rate).
- **Current Behavior:** Asset decreases, Toman/IRT destination credited, USD equivalent shown, realized P&L recorded. But source-location granularity, sellable-balance display, and trade price are missing (§8).
- **Expected Behavior:** Full Mode A semantics with explicit source and balance.
- **Impact:** Functionally usable, semantically incomplete.
- **Severity:** Medium

---

## 10. Crypto → USDT Findings

### Finding 10.1 — Crypto → USDT is expressed as a generic “sell” with a USDT destination
- **Status:** PARTIAL (Medium)
- **Evidence:** Sell with destination = a USDT account. There is **no dedicated swap type**; `recordSell` treats the destination as “cash”.
- **Current Behavior:** ETH decreases, USDT destination credited (quantity = `amount / latestPrice(USDT)` ≈ USD). Source/destination accounts are recorded as postings. Trade price is **not stored** as a field; fee recorded on `5040`; realized P&L via global FIFO.
- **Expected Behavior:** Mode B semantics with explicit source asset+account, destination asset+account, trade price, received amount, fee, realized P&L, frozen snapshot.
- **Impact:** The transaction type cannot distinguish “sold for stablecoin” from “sold for fiat” for reporting.
- **Severity:** Medium

### Finding 10.2 — USDC vs USDT (verified from code, not assumed)
- **Status:** PASS (with caveat)
- **Evidence:** `SUPPORTED_CRYPTO_ASSETS` (`src/features/pricing/supportedAssets.ts`) includes **USDT** (`tether`) **and USDC** (`usd-coin`) plus USDS/USDG/USDE. Money-account creation is restricted to `IRT | USD | USDT` (`MONEY_ACCOUNT_CURRENCY_SYMBOLS`, `src/features/accounts/service.ts`), but any allowlisted crypto (including USDC/XAUT/PAXG) can be registered as a market asset account via `registerMarketAssetAction` and then used as the destination account of a sale.
- **Current Behavior:** Destination can be **USDT or USDC** (or any registered crypto) — not USDT-only. There is no semantic distinction between them.
- **Impact:** No bug per se, but the product does not enforce the “USDT” assumption some requirements make.
- **Severity:** Low

---

## 11. Source / Wallet / Account Findings

### Finding 11.1 — Asset balance is per account, but crypto has one account per asset
- **Status:** PARTIAL (High)
- **Evidence:** Postings are per `accounts.id`; `getAccountBalances` returns per-account rows. `registerMarketAssetAction` returns the **first existing** account for `(asset, user)` or creates **one** (no `walletId`). `registerMoneyAccount` creates wallet-linked accounts only for IRT/USD/USDT.
- **Current Behavior:** ETH held in “Wallet A” and “Exchange” **cannot** be modeled as two accounts; there is a single ETH account.
- **Expected Behavior:** Per-wallet/per-location accounts for every asset class.
- **Impact:** Blocks the entire “which source?” requirement for crypto.
- **Severity:** High

### Finding 11.2 — Sale is not connected to a per-source FIFO
- **Status:** FAIL (High)
- **Evidence:** §5.2 — FIFO consumes lots by asset globally, ignoring `lots.accountId`.
- **Impact:** Cost basis and realized P&L wrong for multi-location holdings.
- **Severity:** High

### Finding 11.3 — Sellable balance of a source is not displayed
- **Status:** MISSING (Medium)
- **Evidence:** `TransactionForm` has no balance/preview of the selected account or asset; `primaryOptions` is a plain account `<select>`.
- **Expected Behavior:** Show available quantity per selected source before/at selection.
- **Impact:** Users cannot see how much is sellable; combined with §8.3 they can oversell a source.
- **Severity:** Medium

### Finding 11.4 — Selling from multiple sources
- **Status:** MISSING (Low)
- **Evidence:** `recordSell` accepts one `assetAccountId` and one quantity.
- **Impact:** Split-source sales unsupported.
- **Severity:** Low

---

## 12. Database / Data Model Findings (checklist)

| Required field | Present? | Actual implementation |
|---|---|---|
| source_asset | PARTIAL | `postings.assetId` on the debit leg (no explicit column) |
| source_amount | PARTIAL | `postings.quantity` on the debit leg |
| source_account / wallet | PARTIAL | `postings.accountId`; `accounts.walletId` only for money accounts |
| destination_asset | PARTIAL | `postings.assetId` on the credit leg |
| destination_amount | PARTIAL | `postings.quantity` on the credit leg |
| destination_account / wallet | PARTIAL | `postings.accountId`; wallet only for money accounts |
| price | MISSING | no per-transaction price; `prices` table is asset-level market price |
| exchange rate | PARTIAL | `entry_fx_snapshots.fxRate` (form path only) |
| fee | PARTIAL | postings to account `5040` (no dedicated column) |
| fee asset | PARTIAL | fee posting `assetId` |
| Toman amount | PARTIAL | `entry_fx_snapshots.irtAmount` (form path only) |
| USD equivalent | PASS | `postings.base_value` (USD functional currency) + `entry_fx_snapshots.usdAmount` |
| transaction date | PASS | `journal_entries.entryDate` |
| realized P&L | PASS | `lot_consumptions.realizedPnl` |
| cost basis | PASS | `lot_consumptions.costBase`, `lots.unitCostBase` |
| status | PASS | `journal_entries.status` (posted/void), `installments.status`, `debts.status` |
| historical snapshot | PARTIAL | `entry_fx_snapshots` + immutable ledger; debt creation has no snapshot |

**Conclusion:** The ledger double-entry model is sound and covers most fields indirectly through postings. What is missing as *first-class* concepts: **trade price**, **source/destination wallet granularity for crypto**, **fee/fee-asset columns**, and **debt Toman amount + creation-time FX snapshot**.

---

## 13. UI Findings

| Question | Answer | Evidence |
|---|---|---|
| Is there a Sell button? | PARTIAL — a “فروش دارایی” tab inside the transaction form; no standalone Sell button on asset/crypto pages | `TransactionForm.tsx` `TYPES` |
| Can an asset be selected in Sell? | YES (via CoinGecko catalog → account) | `selectCatalogAsset` |
| Is sellable balance shown? | NO | no balance in form |
| Is Source/Wallet/Account selectable? | PARTIAL — account only; no wallet; crypto has one account | `primaryOptions` |
| Is sellable amount shown? | NO | — |
| Sell to Toman? | YES (destination IRT account) | sell branch |
| Sell to USDT? | YES (destination USDT account, if it exists) | counter account dropdown |
| Sell to USDC? | YES (destination USDC account, if registered) | counter account dropdown + allowlist |
| Is destination selectable? | YES | `counterAccountId` select |
| Preview before commit? | YES | `PreviewCard` |
| Does the user understand what is sold from which account? | PARTIAL — account names shown, but no balances/locations | form/preview |
| Simple or complex for a casual user? | Moderately complex (type tabs, Toman amount, quantity, catalog search, accounts, date, fee, description, category) | full form |

---

## 14. Critical Bugs

1. **Debt/installment Toman is not persisted; USD is the stored amount; Toman is re-derived at current rate** → unpaid obligations change value with FX (§3.1–3.2). **Critical.**
2. **Two disconnected IRT conversions** (`user_fx_settings`/display vs `prices` for ledger quantity) → native Toman balances in bank/cash accounts are wrong (§4.2). **Critical.**
3. **FIFO lot consumption ignores the source account** → realized P&L mis-attributed for multi-location holdings (§5.2, §11.2). **High.**
4. **No per-source overdraft guard on sell** → an individual account can go negative (§8.3). **High.**
5. **Quick-pay installment path records no FX snapshot** → inconsistent historical immutability (§3.5). **High.**

---

## 15. Missing Features

1. **Contractual/Fixed Toman amount** storage for debts, installments, liabilities, payables, with creation-time FX snapshot.
2. **Distinct Creditor / Payee / Payment-method / Payment-destination** entities (and account linkage).
3. **Per-wallet/per-location asset accounts for crypto** (and other assets), enabling “sell from Wallet A”.
4. **Source-scoped FIFO** (or lot selection) on sale.
5. **Sellable-balance preview** and per-source oversell prevention.
6. **Distinct transaction types** for: Crypto→Toman, Crypto→USDT/USDC, Crypto→Crypto swap, in-wallet swap, sale-with-proceeds (currently all collapse into `sell`).
7. **Per-transaction trade price** field.
8. **Dedicated fee / fee-asset columns** (currently reconstructed from `5040` postings).
9. **Uniform FX snapshot** across all write paths (debt creation, quick-pay, buy/sell/transfer).
10. **Net-worth liability Toman semantics** (fixed Toman, dynamic USD).

---

## 16. Risks / Edge Cases

- **FX-rate drift between two rate systems:** balances in Toman are wrong but the ledger still sums to zero in USD, so the integrity check (`integrityCheckAction`) cannot detect it. Silent corruption risk.
- **Multi-account same-asset:** currently impossible for crypto, so risk is latent; once multiple locations are allowed, the global-FIFO bug (§5.2) will surface.
- **Rate changed between debt creation and payment:** user pays a different Toman amount than contracted (silent over/under-payment).
- **Legacy data:** seed debt principal `8000` USD assumed rate 100,000; `settings.irt_rate` 190,000; per-user `user_fx_settings` default 190,000 — pre-existing data is internally inconsistent with the display rate.
- **Planning-only debts:** no liability in net worth until a repayment is booked; `payInstallment` (“پرداخت سریع”) throws for these debts, forcing the form path.
- **Rounding:** debt creation rounds `principalBase`/`installmentBase` to full USD division; Toman reconciliation is impossible because the Toman source is lost.
- **USDC/USDT assumption:** any allowlisted crypto can be a sale destination; nothing enforces “stablecoin-only” destinations.

---

## 17. Recommended Architecture (report only — no changes made)

1. **Add a “Contractual Amount” layer for liabilities:** store `amount_toman` (and optional `amount_usd` at creation) on `debts` and `installments`; derive `usd_equivalent = amount_toman / current_rate` dynamically until paid; freeze `entry_fx_snapshots` at creation **and** payment.
2. **Unify the FX engine:** one canonical per-user USD→IRT rate used by *both* display/valuation and ledger native-quantity conversion (or persist IRT price = `1/rate` in `prices` on every rate update). Eliminate the `prices.IRT` divergence.
3. **Introduce counterparty/payee/payment-method entities** distinct from the double-entry CoA accounts; `debts.creditor` should reference a counterparty; add `payment_method`/`payment_destination` fields.
4. **Per-location asset accounts:** allow multiple accounts per (asset, user, wallet); migrate crypto registration to create wallet-linked accounts.
5. **Source-scoped FIFO:** consume lots filtered by the source account (or explicit lot selection).
6. **Per-source balance + overdraft guard** on the sale path (`preventOverdraft` per account, or source balance validation).
7. **Transaction-type taxonomy:** `sell_to_fiat`, `sell_to_stable`, `swap` (asset↔asset), `transfer` (same-asset), `fx` (cash conversion), each with explicit source/destination/price/fee legs and a frozen snapshot.
8. **Net-worth liability valuation:** compute Toman from the stored contractual Toman; USD equivalent from the current rate (dynamic), the inverse of today’s logic.
9. **Add per-transaction `trade_price` and `fee`/`fee_asset`** columns or a structured `trade` table to make reporting first-class instead of reconstructing from postings.

---

## 18. Files That Would Need Modification — REPORT ONLY

*(Not modified. Listed as the likely surface area for the fixes above.)*

- `src/db/schema.ts` — `debts`, `installments`, `accounts`, `wallets`, `lots`/`lot_consumptions`, `entry_fx_snapshots`, new counterparty/payment-method/trade tables, `prices` IRT handling.
- `src/app/actions.ts` — `createDebtAction`, `createTransactionAction` (sell/debt_repayment/transfer branches), `payInstallmentAction`, `latestPrice`.
- `src/features/planning/service.ts` — `listDebts`, `payInstallment`, outstanding derivation.
- `src/features/ledger/service.ts` — `recordSell`, `postEntry` closeLot path (source-scoped FIFO), `unitsFor`, `resolveFxBookLegs`.
- `src/features/accounts/service.ts` + `src/app/actions/pricing.ts` — per-wallet crypto accounts.
- `src/features/portfolio/service.ts` — `getCurrentNetWorth` liability Toman semantics, `historicalTomanCostByAsset`.
- `src/features/fx/*` + `src/lib/fx.ts` + `src/features/fx/userRate.ts` — canonical rate engine + `prices` sync.
- `src/components/forms/TransactionForm.tsx`, `DebtForm.tsx`, `DebtInstallmentExplorer.tsx` — source/wallet selection, sellable-balance preview, received-asset selection, price.
- `src/components/transactions/TransactionsView.tsx`, `src/app/debts/*`, `src/app/installments/page.tsx`, `src/app/net-worth/page.tsx`, `src/app/crypto/page.tsx` — Toman-primary debt display, custody, sell affordances.
- `src/db/seed.ts` + `src/features/setup/service.ts` — reconcile IRT price vs rate; migration/seed for contractual Toman amounts.

---

## 19. Final Status Table

| Area | Current Status | Expected | Severity |
|------|----------------|----------|----------|
| Debt principal stored in Toman | FAIL | Toman stored as authoritative | Critical |
| Debt Toman stable under FX change | FAIL | Toman fixed, USD dynamic | Critical |
| USD equivalent dynamic for unpaid debt | FAIL | Dynamic until payment | Critical |
| FX snapshot at debt creation | MISSING | Frozen at creation | High |
| FX snapshot at payment | PARTIAL | Frozen on every payment path | High |
| Creditor / Payee / Payment-method separation | MISSING | Distinct entities | High |
| Double-entry ledger (genuine) | PASS | Genuine double-entry | — |
| Currency/FX rate engine | PARTIAL | One canonical rate | High (divergence) |
| USD-equivalent computation | PARTIAL | Consistent single source | Medium |
| Net worth (assets market-valued, FX-sensitive) | PASS | Dynamic asset value | — |
| Net worth (liabilities Toman semantics) | FAIL | Toman fixed, USD dynamic | High |
| Realized P&L frozen & immutable | PASS | Frozen | — |
| Realized P&L source-scoped FIFO | FAIL | Source-scoped | High |
| Unrealized P&L dynamic | PASS | Dynamic | — |
| Sell asset (full scenario) | PARTIAL | Full source/dest/price/balance | High |
| Crypto → Toman | PARTIAL | Mode A with source+balance | Medium |
| Crypto → USDT | PARTIAL | Mode B explicit swap | Medium |
| Crypto → USDC | PARTIAL | Supported as generic destination | Low |
| Source / holding location per crypto | MISSING | Per-wallet accounts | High |
| Sellable balance display | MISSING | Show per source | Medium |
| Overselling prevention per source | FAIL | Blocked per source | High |
| Asset→asset swap vs sale distinction | MISSING | Distinct types | High |
| Trade price per transaction | MISSING | Stored field | Medium |
| Historical snapshot (transactions) | PARTIAL | Uniform across paths | High |

---

*End of audit. No code, schema, database, UI, or package files were modified during this review.*
