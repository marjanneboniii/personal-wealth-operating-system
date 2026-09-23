# Audit: Per-Account Accounting Currency

**Status:** Read-only. No code, schema, migration, or data was changed.  
**Date:** 2026-08-18  
**Scope:** Chart of Accounts, General Ledger, Double-Entry, FIFO, FX, reports, historical records.

---

## 1. Executive Summary

**Verdict: HIGH RISK — DO NOT IMPLEMENT as a replacement of the current single functional / base currency.**

**Safer interpretation: SAFE WITH REQUIRED CHANGES** if “Accounting Currency per account” is implemented as **account denomination / presentation currency** (already partly present via `accounts.assetId`) while the **ledger functional currency (`postings.base_value`) stays one global currency (USD today).**

| Interpretation | Verdict |
|---|---|
| Each account keeps its own **native cash/asset units** (IRT bank vs USD cash) | **Already implemented** via `accounts.assetId` + `postings.quantity` |
| Each account uses a **different functional/ledger currency** and `assertBalanced` / balances / P&amp;L mix those amounts | **DO NOT IMPLEMENT YET** — would break double-entry, trial balance, FIFO cost, and all reports |
| Add `accounts.accountingCurrencyId` as **metadata + conversion context**, keep `base_value` in one book currency | **SAFE WITH REQUIRED CHANGES** (schema + FX journal path + transfer rules) |

The core is a **dual-measure ledger**:

- `postings.quantity` = units of `postings.asset_id` (IRT, USD, BTC, …)
- `postings.base_value` = **one** functional currency (convention: USD)

`assertBalanced` only sums `baseValue`. There is **no** per-account ledger currency today.

---

## 2. Architecture Findings

### 2.1 Chart of Accounts

Implemented in `src/db/schema.ts` → `accounts`:

- `code`, `name`, `type` (`asset | liability | equity | income | expense`)
- `parentId` (hierarchy, no DB FK)
- `assetId` → denomination / instrument of the account
- `walletId` → bank / cash / exchange container
- **No `currencyId` / `accountingCurrencyId` on accounts**

Money accounts (`src/features/accounts/service.ts`) already pick **IRT | USD | USDT** as `assetId`. Opening IRT balances are converted to USD `baseValue` via `getLatestUsdIrtRateForUser`.

Seed CoA (`src/db/seed.ts`): IRT bank/cash accounts, USDT wallets, USD-denominated P&amp;L/equity (codes 3010, 4xxx, 5xxx).

### 2.2 Ledger graph

```
users
  └─ journal_entries (header: date, type, status, categoryId)
        └─ postings (accountId, assetId, quantity, baseValue)
              └─ accounts.assetId / wallets
lots (openEntryId, unitCostBase) → lot_consumptions (costBase, proceedsBase, realizedPnl)
entry_fx_snapshots (presentation IRT/USD freeze — not used in assertBalanced)
```

Single write path: `postEntry` in `src/features/ledger/service.ts`.  
High-level: `recordTransfer`, `recordBuy`, `recordSell`, `recordIncome`, `recordExpense`.

### 2.3 Where currency lives today

| Layer | What exists |
|---|---|
| System settings | `settings.base_currency` (typically `"USD"`) |
| Setup wizard | `completeSetup` `baseCurrency` → settings + cash asset |
| User FX | `user_fx_settings.currentRate` (IRT per 1 USD) |
| Account | `accounts.assetId` = native instrument, **not** functional currency |
| Posting | `assetId` + `quantity` (native) + `baseValue` (functional USD) |
| Journal | **No** rate, **no** currency, **no** FX gain/loss fields |
| FIFO lots | `unitCostBase` / `costBase` / `proceedsBase` / `realizedPnl` in **base USD** |
| Prices | `prices.price_base` in functional USD |
| Snapshots | `snapshots.base_currency` default `"USD"` |
| FX engine | Display-only (`src/features/fx/*`, `src/lib/fx.ts`) — **must not** post ledger |

### 2.4 Hidden “one currency” assumptions

- `assertBalanced` (`src/domain/accounting.ts`): `Decimal.sum(postings.map(p => p.baseValue)) === 0`
- Overdraft (`postEntry`): `sum(postings.base_value)` per account — mixes meaning if bases differ
- `getAccountBalances` / `getCashflow` / `getNetWorth` / `getRealizedPnl`: aggregate `base_value` / `realized_pnl` with **no currency group-by**
- `recordTransfer`: **one** `assetId` on both legs — **cannot** post Bank IRT → Cash USD
- Entry type `"fx"` exists in `EntryType` / UI filters; **no `recordFx` / conversion journal**
- Portfolio / valuation: `baseCurrencyCode: "USD"` hardcoded (`src/features/portfolio/types.ts`)
- RWA / vehicles: dual Toman + frozen USD, **outside** GL functional currency

---

## 3. Critical Risks

