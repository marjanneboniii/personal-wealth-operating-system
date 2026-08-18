# Design Proposal: Account Denomination + FX Accounting

**Status:** Design only. No implementation, schema change, or migration in this phase.  
**Date:** 2026-08-18  
**Depends on:** `docs/AUDIT-PER-ACCOUNT-ACCOUNTING-CURRENCY.md`

This document is the architectural contract for a later implementation. Until it is approved, **no code changes**.

---

## Decision (end of document)

**NOT READY — ARCHITECTURE NEEDS REVISION** is **not** required for the *model* below.

**APPROVED FOR IMPLEMENTATION** of the **safe slice** defined in §0, after product sign-off.

The design is approved **only** as:

- Account **denomination** (native units) via existing `accounts.assetId`
- Tenant **book / functional currency** remains `settings.base_currency` = **USD**
- New **FX journal path** for IRT ↔ USD (and later USDT) cash conversions
- **Zero** change to `assertBalanced`, FIFO, `lots`, `lot_consumptions`, or historical `base_value`

Anything that makes `base_value` equal the account’s local currency is **out of scope and rejected**.

---

## 0. Scope of a first implementation (safe slice)

| In scope | Out of scope |
|---|---|
| Document and enforce denomination = `accounts.assetId` | Per-account functional currency |
| Reject same-asset `recordTransfer` when denominations differ | Changing `assertBalanced` |
| New `recordFx` (or `recordCurrencyConversion`) posting two native legs + USD `base_value` | Rewriting old journals |
| Freeze rate on `entry_fx_snapshots` (extend if needed) | Touching FIFO engine |
| UI: denomination picker; book currency read-only USD | Multi-book / EUR functional currency |
| Validation + tests listed in §9 | Automatic FX revaluation of open cash (IAS 21 monetary remeasurement) |

**First implementation should not add `accounts.accountingCurrencyId`.** That column would duplicate `assetId` for money accounts and invite the wrong product interpretation.

---

## 1. Final architecture

### 1.1 Two concepts (never conflated)

```
                    ┌─────────────────────────────────────┐
                    │ Tenant books (one functional currency)│
                    │ settings.base_currency = "USD"        │
                    │ postings.base_value  ALWAYS in USD    │
                    │ lots.unit_cost_base  ALWAYS in USD    │
                    │ assertBalanced(sum base_value) = 0    │
                    └─────────────────────────────────────┘
                                      ▲
                                      │ conversion at POST time only
                                      │ rate frozen on the journal
          ┌───────────────────────────┴───────────────────────────┐
          │ Account denomination (native holding unit)              │
          │ accounts.assetId → assets.symbol  IRT | USD | USDT | …  │
          │ postings.quantity in that asset’s units                 │
          │ postings.assetId MUST match the account’s denomination  │
          │   for cash/money accounts (see validation)              │
          └─────────────────────────────────────────────────────────┘
```

**Account Denomination**  
The unit the wallet actually holds. Bank IRT holds تومان. Cash USD holds dollars.

**Book / Functional Currency**  
The single unit of the general ledger, FIFO cost, P&amp;L, trial balance. **USD. Not selectable per account.**

### 1.2 Why `accounts.assetId` is already denomination

Money-account registration already requires `assetId ∈ {IRT, USD, USDT}` and stores it on the CoA row. Seed CoA does the same (1010 IRT, 1100 USDT, …).

`getAccountBalances` already returns `quantity` (native) + `baseValue` (USD).

**Therefore a new `accounts.denominationAssetId` is not required.** See §2.

### 1.3 Layering (what may change later)

| Layer | Change allowed later? |
|---|---|
| `src/domain/accounting.ts` `assertBalanced` | **No** |
| `src/domain/fifo.ts` | **No** |
| `lots` / `lot_consumptions` schema & writers | **No** |
| Meaning of `postings.base_value` | **No** |
| `recordTransfer` | **Yes — validation only** (reject cross-denomination) |
| New `recordFx` in ledger service | **Yes — additive** |
| `entry_fx_snapshots` | **Yes — additive columns if needed** |
| Account / transaction UI | **Yes** |
| Reports display (native + book) | **Yes — read model only** |

