# 🔍 Audit Report — Real Estate Orphaned Data Consistency

**Date:** 2026-08-25  
**Scope:** Real Estate domain, Reporting layer, Wealth analytics, Recent activity feed, Identifier generation  
**Excluded (immutable):** journal_entries, postings, accounts, general ledger, FIFO engine, lot_consumptions, audit trail

---

## Finding 1: Orphaned Asset Record (ROOT CAUSE)

**Status:** 🔴 Critical  
**Table:** `assets`

When a property was deleted from `real_estate_properties` directly, the corresponding `assets` row was **NOT** soft-deleted. The FK relationship is:

```
real_estate_properties.asset_id → assets.id (ON DELETE CASCADE)
```

This means: deleting the `assets` row cascades to `real_estate_properties`, but deleting `real_estate_properties` does NOT cascade to `assets`.

**Impact:**
- `getHoldings()` (ledger/queries.ts) filters on `ast.deleted_at IS NULL` — the orphaned asset still passes this filter
- `getPortfolioValuation()` includes it in portfolio total, unrealized P/L, and ROI
- `getCurrentNetWorth()` uses the inflated valuation
- All downstream reports are affected

---

## Finding 2: Reports — Unrealized P/L

**Status:** 🔴 Affected  
**File:** `src/app/reports/page.tsx` (line ~42)

```typescript
const unrealized = Decimal.sum(holdings.map((h) => 
  D(h.quantity).mul(h.price ?? "0").sub(h.costBase).toString()
));
```

Uses `getHoldings()` which includes the orphaned asset. The unrealized P/L for the deleted property is still calculated.

**Fix:** Soft-delete the orphaned asset → `getHoldings()` naturally excludes it.

---

## Finding 3: Wealth Health Metrics (بازده تعدیل‌شده & بازده سرمایه‌گذاری خالص)

**Status:** 🔴 Affected  
**Chain:** `net-worth/page.tsx` → `getAnalyticsSummary()` → `getPortfolioValuation()` → `getHoldings()`

The growth calculation uses:
- `startingValue` = last portfolio snapshot
- `endingValue` = current portfolio valuation (includes orphaned asset)

Result: `adjustedWealthReturnPercentage` and `netInvestmentReturn` are distorted by the ghost asset.

**Fix:** Soft-delete the orphaned asset → `getPortfolioValuation()` naturally excludes it.

---

## Finding 4: Dashboard — Recent Activity

**Status:** 🟡 Affected  
**File:** `src/features/ledger/queries.ts` → `getTransactions()`

The journal entry for the deleted property's acquisition still appears because:
1. `journal_entries` is immutable (cannot modify)
2. `getTransactions()` does not filter out entries whose referenced assets are soft-deleted

**Fix:** Add a filter to `getTransactions()` to exclude entries where ALL asset-type postings reference soft-deleted assets.

---

## Finding 5: Property Identifier Generation (002 instead of 001)

**Status:** 🔴 Bug  
**File:** `src/features/rwa/symbol.ts` → `nextRwaSymbol()`

```typescript
const rows = await tx
  .select({ symbol: assets.symbol })
  .from(assets)
  .where(sql`${assets.symbol} ~ '^[0-9]+$'`);
```

This query does NOT check `deleted_at IS NULL`. Even soft-deleted assets keep their identifiers reserved. After deleting the first property (and its asset), `001` is still occupied.

**Fix:** Add `AND deleted_at IS NULL` to the query so soft-deleted assets release their identifiers.

---

## Finding 6: Orphaned Prices Data

**Status:** 🟡 Low risk  
**Table:** `prices`

Price rows for the orphaned asset may still exist. These are valuation data, not accounting data. Soft-deleting the asset makes them invisible to the valuation pipeline.

---

## Data Flow Diagram

```
[Property deleted from real_estate_properties]
         │
         ├─→ assets row: STILL EXISTS (not soft-deleted)
         │     │
         │     ├─→ getHoldings(): INCLUDES it (deleted_at IS NULL ✓)
         │     │     │
         │     │     ├─→ getPortfolioValuation(): WRONG totals
         │     │     │     │
         │     │     │     ├─→ Reports unrealized P/L: WRONG
         │     │     │     ├─→ getCurrentNetWorth(): WRONG
         │     │     │     └─→ getAnalyticsSummary(): WRONG growth metrics
         │     │     │           ├─→ adjustedWealthReturnPercentage: WRONG
         │     │     │           └─→ netInvestmentReturn: WRONG
         │     │     │
         │     │     └─→ Dashboard widgets: WRONG
         │     │
         │     └─→ nextRwaSymbol(): 001 still RESERVED
         │
         ├─→ journal_entries row: STILL EXISTS (immutable)
         │     │
         │     └─→ getTransactions(): STILL SHOWS the entry
         │           │
         │           └─→ Dashboard Recent Activity: STILL SHOWS
         │
         └─→ prices row: STILL EXISTS
               │
               └─→ Latest price for orphaned asset: used in valuation
```

---

## Remediation Plan

### Immediate (Code Fixes):
1. **`symbol.ts`** — Add `deleted_at IS NULL` filter to `nextRwaSymbol()`
2. **`queries.ts`** — Add filter to `getTransactions()` to exclude entries with only soft-deleted asset postings
3. **`service.ts`** — Add `deleteRealEstateAsset()` function for proper cascade cleanup
4. **`service.ts`** — Add `repairOrphanedRealEstate()` function for existing orphaned data
5. **`realEstate.ts`** — Add `deleteRealEstateAction()` server action

### What Changes:
- ✅ `assets` — soft-delete orphaned rows (set deleted_at)
- ✅ `prices` — delete orphaned price rows
- ✅ `real_estate_properties` — already deleted (no change needed)
- ✅ `real_estate_valuation_snapshots` — cascade deletes from property/asset FKs

### What DOES NOT Change (immutable):
- ❌ `journal_entries` — untouched
- ❌ `postings` — untouched
- ❌ `accounts` — untouched
- ❌ `lots` — untouched
- ❌ `lot_consumptions` — untouched
- ❌ `audit_log` — untouched
- ❌ No destructive migrations
