# Scenario Engine — Architecture Impact Analysis & Delivery Report

## 1. Current Architecture — Forensic Investigation

### Market Data — Single Source of Truth (SSOT)

**Tables:**
- `market_price_sources` — Registry of sources: MANUAL | IMPORT | COINGECKO | TSETMC
- `market_prices` — Current/live quotes: `asset_id`, `price`, `currency_id`, `price_timestamp`, `source_id`
- `market_snapshots` — Historical daily snapshots: `asset_id`, `snapshot_date`, `price`, `currency_id`, `source_id`, UNIQUE(asset_id, snapshot_date, source_id)
- `prices` — Backward-compatible legacy table for reporting: `asset_id`, `as_of`, `price_base`, `source`, UNIQUE(asset_id, as_of)

**Service Layer:**
- `src/features/marketData/service.ts` — **THE SSOT WRITER**
  - `ensurePriceSources()` — ensures MANUAL, IMPORT, COINGECKO, TSETMC exist
  - `recordManualPrice()` — transactional write to all three price tables (market_prices INSERT, market_snapshots UPSERT, prices UPSERT). Validates asset existence, positive price, resolves currency fallback USD.
  - `getMarketPrices(assetId?)` — READ current quotes, joined with assets, currencies, sources, ordered by timestamp desc
  - `getMarketSnapshots(assetId?)` — READ historical snapshots, ordered by snapshotDate desc
  - `listPriceSources()`
  - **CRITICAL INVARIANT** documented: NEVER touches journal_entries, postings, lots, ledger tables.

- `src/domain/marketData.ts` — Provider abstraction interface:
  ```ts
  interface MarketDataProvider {
    getPrices(queries)
    getHistoricalPrices(query, start, end)
    getProviderName()
  }
  ```
  Current implementation is purely manual via recordManualPrice.

**Symbol Mapping:**
- `assets` table is sole asset identity (symbol UNIQUE). No secondary mapping.
- `currencies` maps USD etc.
- No separate symbol-mapping table.

**Where current prices come from:**
- `market_prices.price_timestamp` latest — query via `getMarketPrices()`. Portfolio uses this via `import { getMarketPrices } from "@/features/marketData/service"`

**Where historical prices come from:**
- `market_snapshots.snapshot_date` — via `getMarketSnapshots()`. Also `prices.as_of`.

**Responsibility mapping:**
| Concern | File | Table(s) |
|---------|------|----------|
| Fetching | `src/features/marketData/service.ts` `recordManualPrice` + future providers | external -> market_prices |
| Normalizing | `src/domain/decimal.ts` `D()` + validation in service.ts | N/A exact arithmetic |
| Storing | `service.ts` transaction | market_prices, market_snapshots, prices |
| Caching | Query ordering by priceTimestamp desc (current) / snapshotDate desc | memory Map in portfolio/service.ts (`quoteMap`) |
| Symbol Mapping | `assets` table + currencies | assets.symbol UNIQUE |

**SSOT File confirmed:** `src/features/marketData/service.ts` is the ONLY writer and reader authoritative for prices. Portfolio and Analytics both READ through it. No other price source exists.

### Existing Dependency Graph (Verified)

```
External Provider (interface in domain/marketData.ts, not yet impl)
        |
        v
Market Data Service (src/features/marketData/service.ts)
  Writers: market_prices, market_snapshots, prices
  Readers: getMarketPrices, getMarketSnapshots
        |
        v
Portfolio Valuation (src/features/portfolio/service.ts)
  - getHoldings() from ledger queries (READ ledger)
  - getMarketPrices() from Market Data (READ SSOT)
  - Calculates totalNetWorth, unrealizedPnl, roi
  - Writes ONLY to portfolio_snapshots / portfolio_valuations (no ledger touch)
        |
        v
Analytics (src/features/analytics/service.ts)
  - READ portfolio valuation + portfolio_snapshots
  - READ ledger via capitalFlows adapter (getCapitalFlowRecords)
  - READ benchmarkDefinitions (ensureBenchmarkDefinitions)
  - Uses pure calcs: performance.ts, attribution.ts, benchmark.ts, risk.ts, timeline.ts
  - APPEND-ONLY writes to analytics_runs (blocked UPDATE/DELETE via PG RULES)
  - Guarantee: never journal_entries/postings/lots/accounts
        |
        v
Scenario Engine (NEW - to be created)
```

**Ledger Core:**
- `journal_entries` immutable (status posted/void), `postings` quantity + baseValue, `lots` FIFO, `lot_consumptions`
- Queries: `src/features/ledger/queries.ts` — READ ONLY derived balances
- Service: `src/features/ledger/service.ts` — WRITER to journal/postings/lots with assertBalanced