1. **Broken double-entry** if debit IRT and credit USD are both stored in `base_value` without conversion. `assertBalanced` would accept `100 IRT + (−100) USD = 0` as balanced.
2. **Trial balance / P&amp;L / cash flow / net worth** would mix incommensurable units.
3. **FIFO `unitCostBase`** is USD. Reinterpreting it as IRT (or vice versa) **corrupts cost basis and realized P&amp;L**.
4. **`recordTransfer` same-asset model** cannot express cross-currency cash moves; naive reuse would credit USD quantity into an IRT account (or the reverse).
5. **No realized FX gain/loss account** in posting logic (only unused type `"fx"`).
6. **Overdraft** on mixed `base_value` is meaningless.
7. **Equity 3010** is provisioned against USD/IRT `findBaseAssetId` — opening IRT vs USD already uses USD `baseValue` but equity quantity is not native-account-aware.
8. **Historical `entry_fx_snapshots` / lots / postings** must stay immutable; rewriting `base_value` is forbidden by design.

---

## 4. Required Changes (before any implementation)

Do **not** start with a CoA column alone. Required design first:

1. **Name two concepts explicitly**
   - **Account currency / denomination** = `accounts.assetId` (already exists)
   - **Book / functional currency** = `postings.base_value` (must remain **one** per tenant, or one per books entity)

2. If product needs “this cash account thinks in IRT”:
   - Treat as **denomination**, not a second functional currency
   - Keep converting to USD (or tenant `settings.base_currency`) at **post time**
   - Persist rate on the journal (`entry_fx_snapshots` already does presentation freeze)

3. If product needs **true multi-currency books** (IAS 21 style):
   - Add posting fields: `functional_amount`, `account_currency_amount`, `fx_rate`, `rate_date`
   - Change `assertBalanced` to balance **per functional currency** (still one functional currency per books)
   - Add `recordFxConversion` (debit dest native, credit source native, both `base_value` in functional; optional FX P&amp;L)
   - Do **not** change FIFO formulas; only the currency of `*Base` fields (still one)

4. **Never** backfill or recompute historical `base_value`, lots, or consumptions.

5. Transfers: reject or route through FX when `from.assetId ≠ to.assetId`.

---

## 5. Backward Compatibility

| Data | If only add nullable `accounts.accounting_currency_id` defaulting to tenant USD | If change meaning of `base_value` |
|---|---|---|
| Historical journals / postings | Unchanged (immutable) | **Broken** |
| FIFO lots / consumptions | Unchanged | **Broken** |
| Opening balances | Unchanged | Must not revalue |
| Snapshots | Stay USD | Misleading if reports switch |
| Money accounts IRT/USD/USDT | Compatible | — |

A **nullable column + default** is backward compatible **only if unused by `assertBalanced` and FIFO**.  
Any migration that converts existing `base_value` is **not** compatible with the immutability rule.

---

## 6. FIFO Impact

**FIFO is independent of account denomination and of a future `accounts.accountingCurrency` column — as long as `*Base` remains the single functional currency.**

Evidence (`src/domain/fifo.ts`, `postEntry` / `recordBuy` / `recordSell`):

- Lots keyed by `userId + assetId` (instrument), not by account currency
- `unitCostBase = costBase / qty` in **USD book amounts**
- Consume order = `opened_at` then id
- Realized P&amp;L = proceedsBase − costBase (both USD)
- Monetary IRT/USD/USDT openings **do not** open FIFO lots (`registerMoneyAccount` comment)

**What would break FIFO**

- Storing IRT cost in `unitCostBase` for some lots and USD for others
- Matching lots across different book currencies
- Repricing historical lots when an account’s “accounting currency” is edited

**Buy IRT / sell USD:** already possible at **instrument** level (buy BTC paying IRT cash): both legs carry USD `baseValue`; FIFO cost stays USD. Selling for a different **cash** asset does not change lot currency.

**Conclusion:** Do not touch `consumeFifo`, `lots`, or `lot_consumptions` for this feature.

---

## 7. Ledger Impact

### Debit / Credit

There is no separate debit/credit column. Sign is in `quantity` and `baseValue`. Natural presentation: `naturalSign(account.type)`.

Balance invariant = **sum of `baseValue` = 0**, not sum of native quantities.

### Cross-currency example: Bank IRT → Cash USD

**Today:** `recordTransfer` posts the **same** `assetId` on both sides. This transfer **cannot** be recorded correctly. Type `"fx"` is unused.

**Correct future journal (functional USD):**

| Account | Asset (native) | Quantity | baseValue (USD) |
|---|---|---|---|
| Bank IRT | IRT | −19,000,000 | −100 |
| Cash USD | USD | +100 | +100 |

Rate 190,000 IRT/USD stored on `entry_fx_snapshots` (or new journal FX fields). No FIFO. If the booked USD differs from cash received, an FX gain/loss posting is required — **not implemented**.

### Balances

`getAccountBalances` returns both `quantity` (native) and `baseValue` (USD). Per-account native currency **already works** for display. Aggregating `baseValue` across accounts is valid **only** while `baseValue` is one currency.

---

## 8. Database Impact