---

## 2. Schema proposal

### 2.1 Option A — Keep `accounts.assetId` as denomination (recommended)

**No new account column.**

| Pros | Cons |
|---|---|
| Matches current CoA, seed, money-account service, balances query | Name `assetId` is not “currency” in the UI (documentation/UI label only) |
| Zero migration | Crypto/gold accounts also use `assetId` as the *instrument*, which is correct (denomination = BTC grams, not “USD”) |
| Cannot drift from posting `assetId` if we validate equality | Product might still ask “where is accounting currency?” — answer in UI copy |

### 2.2 Option B — Add `accounts.denominationAssetId` or `accountingCurrencyId`

| Pros | Cons |
|---|---|
| Explicit name | Duplicates `assetId` for money accounts |
| Could point at `currencies` instead of `assets` | Two sources of truth; easy to desync |
| | Invites treating it as functional currency |
| | Needs backfill; still unused by FIFO/`assertBalanced` |

**Decision: Option A.**  
If a later UX audit wants a clearer name, add a **SQL view or TypeScript alias** (`denominationAssetId = assetId`), not a second FK.

### 2.3 Additive schema (only if `recordFx` needs more than today’s snapshot)

Today `entry_fx_snapshots` stores: `irtAmount`, `usdAmount`, `fxRate`, `rateSource`, `rateDate` (presentation freeze).

For a proper FX journal, **prefer not to invent a second rate table**. Extend snapshot **additively** when implementing:

```
entry_fx_snapshots
  -- existing: irt_amount, usd_amount, fx_rate, rate_source, rate_date
  OPTIONAL later:
  from_account_id uuid null
  to_account_id   uuid null
  from_asset_id   uuid null
  to_asset_id     uuid null
  from_quantity   numeric null   -- native source
  to_quantity     numeric null   -- native dest
  book_value      numeric null   -- USD, same as |base_value| of the cash legs
  fx_pnl_base     numeric null   -- 0 in v1 (see §5)
```

**v1 can store the same facts without new columns:** the two postings already hold native qty + USD `base_value`; snapshot already holds rate.

**No change to:** `postings`, `journal_entries` types (reuse `type = 'fx'`), `lots`, `accounts`.

### 2.4 Tenant book currency

Keep `settings.key = 'base_currency'` value `'USD'`.  
UI shows it read-only. Changing tenant book currency is a **future multi-year project**, not this feature.

---

## 3. Relationships (no mixed currencies)

```
Account
  id
  type
  assetId ────────────► Asset (IRT | USD | USDT | BTC | …)
                          currencyId ──► currencies (optional catalog)

Posting
  accountId ──────────► Account
  assetId   ──────────► Asset     MUST equal Account.assetId for money/cash legs
  quantity              native units of posting.assetId
  baseValue             ALWAYS USD book amount (signed)

Journal
  type: transfer | fx | buy | …
  optional entry_fx_snapshots (immutable rate)

Lot (unchanged)
  assetId = traded instrument (BTC, GOLD, …)
  unitCostBase = USD
```

**Invariants**

1. `sum(postings.base_value) = 0` (± 1e-9) — existing `assertBalanced`.
2. For each money-account posting: `posting.assetId === account.assetId`.
3. Native quantities of different assets are **never** added together.
4. Book amounts of different journals **are** added (all USD).
5. FIFO never reads account denomination.

---

## 4. Same-currency transfer vs cross-currency FX

### 4.1 `recordTransfer` — same denomination only

Use when `from.assetId === to.assetId` (Bank IRT → Bank IRT, Cash USD → Cash USD).

Unchanged posting shape:

| Account | assetId | quantity | baseValue |
|---|---|---|---|
| From | A | −Q | −Q × unitPriceUsd |
| To | A | +Q | +Q × unitPriceUsd |
| Fee (optional) | … | … | feeUsd |

**New validation (implementation later):** if `from.assetId !== to.assetId`, throw `CROSS_CURRENCY_USE_FX` — do not post a corrupt same-asset transfer.

### 4.2 `recordFx` — different denominations

Use when converting cash/money between IRT, USD, USDT (and later EUR).

Worked example (user numbers):

- Source: Bank, denomination IRT, −100,000,000 IRT  
- Dest: Cash, denomination USD, +5,000 USD  
- Quoted rate: **1 USD = 20,000 IRT**  
  (100,000,000 / 20,000 = 5,000)  
- Book currency: USD  
- **Book value of the move: 5,000 USD** (destination face value, or IRT÷rate — they match if the quote is consistent)

| Leg | Account | Asset | Quantity | baseValue (USD) |
|---|---|---|---|---|
| Credit source | Bank | IRT | −100_000_000 | **−5_000** |
| Debit dest | Cash | USD | +5_000 | **+5_000** |

`assertBalanced`: −5000 + 5000 = 0. **Quantities are not compared.**

```
recordFx({
  entryDate,
  description,
  fromAccountId,          // Bank
  toAccountId,            // Cash
  fromAssetId,            // IRT  (must == bank.assetId)
  toAssetId,              // USD  (must == cash.assetId)
  fromQuantity,           // "100000000"  (unsigned input; posted negative)
  toQuantity,             // "5000"
  rate,                   // "20000"   meaning IRT per 1 USD  OR explicit pair
  rateQuote,              // { base: "USD", quote: "IRT" }
  rateSource,             // "user_settings" | "exchange_rates" | "manual"
  rateDate,               // ISO date of the rate used
  bookValue,              // "5000"  — USD; MUST equal |base_value| both legs
  feeBase?, feeAccountId?,
  userId?,
})
```

**How each field is stored**

| Field | Storage |
|---|---|
| Source account / asset / qty | posting 1 |
| Dest account / asset / qty | posting 2 |
| Exchange rate + date + source | `entry_fx_snapshots` (immutable) |
| Book value | both postings’ `base_value` (opposite signs) |
| FX gain/loss | **v1: none** if `fromQuantity / rate == toQuantity` (within tolerance). If the user types inconsistent amounts, **reject** rather than invent P&amp;L. |
| FIFO | **not opened, not consumed** (cash conversion, same as `registerMoneyAccount`) |

### 4.3 Rate convention

Reuse existing tenant convention: **IRT per 1 USD** (`user_fx_settings`, `getLatestUsdIrtRateForUser`).

```
bookValueUsd = fromAsset == USD ? fromQuantity
             : toAsset   == USD ? toQuantity
             : fromAsset == IRT ? fromQuantity / rateIrtPerUsd
             : … USDT treated as 1:1 USD in v1 (face_value), or via explicit USDT/USD if ever ≠ 1
```

Server computes `bookValue` and expected counter-quantity. Client preview is non-authoritative.

### 4.4 Fees

Optional third posting to expense 5040 in **USD `base_value`**, native qty in the account that pays the fee. Same pattern as `recordTransfer`.

---

## 5. Double-entry and `assertBalanced`

**Balance test does not change.**

A journal is balanced iff:

```
| Σ posting.base_value | ≤ 1e-9
and ≥ 2 postings
and no posting.quantity == 0
```

Native IRT and USD quantities **must not** enter this test.

**Additional FX-only checks (new, around `recordFx`, not inside `assertBalanced`):**

1. `from.assetId !== to.assetId`
2. Each posting’s `assetId` equals its account’s `assetId`
3. `|base_from| === |base_to| === bookValue` (before fees)
4. Implied rate: `|fromQty / toQty|` consistent with stored `fxRate` (pair-aware)
5. `bookValue > 0`