**Portfolio:**
- `src/features/portfolio/valuation.ts` — pure math: quantity*price, pnl, roi
- `src/features/portfolio/allocation.ts` — grouping by asset class
- `service.ts` — READ-ONLY to accounting, writes only to snapshot tables

**Analytics Benchmark Existing:**
- `src/features/analytics/benchmark.ts`:
  ```ts
  calculateBenchmarkComparison(portfolioReturnPct, benchmarks[])
  Returns alpha = portfolio - benchmark, outperformed boolean
  ```
- `benchmarkDefinitions` table: BTC, GOLD, SP500, USD defaults
- Benchmark isolation proven in tests: creating benchmark data zero accounts/entries/postings

### Current Schema Append-Only Protections
- `analytics_runs`, `wealth_performance_snapshots`, `asset_performance_analysis`, `portfolio_risk_metrics`, `benchmark_results` have PG RULES `DO INSTEAD NOTHING` for UPDATE/DELETE (init-schema.ts)

## 2. Exact Files to Create (Isolated Feature)

```
src/features/scenarios/
├── types.ts                  // domain types: Simulation, Evaluation, Comparison, Timeline
├── validators.ts             // zod schemas for creation / evaluation
├── calculator.ts             // pure math: qty, value, pnl, roi, annualized
├── simulation.ts             // historical, time-range, asset comparison, live tracking logic (pure + reads market)
├── benchmarkComparison.ts    // wrapper over analytics/benchmark.ts + market data for benchmarks
└── service.ts                // orchestration: CRUD scenario_simulations, evaluation, compare, timeline; READ-ONLY to other domains
```

Plus:
- `tests/scenario-engine.test.ts` — isolation proofs
- Migration via schema.ts + init-schema.ts (new tables only)
- Optional UI: `src/app/scenarios/page.tsx` (if needed, not modifying existing)

## 3. Exact Files NOT to Modify

**FORBIDDEN TOUCH LIST (Financial Core Invariant):**
- `src/features/marketData/service.ts`
- `src/features/marketData/providers/` (does not exist — must not create duplicate price source; if providers needed, would be outside scenario)
- `src/features/ledger/service.ts`
- `src/features/ledger/queries.ts`
- `src/domain/accounting.ts`
- `src/domain/fifo.ts`
- `src/domain/marketData.ts`
- `src/features/portfolio/valuation.ts` (pure calculation reused, not modified)
- `src/features/portfolio/service.ts` (READ allowed, WRITE forbidden)
- `src/features/portfolio/allocation.ts`
- `src/features/analytics/benchmark.ts` (READ allowed, reuse logic)
- `src/features/analytics/service.ts` (READ allowed)
- `src/features/analytics/performance.ts`, `attribution.ts`, `risk.ts`, `timeline.ts`

**ALLOWED TO MODIFY:**
- `src/db/schema.ts` — ADD ONLY new scenario tables, no foreign keys to journal_entries/postings/accounts/lots/lot_consumptions. Only references assets, currencies, users (safe).
- `src/db/init-schema.ts` — ADD CREATE TABLE statements for new scenario tables
- `src/db/index.ts` — no need, but safe
- New feature folder `src/features/scenarios/` — all 6 files creation allowed

**ALLOWED TO READ (dependency direction):**
- Scenario Engine READ -> Market Data (getMarketPrices, getMarketSnapshots)
- Scenario Engine READ -> Portfolio (getPortfolioValuation optional, for context)
- Scenario Engine READ -> Ledger Queries (getHoldings optional)
- Scenario Engine READ -> Analytics Benchmark (calculateBenchmarkComparison)

## 4. Database Migration Plan

### New Tables — Isolated, No FK to Ledger Core

**Table: scenario_simulations**
```sql
CREATE TABLE IF NOT EXISTS scenario_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  user_id uuid REFERENCES users(id), -- nullable, optional, NOT referencing ledger
  name text NOT NULL,
  description text,
  asset_id uuid NOT NULL REFERENCES assets(id),  -- ONLY FK to assets (existing identity)
  initial_capital numeric(38,18) NOT NULL,
  capital_currency_id uuid REFERENCES currencies(id),
  start_date date NOT NULL,
  initial_price numeric(38,18) NOT NULL,
  initial_quantity numeric(38,18) NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active | archived | closed
  notes text
);
CREATE INDEX IF NOT EXISTS scenario_simulations_asset_idx ON scenario_simulations(asset_id);
CREATE INDEX IF NOT EXISTS scenario_simulations_user_idx ON scenario_simulations(user_id);
```