| Table | Needed for metadata-only? | Needed for true multi-currency GL? |
|---|---|---|
| `accounts` | Optional `accounting_currency_id` FK → `currencies` (nullable, default tenant base) | Same + constraint vs `assetId` |
| `postings` | No | `fx_rate`, maybe `account_amount` if split from `quantity` |
| `journal_entries` | No | `fx_rate`, `rate_source`, `rate_date` (or keep `entry_fx_snapshots`) |
| `lots` / `lot_consumptions` | **No change** | **No change** if functional currency unchanged |
| `settings.base_currency` | Remains tenant functional currency | Must not be per-account |
| `wallets` | No | No |
| `exchange_rates` / `user_fx_settings` | Already exist | Use at post time; do not rewrite history |

**Recommended migration (later, after design sign-off):** add nullable `accounts.accounting_currency_id`; backfill from `assets.currency_id` of `accounts.asset_id` or tenant USD; **no** rewrite of postings/lots.

---

## 9. Test Requirements (must exist before implementation)

Existing coverage (do not weaken): `security-accounting-invariant`, `fifo-reversal`, `stage5` FIFO + historical FX freeze, `money-account-registration`, `setup-wizard`.

New / required scenarios:

| # | Scenario | Expected today | Expected after safe design |
|---|---|---|---|
| 1 | Bank IRT → Bank IRT | `recordTransfer` same asset | Unchanged |
| 2 | Cash USD → Cash USD | Same | Unchanged |
| 3 | Bank IRT → Cash USD | **Unsupported / wrong if forced** | FX journal; both `base_value` USD; rate frozen |
| 4 | Cash USD → Bank IRT | Same | Same as 3 inverse |
| 5 | Buy asset with IRT | `recordBuy` + USD `baseValue` + FIFO USD | Unchanged FIFO |
| 6 | Buy asset with USD | Same | Unchanged |
| 7 | Sell asset for other cash currency | FIFO still USD; cash `assetId` can differ | Unchanged FIFO |
| 8 | Change exchange rate after post | `entry_fx_snapshots` / lots frozen | Must stay frozen |
| 9 | Multi-lot FIFO + partial lot | Stage 5 | No change |
| 10 | Historical transactions | Immutable | No rewrite |
| 11 | Opening balance IRT vs USD | Converted to USD `baseValue` | Same |
| 12 | Trial balance after 3+4 | N/A | `sum(base_value)=0`; native qtys not netted |

Also: report tests that **fail** if someone sums native IRT + USD quantities.

---

## 10. Hidden assumptions (file / function / risk)

| Location | Symbol | Risk |
|---|---|---|
| `src/domain/accounting.ts` `assertBalanced` | Sum `baseValue` only | Mixed currencies look balanced |
| `src/features/ledger/service.ts` `postEntry` overdraft | `sum(base_value)` | Wrong overdraft |
| `src/features/ledger/service.ts` `recordTransfer` | Single `assetId` | Cross-currency transfer corrupt |
| `src/features/ledger/service.ts` `recordBuy`/`recordSell` | `baseValue` = cost/proceeds | OK if still USD |
| `src/domain/fifo.ts` `consumeFifo` | `unitCostBase` unitless | Mixed book currencies destroy P&amp;L |
| `src/features/ledger/queries.ts` all aggregations | No currency dimension | Mixed reports |
| `src/features/accounts/service.ts` | IRT → USD at open | Correct for current model |
| `src/db/schema.ts` `snapshots.baseCurrency` | default `"USD"` | Reports assume USD |
| `src/db/schema.ts` `accounts` | No currency column | New field is additive only |
| `src/features/portfolio/types.ts` | `baseCurrencyCode: "USD"` | Hardcoded book currency |
| `src/lib/fx.ts` / `src/features/fx/convert.ts` | Display FX | Must stay off ledger writes |
| `src/features/setup/service.ts` | Tenant `baseCurrency` | One books currency per setup |
| Seed / tests | IRT qty + USD `baseValue` | Documents intended model |

---

## Implementation Readiness Report

**Can we safely add Accounting Currency on each account right now?**

- **As the functional/ledger currency of that account, replacing or mixing `base_value`:** **No.** Fix / extend the accounting core first (`assertBalanced`, transfer/FX journal, report aggregations). **Do not change FIFO core** if the book currency stays USD.
- **As an explicit label of the account’s native/reporting currency, defaulted from `assetId` / tenant base, unused by FIFO and `assertBalanced`:** **Yes, later**, after tests above and a written rule: *books remain single-currency; account currency is denomination + UI.*

**Layers that would change in a safe add-on (not now):**

- Schema: optional `accounts.accounting_currency_id`
- Account registration / CoA UI
- Transfer validation (`from.assetId === to.assetId` or force FX path)
- New `recordFx` (new code, not a FIFO change)
- Reports: show native qty + convert with frozen or current FX for display only

**Layers that must not change for this feature:**

- `consumeFifo`, `lots`, `lot_consumptions`
- Historical `postings.base_value`
- Meaning of `assertBalanced` (still one functional currency)

**Bottom line:** The system is **already multi-denomination** (IRT bank + USD cash) and **single-currency books** (USD `base_value`). Treating “Accounting Currency per account” as a second books currency **will damage GL, balances, and FIFO**. Treat it as denomination + FX journals, or redesign a full multi-currency engine **without** mutating history.
