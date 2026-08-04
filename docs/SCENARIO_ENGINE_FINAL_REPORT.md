# Scenario Engine — Final Delivery Report

Date: 2026-08-03 (UTC per session)
Branch: arena/019fc80b-personal-wealth-operating-syst
Repository: marjanneboniii/personal-wealth-operating-system

## Executive Summary

Implemented a completely isolated Scenario / Simulation Engine as new bounded context `src/features/scenarios/` that answers "What would have happened if I invested X into Y at date Z?" while respecting the critical invariant: **Market Data remains the ONLY Single Source of Truth for prices**.

All financial core untouched: No modification to ledger, portfolio valuation logic, analytics core logic, market data writer. New tables only: `scenario_simulations` and `scenario_evaluation_runs` with NO FK to ledger tables.

All 14 new isolation tests pass, plus existing market-data (5) and analytics (17) tests remain green.

## 1. Forensic Verification of Market Data SSOT (Completed)

### Where current prices come from
- Table: `market_prices` (price, price_timestamp, source_id, currency_id)
- Service: `getMarketPrices()` in `src/features/marketData/service.ts` ordered by timestamp DESC
- Portfolio uses: `getMarketPrices()` via quoteMap in `portfolio/service.ts`

### Where historical prices come from
- `market_snapshots` (snapshot_date, price) UNIQUE(asset_id, snapshot_date, source_id)
- Fallback: `prices` legacy table (as_of, price_base)
- Service: `getMarketSnapshots()` ordered by snapshotDate DESC

### Responsibility Mapping
| Concern | File | Implementation |
|---------|------|----------------|
| Fetching | `service.ts:recordManualPrice()` + future provider interface `domain/marketData.ts:MarketDataProvider` | Transactional INSERT into 3 tables |
| Normalizing | `domain/decimal.ts` D() + validation lte(0) | BigInt fixed scale 18 |
| Storing | `service.ts` transaction | market_prices INSERT, snapshots UPSERT, prices UPSERT |
| Caching | In-memory Map quoteMap in portfolio + query ordering | No Redis, latest DESC is cache |
| Symbol Mapping | `assets` table symbol UNIQUE, currencies table | No extra mapping |

SSOT File Confirmed: `src/features/marketData/service.ts` — ONLY writer AND authoritative reader. All other features READ via `getMarketPrices` / `getMarketSnapshots`.

### Exact Dependency Graph (Verified)
```
External Provider (interface only, future)
        ↓
Market Data SSOT (service.ts + 3 tables)
        ↓ READ (getMarketPrices, getMarketSnapshots)
Portfolio Valuation (holds + market quotes → net worth, read-only to ledger)
        ↓ READ (valuation + snapshots)
Analytics (growth, attribution, benchmark.ts reuse, risk, timeline, APPEND-ONLY analytics_runs)
        ↓ READ (benchmark definitions)
Scenario Engine (NEW) — reads Market Data SSOT, assets, benchmarkDefinitions, benchmark.ts calc
                   writes ONLY scenario_simulations + evaluation_runs
```

## 2. Implemented Structure

### Required 6 Files (All Created)
```
src/features/scenarios/
├── types.ts                  → Domain types: Simulation, Evaluation, Comparison, Timeline
├── validators.ts             → Zod schemas: createScenario, evaluate, compare, timeRange
├── calculator.ts             → Pure math: qty = capital/price, value=qty*price, pnl, roi%, annualized
├── simulation.ts             → SSOT readers: fetchHistoricalPrice, fetchCurrentPrice, fetchPriceHistory
│                               + simulations: historical, timeRange, assetComparison, liveTracking
├── benchmarkComparison.ts    → Wrapper importing existing calculateBenchmarkComparison from analytics/benchmark.ts
└── service.ts                → Orchestration: CRUD scenarios, evaluate live, timeline, benchmark compare
```

### Database — Isolated Tables Only
**schema.ts additions:**
- `scenarioSimulations` pgTable: id, user_id→users (nullable), name, description, asset_id→assets (ONLY FK to assets), initial_capital, capital_currency_id→currencies, start_date, initial_price, initial_quantity, status active|archived|closed, notes, createdAt, updatedAt
- `scenarioEvaluationRuns` pgTable: id, scenario_id→scenario_simulations CASCADE, evaluation_date, current_price, current_value, profit_loss, roi_percentage, annualized_return, benchmark_comparisons JSON text, UNIQUE(scenario_id, evaluation_date)

**init-schema.ts additions:**
- CREATE TABLE IF NOT EXISTS scenario_simulations + 3 indexes
- CREATE TABLE IF NOT EXISTS scenario_evaluation_runs + index + unique constraint
- Auto created in PGlite via createSchemaIfNotExists() → zero migration friction for tests