**Table: scenario_evaluation_runs**
```sql
CREATE TABLE IF NOT EXISTS scenario_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  scenario_id uuid NOT NULL REFERENCES scenario_simulations(id) ON DELETE CASCADE,
  evaluation_date date NOT NULL,
  current_price numeric(38,18) NOT NULL,
  current_value numeric(38,18) NOT NULL,
  profit_loss numeric(38,18) NOT NULL,
  roi_percentage numeric(38,18) NOT NULL,
  annualized_return_percentage numeric(38,18),
  benchmark_comparisons text, -- JSON for optional storage
  CONSTRAINT scenario_eval_uq UNIQUE (scenario_id, evaluation_date)
);
CREATE INDEX IF NOT EXISTS scenario_eval_scenario_idx ON scenario_evaluation_runs(scenario_id);
```

**Isolation Guarantees:**
- NO FK to journal_entries, postings, accounts, lots, lot_consumptions
- Only FK to assets (identity), currencies (quote), users (ownership), scenario_simulations self + cascade for evaluations
- Writes ONLY to these two tables
- READ ONLY elsewhere
- Optional: ADD RULES for append-only? NOT required but evaluation runs can be upserted (living simulation). We allow UPDATE on evaluation runs since live price changes should overwrite same day, but historical auditable. Alternative APPEND-ONLY would create new row per day – we support upsert on evaluation_date.

**Drizzle Schema addition** (src/db/schema.ts):
- Export `scenarioSimulations` pgTable
- Export `scenarioEvaluationRuns` pgTable

**Init Schema addition** (src/db/init-schema.ts):
- Append CREATE TABLE statements in STATEMENTS array, after backup_runs.

**Migration Execution:**
- For Postgres production: drizzle-kit push OR manual SQL execution
- For PGlite tests: `createSchemaIfNotExists()` will auto create new tables via statements loop — ensures tests pass without manual migration.

## 5. Dependency Diagram (With Scenario Engine)

```
External Provider (CoinGecko, TSETMC, etc. via domain/marketData.ts interface)
        |
        | writes
        v
┌─────────────────────────┐
│ Market Data SSOT        │
│ service.ts              │
│ - market_price_sources  │
│ - market_prices (live)  │
│ - market_snapshots (history) │
│ - prices (legacy)       │
└─────────────────────────┘
        |  READ ONLY (getMarketPrices, getMarketSnapshots)
        |-----------------------------------|
        |                                   |
        v                                   v
┌─────────────────┐              ┌──────────────────────────┐
│ Portfolio       │              │ Scenario Engine (NEW)    │
│ - getHoldings   │              │ - scenario_simulations   │
│ - getMarketPrices│             │ - scenario_evaluation_runs│
│ - portfolio_snapshots           │ - reads Market Data SSOT │
│ - portfolio_valuations           │ - reads assets, currencies│
└─────────────────┘              │ - reads benchmarkDefinitions│
        |                         │ - uses analytics/benchmark.ts│
        | READ                    │ - NEVER writes to ledger/portfolio/market│
        v                         │------------------------------------
┌─────────────────┐               | READ (live update) |
│ Analytics       │<--------------| (current price fetch) |
│ - performance   │               └──────────────────────────┘
│ - attribution   │                            |
│ - benchmark     │                            | evaluation on demand
│ - risk          │                            v
│ - analytics_runs│               UI: scenario detail page shows
│ APPEND-ONLY     │               currentValue, PnL, ROI, annualized, benchmark compare
└─────────────────┘
```

**Allowed Arrows:**
- Scenario Engine --READ--> Market Data
- Scenario Engine --READ--> Assets/Currencies
- Scenario Engine --READ--> Benchmark Definitions / benchmark.ts calculation
- Scenario Engine --READ--> Portfolio (optional, for cross-check, not required)
- Scenario Engine --WRITE--> scenario_simulations, scenario_evaluation_runs ONLY

**Forbidden Arrows (Enforced by code – import restrictions & tests):**
- Scenario Engine --WRITE--> journal_entries
- Scenario Engine --WRITE--> postings
- Scenario Engine --WRITE--> lots / lot_consumptions
- Scenario Engine --WRITE--> accounts
- Scenario Engine --WRITE--> market_prices / market_snapshots / prices
- Scenario Engine --WRITE--> portfolio_snapshots / portfolio_valuations
- Scenario Engine --WRITE--> analytics_runs / benchmark_results etc.