If 4 fails → **reject** (do not post FX gain/loss in v1).  
Rationale: cash conversion at a single quoted rate is a **translation**, not a realization event. Realized FX P&amp;L belongs to a later “remeasure monetary balances” project and would need an equity/income account and a policy. Shipping P&amp;L without that policy would invent numbers.

---

## 6. FX journal design (`recordFx`)

### When `recordTransfer`

- Same `assetId` on both money accounts
- Quantity conserved (minus fee in same asset)

### When `recordFx`

- Different denominations
- User (or API) supplies both native amounts **or** one amount + rate (server fills the other)

### Snapshot / immutability

On commit, write `entry_fx_snapshots` in the **same DB transaction** as `postEntry`:

- `fx_rate`, `rate_date`, `rate_source` from server at commit (or validated user override stored as `manual`)
- `irt_amount` / `usd_amount` filled when the pair is IRT–USD; for USDT–USD store USD face in `usd_amount` and 0 or null IRT until columns are generalized

**Later FX rate changes never UPDATE this row.** Same rule as vehicles / Stage 5 historical FX tests.

### Gain/Loss

| Version | Behavior |
|---|---|
| v1 (this design) | Inconsistent rate vs amounts → hard fail. No 4100/FX P&amp;L line. |
| v2 (explicit future) | Optional `fxPnlAccountId` if settlement ≠ implied; still does not rewrite history |

### Historical rate

Immutable. Reports that need “what was this worth in IRT at booking” read the snapshot, not live `user_fx_settings`.

### Does not call FIFO

`openLots` / `closeLot` omitted.

---

## 7. Reports and UI dual display

Every money surface shows **two numbers**, never mixed in one column without a unit.

| Surface | Native | Book |
|---|---|---|
| Account balance | `quantity` + asset symbol (100,000,000 IRT) | `baseValue` as USD |
| Ledger / tx detail | each line `quantity` + `symbol` | each line `baseValue`; header may show snapshot rate |
| P&amp;L | optional native on cash legs only | **totals only in USD** (`base_value` on income/expense accounts) |
| Cash flow | do **not** sum IRT+USD quantities | inflow/outflow stay `base_value` USD |
| Net worth | holdings qty × price or cost | already USD |
| Chart of accounts | denomination badge (IRT/USD/USDT) | book currency chip “دفتر: USD” read-only |

**Rule:** Any `SUM()` in reports continues to sum **`base_value` only**. Native sums are `GROUP BY asset_id`.

UI copy must say **واحد حساب (Denomination)** not **ارز دفترکل**.

### Chart of Accounts / create account (proposed)

```
Account name        [ Main Bank              ]
Kind                [ Bank                   ]
Denomination        [ IRT ▼ ]     ← IRT | USD | USDT
Book currency       USD (سیستمی — قابل تغییر برای این حساب نیست)

Opening balance     [ 100000000 ] IRT
≈ Book value        $5,000 USD   (rate 20,000 IRT/USD, frozen at post)
```

```
Account name        [ Cash Wallet            ]
Kind                [ Cash                   ]
Denomination        [ USD ▼ ]
Book currency       USD
Opening balance     [ 5000 ] USD
≈ Book value        $5,000 USD   (1:1)
```

User **cannot** set functional currency per account.

Transfer form:

- If both accounts same denomination → existing transfer
- If different → FX form: amount from, amount to, rate preview (server), confirm freeze

---

## 8. FIFO — no design change

Cash FX is not a buy/sell of a FIFO instrument.

- `consumeFifo(lots, qty, proceedsBase)` stays USD proceeds vs USD `unitCostBase`
- Buying BTC with IRT already: cash leg IRT qty + USD `baseValue`; lot cost = that USD
- Converting IRT→USD cash does not create or consume lots

**Account denomination must never be read by FIFO.**  
If someone later stores IRT in `unitCostBase`, the audit’s HIGH RISK case returns. Forbidden.