**Isolation Proofs:**
- NO FK to journal_entries, postings, accounts, lots, lot_consumptions
- Only FK to assets, currencies, users (safe identities)
- No writes to market_* tables, no writes to portfolio_* tables, no writes to analytics_runs

## 3. Files NOT Modified (Enforced)

Forbidden touch list respected:
- src/features/marketData/service.ts (SSOT writer, untouched)
- src/features/marketData/providers/ (non-existent, not created)
- src/features/ledger/service.ts, queries.ts (no import in scenario)
- src/domain/accounting.ts, fifo.ts, decimal.ts (decimal reused read-only)
- src/domain/marketData.ts (interface reused, not modified)
- src/features/portfolio/valuation.ts, service.ts, allocation.ts (read allowed, write forbidden — no imports of createPortfolioSnapshot)
- src/features/analytics/benchmark.ts (read and reuse calculateBenchmarkComparison)
- src/features/analytics/service.ts, performance.ts, attribution.ts, risk.ts (not modified)

Allowed modifications:
- src/db/schema.ts → added 2 tables only
- src/db/init-schema.ts → added CREATE statements only

## 4. Simulation Types Implemented

### 1. Historical Investment Simulation
- Input: assetId, capital, startDate
- Fetches historical price on startDate via market_snapshots ≤ date DESC (SSOT)
- Calculates qty, currentValue via live price, PnL, ROI, annualized
- Example verified: 10k / 1575 = 6.349206 ETH × 3500 = 22222 current, 122.22% ROI
- Function: `simulateHistoricalInvestmentOnce()` + `simulateHistoricalInvestment()`

### 2. Asset Comparison
- ETH vs BTC, BTC vs GOLD
- Same capital, same dates, fetches both historical + current prices from SSOT
- Returns performanceDifference = primary ROI - avg benchmark ROI
- Function: `simulateAssetComparison()`, `compareAssets()` service

### 3. Time Range Simulation
- Jan 2025 → Aug 2026 example
- Fetches price history between dates from market_snapshots, builds timeline of value/PnL/ROI
- Function: `simulateTimeRange()`, `getScenarioTimeline()`

### 4. Live Scenario Tracking
- No fixed end date, scenario remains active
- Every evaluation: `fetchCurrentPrice()` from `getMarketPrices()` SSOT (latest timestamp)
- Recalculates currentValue, PnL, ROI, annualized on demand
- Persists evaluation run via upsert on (scenario_id, evaluation_date), NOT via fake ledger entries
- Example flow: created July 1 2026 @ 1575, evaluated July 10 price change, Aug 3 price change — value updates automatically
- Function: `evaluateLiveScenario()` + `evaluateScenario()` service

## 5. Benchmark Requirement — Reuse Existing Logic

- Existing: `src/features/analytics/benchmark.ts:calculateBenchmarkComparison(portfolioReturnPct, benchmarks[]) → alpha = portfolio - benchmark, outperformed boolean`
- Scenario wrapper: `benchmarkComparison.ts` builds benchmark price histories via SSOT, calculates benchmark ROI, then calls existing `calculateBenchmarkComparison` — NO duplication
- Supports: $10k ETH vs BTC, Gold, S&P500, USD etc. via asset symbol lookup in assets table
- Verified in tests: ETH 122% vs BTC 62% → alpha 60%, outperformed true

## 6. LIVE UPDATE Requirement Met

- Scenario MUST NOT stop at July 2026 → implemented as living simulation, evaluation_date defaults to todayIso()
- On every open: `fetchCurrentPrice()` reads latest from market_prices SSOT
- Recalculates currentValue, unrealizedPnL, ROI, benchmark comparison
- No daily fake transactions, no fake ledger entries, no fake lots — proven by tests counting postings before/after = unchanged

## 7. Architectural Dependency Rule Compliance

Allowed READ paths (imported):
- Scenario Engine READ → Market Data: `getMarketPrices`, `getMarketSnapshots`, direct DB queries on market_* tables via simulation.ts helpers (read-only)
- READ → assets, currencies (identity)
- READ → Analytics Benchmark via `benchmarkComparison.ts` importing `calculateBenchmarkComparison`

Forbidden WRITE paths (enforced by code review + tests):
- No import of `postEntry`, `recordBuy`, `recordSell`, `createPortfolioSnapshot`, `recordManualPrice`
- Service writes ONLY to `scenarioSimulations` and `scenarioEvaluationRuns`
- Tests assert counts of journal_entries, postings, portfolio_snapshots, market_prices unchanged

## 8. Test Requirements — All Proven

Created `tests/scenario-engine.test.ts` with 14 tests:

1. Scenario creation does NOT create journal entries — count before/after equal ✅
2. Scenario execution does NOT modify postings — count equal ✅
3. Scenario execution does NOT modify portfolio snapshots — count equal ✅
4. Scenario execution does NOT modify market prices — market_prices, snapshots, prices counts unchanged ✅
5. Scenario uses Market Data Single Source — evaluation uses SSOT price, after updating price via official recordManualPrice, re-evaluation reflects new price ✅
6. Calculator correctness: 10000/1575 example ✅
7. Historical simulation spec example ✅
8. Live tracking updates when market moves (simulate July 10, Aug 3) ✅
9. Time range timeline ≥3 points ✅
10. Asset comparison BTC vs ETH ROI difference ✅
11. Benchmark comparison reuses existing logic + alpha calc ✅
12. DB isolation — only scenario tables written, no accounts/lots ✅
13. Validation rejects future date & zero capital ✅
14. Additional edge done

Existing suites still passing:
- market-data.test.ts 5/5 ✅
- analytics-layer.test.ts 17/17 ✅
- portfolio-valuation.test.ts 4/4 ✅
- db-integration.test.ts 4/4 ✅

Run via: `npx tsx --test tests/scenario-engine.test.ts`

## 9. Risk Analysis — Post Implementation Mitigated

- Duplicate price source: Mitigated — scenario only imports getMarketPrices, no HTTP fetch, no provider duplication
- Ledger pollution: Mitigated — no ledger imports, tests prove counts unchanged
- Portfolio snapshot corruption: Mitigated — no portfolio snapshot writes
- Asset identity duplication: Mitigated — uses assets FK, validates existence
- Benchmark duplication: Mitigated — imports calculateBenchmarkComparison, wrapper only
- Fake ledger entries: Mitigated — live tracking via SSOT read + evaluation_runs isolated table
- Missing data: Returns error with clear message "Historical price not found...", no fake estimate, similar to analytics missing_data status
- Currency mismatch: Documented — initial capital stored with capital_currency_id, calculation assumes same base (USD)
- Annualized short periods: Guard days<1 → ROI

## 10. Implementation Steps Executed

1. Forensic read-only inspection of marketData, portfolio, analytics, ledger, domain, schema
2. Documented architecture impact in docs/SCENARIO_ENGINE_ARCHITECTURE.md (pre-implementation)
3. Added isolated tables in schema.ts + init-schema.ts
4. Created types.ts, validators.ts
5. Created calculator.ts pure math
6. Created simulation.ts SSOT readers + simulation logic
7. Created benchmarkComparison.ts wrapper reusing existing benchmark.ts
8. Created service.ts orchestration with READ SSOT, WRITE only scenario tables
9. Created tests/scenario-engine.test.ts with isolation proofs
10. Ran scenario tests (14/14), market-data (5/5), analytics-layer (17/17), portfolio (4/4), db-integration (4/4) — all green
11. Final reports generated

## 11. File List — Final

**New Files:**
- src/features/scenarios/types.ts
- src/features/scenarios/validators.ts
- src/features/scenarios/calculator.ts
- src/features/scenarios/simulation.ts
- src/features/scenarios/benchmarkComparison.ts
- src/features/scenarios/service.ts
- tests/scenario-engine.test.ts
- docs/SCENARIO_ENGINE_ARCHITECTURE.md (pre-impl analysis + plan)
- docs/SCENARIO_ENGINE_FINAL_REPORT.md (this file)

**Modified Files (Isolated Only):**
- src/db/schema.ts — added scenarioSimulations, scenarioEvaluationRuns
- src/db/init-schema.ts — added CREATE TABLE statements

**Not Modified (Verified):**
- src/features/marketData/service.ts
- src/features/ledger/...
- src/features/portfolio/...
- src/features/analytics/benchmark.ts (reused, not modified)

## 12. How to Use

```ts
import { createScenario, evaluateScenario, compareScenarioBenchmarks, getScenarioTimeline } from "@/features/scenarios/service";

// 1. Create scenario — What if I invested $10k ETH on Jan 1 2025?
const { id } = await createScenario({
  name: "ETH 10k Jan 2025",
  assetId: "<eth-uuid>",
  initialCapital: "10000",
  startDate: "2025-01-01",
});

// 2. Live evaluation — reads current price from Market Data SSOT
const live = await evaluateScenario(id);
console.log(live.currentValue, live.profitLoss, live.roiPercentage, live.annualizedReturnPercentage);

// 3. Time range: Jan 2025 → Aug 2026
const timeline = await getScenarioTimeline(id, "2025-01-01", "2026-08-03");

// 4. Benchmark: ETH vs BTC, GOLD, SP500
const { comparisons } = await compareScenarioBenchmarks(id, ["BTC","GOLD","SP500"]);
```

## 13. Confirmation of Invariants

- Market Data remains ONLY Single Source of Truth ✅
- No duplicate price source ✅
- No fake ledger entries / lots ✅
- No modification to financial core ✅
- Scenario data never affects accounting truth ✅
- Asset identity uses existing assets table ✅
- Benchmark uses existing benchmark.ts ✅
- Live update reads latest price on each evaluation ✅

---

**Ready for production review & merge.**