## 6. Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Duplicate price source** — scenario creating its own price fetching | Breaks SSOT, valuation divergences | Enforce Scenario imports ONLY getMarketPrices / getMarketSnapshots from existing marketData/service.ts. No direct external HTTP in scenario. Calculator pure. Tests assert market table counts unchanged after scenario eval. |
| **Ledger pollution** — scenario creation writes journal_entries | Accounting truth corrupted, balances wrong | No import of postEntry, recordBuy etc. Service only writes scenario tables. Tests count journal_entries/postings before/after. |
| **Portfolio snapshot corruption** — scenario modifies snapshots | Analytics history broken | No import of createPortfolioSnapshot. Tests verify portfolio_snapshots count. |
| **Asset identity duplication** — new asset system | Symbol mismatch, price lookup fails | Use asset_id FK to existing assets table. Validate asset exists via db.select assets. No new asset table. |
| **Benchmark logic duplication** | Divergent alpha calculations | Import calculateBenchmarkComparison from analytics/benchmark.ts reuse, not rewrite. Wrapper only adds market price fetching. |
| **Fake ledger entries for daily tracking** — spec forbids daily fake transactions | Would inflate postings | Live tracking implemented as on-demand evaluation reading latest price, optionally persisting into evaluation_runs (isolated). No journal. |
| **Historical price missing** | Simulation fails silently with wrong ROI | Missing data handling: if no snapshot, fallback to prices table, then error with clear message. Return calculationStatus missing_data like analytics, not fake estimate. |
| **Currency mismatch** — initial capital in USDC but asset price in USD | ROI miscalc | Store capital_currency_id, resolve price currency, assume base in USD for simplicity (all examples USD). Calculator works in same currency — document assumption, use numeric identical. |
| **Annualized return miscalc for short periods** | Misleading %Recalc | Guard: if days <1, annualized = roi. Otherwise (1+roi)^(365/days)-1 |
| **Test DB contamination** | Flaky isolation tests | Each test setup deletes scenario tables first, then others, order respects FKs. Uses PGlite via createSchemaIfNotExists. |
| **Performance — repeated price lookups per evaluation** | Slow for many scenarios | Cache quoteMap like portfolio does, single getMarketPrices query per evaluation batch. For time-range, single getMarketSnapshots query. |
| **UI blocking if price source lag** | Stale scenario value | Live evaluation always reads latest price_timestamp desc, shows price age warning if needed. |

**Residual Risks (Low after mitigation):**
- If external provider layer finally implemented, scenario automatically benefits via market_prices SSOT without change.
- No risk to financial core if file-not-to-modify list respected.

## 7. Implementation Steps

### Phase 0 — Forensic (Done)
- Inspect marketData/service.ts, domain/marketData.ts, schema tables, portfolio valuation, analytics benchmark
- Confirm SSOT file
- Map dependency graph
- Document isolated table design

### Phase 1 — Schema (Isolated DB)
1. Edit `src/db/schema.ts` — add `scenarioSimulations` and `scenarioEvaluationRuns` pgTable definitions at end of file (before Platform section or after). Use existing `base` spread for id etc? Use custom to match spec: id, userId nullable, name, assetId FK assets.id, initialCapital, capitalCurrencyId FK currencies, startDate, initialPrice, initialQuantity, status, createdAt etc.
2. Edit `src/db/init-schema.ts` — add two CREATE TABLE IF NOT EXISTS statements matching schema, plus indexes. Append to STATEMENTS array.
3. Verify `createSchemaIfNotExists()` will create new tables in PGlite.

### Phase 2 — Domain Types & Validators
4. Create `src/features/scenarios/types.ts`:
   - Inputs: CreateScenarioInput, EvaluateScenarioInput
   - Entities: ScenarioSimulation, ScenarioEvaluationRun
   - Results: SimulationResult, TimeRangePoint, AssetComparisonResult, BenchmarkComparisonResult, LiveScenarioResult
   - Enums: ScenarioStatus
5. Create `validators.ts` using zod:
   - createScenarioSchema: name min1, assetId uuid, initialCapital string >0, capitalCurrencyId optional uuid, startDate ISO date <= today, initialPrice optional (if not provided, fetch from market), etc.
   - evaluation schemas
   - Ensure decimal validation via regex

### Phase 3 — Pure Calculators
6. Create `calculator.ts`:
   - `calculateInitialQuantity(capital, price): string` => D(capital).div(price)
   - `calculateCurrentValue(qty, currentPrice)`
   - `calculateProfitLoss(currentValue, initialCapital)`
   - `calculateRoi(profitLoss, initialCapital)` => pnl / capital *100 toFixed 2
   - `calculateAnnualizedReturn(roiPct, startDate, evalDate)` => power formula
   - `calculateHistoricalSimulation(...)` assembling above
   - `calculateTimeRangePoint`
   - `calculateAssetComparison`