---

## 9. Historical data and migration

**Default migration: none.**

Existing rows:

- Already have correct denomination on `accounts.assetId`
- Already have USD `base_value`
- Already may have `entry_fx_snapshots` for income/expense presentation
- Lots unchanged

**Forbidden migrations**

- UPDATE `postings.base_value`
- Recompute lots / consumptions
- Reprice snapshots with current FX
- Change `settings.base_currency`

**Optional later data fix (manual, not auto):** journals that used `recordTransfer` with a single asset across two different real wallets — detect via `posting.assetId <> account.assetId`. Report-only in v1; do not auto-rewrite.

If Option B were ever chosen, backfill would be `denominationAssetId = assetId` only.

---

## 10. Deliverables checklist

### 10.1 Architecture

Dual-measure ledger; denomination = `assetId`; book = USD `base_value`; new FX use-case only.

### 10.2 Schema changes

**None required for v1.** Optional additive columns on `entry_fx_snapshots` only if product wants queryable from/to without joining postings.

### 10.3 API changes (later)

- `recordFx(cmd)` next to `recordTransfer`
- Action + API route: reject cross-currency on transfer endpoint
- Money account create: already has denomination; expose label “واحد حساب”
- GET balances: already returns both; UI must show both

### 10.4 Validation rules (later)

1. Transfer: `from.assetId === to.assetId`
2. FX: `from.assetId !== to.assetId`
3. FX: posting asset = account asset
4. FX: `bookValue` server-computed; client mismatch → 400
5. FX: rate > 0; snapshot written atomically
6. Never persist `base_value` in IRT
7. `assertBalanced` unchanged
8. No FIFO flags on FX
9. Book currency not accepted from client

### 10.5 FX journal

See §4–§6. Type `fx`. Snapshot immutable. No P&amp;L v1.

### 10.6 UI

Denomination select; book currency read-only; dual amounts; branch transfer vs convert.

### 10.7 Migration plan

No-op. Compatibility tests only.

### 10.8 Backward compatibility

Additive code paths. Old transfers, openings, buys, sells, FIFO, Stage 5 FX freeze tests must stay green without data rewrite.

### 10.9 Test plan (write tests **with** implementation, not before approval)

Same-currency IRT→IRT, USD→USD.  
Cross-currency IRT→USD and USD→IRT via `recordFx`.  
Inconsistent rate rejected.  
Rate change after post does not alter journal/snapshot.  
USDT→USD 1:1.  
Opening IRT still USD book.  
Buy asset with IRT: FIFO USD unchanged.  
Sell after FX: lots untouched by FX.  
`sum(base_value)=0`.  
Transfer API on mixed accounts fails closed.  
Reports: native grouped by asset; totals USD.  
Historical fixtures: byte-stable `base_value` and `unit_cost_base`.

### 10.10 Risks

| Risk | Mitigation |
|---|---|
| Product names denomination “accounting currency” | UI copy + this doc |
| Implementer puts IRT in `base_value` | Review gate + tests |
| Silent `recordTransfer` on mixed assets | Fail closed |
| USDT ≠ 1 USD later | Face-value v1; explicit rate later |
| Users want FX P&amp;L on cash | Deferred v2 |
| Extending `assertBalanced` “to be safe” | Explicitly forbidden |

---

## 11. Implementation readiness

**APPROVED FOR IMPLEMENTATION** of the **safe slice** in §0, **after** explicit product confirmation of:

1. No new CoA currency column in v1 (`assetId` is denomination).
2. No FX gain/loss in v1 (reject inconsistent amounts).
3. Book currency remains global USD.
4. FIFO / `assertBalanced` / historical ledger remain frozen.

**Not approved:** per-account functional currency, rewriting `base_value`, or changing FIFO.

This file is the design artifact. Implementation must not start until the product owner replies with confirmation of (1)–(4).