### Phase 4 — Simulation Engine (Market Data Reader)
7. Create `simulation.ts`:
   - `fetchHistoricalPrice(assetId, date)` — tries market_snapshots <= date order desc limit1, fallback prices table, else null
   - `fetchCurrentPrice(assetId)` — getMarketPrices(assetId) first row or latest snapshot
   - `simulateHistoricalInvestment` pure wrapper around calculator + fetched prices
   - `simulateTimeRange(assetId, start, end, capital)` — get snapshots range, map to timeline
   - `simulateAssetComparison(primaryAssetId, benchmarkAssetIds, capital, startDate)` — loops benchmarks
   - `evaluateLiveScenario(scenario)` — fetches current price, returns result

### Phase 5 — Benchmark Comparison Wrapper
8. Create `benchmarkComparison.ts`:
   - Import `calculateBenchmarkComparison` from analytics/benchmark.ts (reuse, no duplication)
   - `compareScenarioWithBenchmarks(scenarioResult, benchmarks[])` — constructs BenchmarkReturnData using benchmark asset price histories
   - `fetchBenchmarkPrice(symbol, date)` — lookup asset by symbol, then fetch historical price
   - `buildBenchmarkComparison` returns BenchmarkComparisonItem[]

### Phase 6 — Service Layer (Orchestration, Isolated Writes)
9. Create `service.ts`:
   - `createScenario(input)`:
     - validate asset exists
     - resolve historical price on startDate via simulation.ts helper (SSOT)
     - if initialPrice not provided, use fetched historical price, else validate
     - calculate initialQuantity via calculator
     - insert into scenario_simulations, return id
     - NEVER touch journal/postings/lots/accounts/market tables
   - `evaluateScenario(scenarioId, evaluationDate=today)`:
     - fetch scenario row
     - fetch current price via fetchCurrentPrice (SSOT READ)
     - calculate currentValue, PnL, ROI, annualized
     - upsert into scenario_evaluation_runs
     - return LiveScenarioResult
   - `getScenario(scenarioId)` — join with assets for symbol/name, live evaluate
   - `listScenarios(userId?)` — list + live eval optional
   - `getScenarioTimeline(scenarioId, start, end)` — time range simulation
   - `compareScenarioWithBenchmarks(scenarioId, benchmarkSymbols)` — uses benchmarkComparison.ts
   - `archiveScenario`, `deleteScenario`
   - Ensure all writes limit to scenario tables

### Phase 7 — Tests (Isolation Proofs)
10. Create `tests/scenario-engine.test.ts`:
    - Setup DB helper `setupScenarioDb()` similar to market-data.test.ts: deletes scenario tables first (respect FK order), then market, ledger etc., ensures schema exists, inserts currencies, assetClasses, assets (ETH, BTC, etc.), records manual prices for historical dates.
    - Test 1: Scenario creation does NOT create journal_entries
    - Test 2: Scenario execution does NOT modify postings
    - Test 3: Scenario execution does NOT modify portfolio_snapshots
    - Test 4: Scenario execution does NOT modify market_prices / market_snapshots / prices
    - Test 5: Scenario uses Market Data SSOT — create manual price, then evaluate scenario, currentValue must match price * quantity using SSOT price
    - Test 6: Historical investment simulation formula correctness: 10k USDC, ETH 1575 -> qty 6.349206, current 3500 -> value 22222.22 etc.
    - Test 7: Live tracking — update market price, re-evaluate, value changes
    - Test 8: Time range simulation returns timeline
    - Test 9: Asset comparison ETH vs BTC outputs performance difference
    - Test 10: Benchmark comparison reuses existing logic (import calculateBenchmarkComparison)
    - Additional isolation: changing UI preference doesn't affect scenario accounting (mirrors analytics test)

### Phase 8 — Verification
11. Run `npm test` filtered scenario tests with PGlite
12. Run existing tests to ensure no regression: `npm run test -- tests/market-data.test.ts` etc.
13. Manual verification: scenario creation via service, evaluate, ensure no ledger pollution

### Phase 9 — Delivery
14. Commit & produce final report with dependency graph, implementation summary, file list, test results

## Summary

- Market Data remains SSOT: `src/features/marketData/service.ts` + tables market_prices/market_snapshots/prices.
- Scenario Engine is new bounded context under `src/features/scenarios/` with 6 files, isolated tables, READ-ONLY dependency to SSOT and analytics benchmark.
- No duplicate price source, no fake ledger, no ledger writes.
- All calculations use `src/domain/decimal.ts` exact arithmetic.
- Live update via current price fetch on each evaluation.
- Full isolation proven by tests.

