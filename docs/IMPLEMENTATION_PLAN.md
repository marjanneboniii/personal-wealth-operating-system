# ENTERPRISE PERSONAL WEALTH OPERATING SYSTEM — IMPLEMENTATION PLAN

**Status:** Approved Architecture — Validation Audit Completed
**Mode:** Strict Architecture Preservation — Financial Core Frozen
**Date:** 2026-08-04
**Branch:** arena/019fc80b-personal-wealth-operating-syst

## MOST IMPORTANT RULE — FINANCIAL CORE FROZEN

The following entities are protected assets and MUST NOT be redesigned, altered, or owned by new domains:

- `journal_entries`
- `postings`
- `accounts`
- `lots`
- `lot_consumptions`

No migration that alters Financial Core. No new domain may modify their structure or ownership.

All existing tests must remain green: market-data, analytics-layer, portfolio-valuation, db-integration, scenario-engine.

## ABSOLUTELY FORBIDDEN ACTIONS (Enforced)

- ❌ Redesign Ledger / Change Transaction Model / Replace Accounting Engine
- ❌ Make Portfolio independent accounting source
- ❌ Connect DeBank / Zerion directly to Accounting
- ❌ Create automatic Ledger transactions from blockchain observations
- ❌ Create automatic buys from wallet imports
- ❌ Change Cost Basis / Lot Accounting logic
- ❌ Add FK from external observation domains into accounting tables (accounts, journal_entries, postings, lots)
- ❌ Import postEntry / recordBuy / recordSell in external observation domains

External Observation Domain MUST NEVER WRITE TO Financial Core.

## APPROVED HIGH LEVEL ARCHITECTURE

```
                Financial Core
                     |
    +----------------+----------------+
    |                |                |
Wallet Identity Observation       RWA Domain
    |                |                |
    |                |                |
Reconciliation Valuation Engine  Ownership
                     |
                     |
            Wealth Aggregation
                     |
                     |
                Net Worth
```

Financial Core remains accounting authority. New domains consume data, do not replace accounting.

## IMPLEMENTATION OBJECTIVE — 10 Bounded Contexts

1. Wallet Identity Layer
2. Observation Layer (DeBank, Zerion, RPC)
3. Reconciliation Layer
4. External Asset Discovery
5. External Asset Mapping
6. Asset Registry Extension
7. Asset Network Management
8. RWA Domain
9. Valuation Engine
10. Wealth Aggregation Engine

---

## 1. Implementation Plan (Phased)

### Phase 0 — Verification (Done)

- Forensic audit of Financial Core tables, Ledger service postEntry single write path, FIFO lots, Market Data SSOT service.ts, Portfolio ledger-driven, Scenario Engine isolated.
- Existing assets, assetClasses, networks, currencies, wallets, accounts verified.
- No DeBank/Zerion code exists — clean slate.
- Documented compatibility: additive bounded contexts possible without core redesign.

### Phase 1 — Asset Registry Extension (Foundation)

**Why first:** All other domains depend on assets identity and classification.

- Extend `assetClasses` with parentId self-FK nullable, level integer, to support hierarchy Crypto -> Tokenized -> Gold -> Real Estate -> Apartment areas Kianpars etc., Vehicle Car, without duplicating identity.
- Seed new classes via service, not migration altering core.
- Ensure `assets` remains ONLY identity — no location, valuation, ownership in assets table.

**Tables Impact:** ALTER asset_classes ADD parentId FK asset_classes.id NULL, level INT — NOT Financial Core, allowed.

**Risk:** Low — nullable, existing rows parent NULL level 0.

### Phase 2 — Asset Network Management (Multi-Chain)

**Why second:** Token metadata needed for DeBank discovery and observation.

- Current `assets.networkId` single FK insufficient for USDT on Ethereum/Arbitrum/Base.
- Create `asset_networks` many-to-many: assetId FK assets NOT NULL, networkId FK networks NOT NULL, contractAddress text, chainId integer, decimals override, tokenStandard ERC20/SPL, isPrimary bool, UNIQUE(assetId, networkId, contractAddress)
- Extend `networks` with chainId, explorerUrl, rpcUrl, isEVM.
- Create `asset_token_metadata`: assetId UNIQUE FK assets, underlyingAssetId FK assets NULL (XAUT -> Gold), logoUri, coingeckoId, websiteUrl.

**Tables:** New isolated tables FK only assets, networks, currencies, users — no FK to Financial Core.

**Risk:** Low — additive, backfill from existing assets.networkId.

### Phase 3 — External Asset Discovery + Mapping (Safety Gate)

**Why third:** DeBank returns unknown tokens including spam/scam/dust — must NOT auto-INSERT into assets.

- Create `external_assets` discovery queue: id, providerName DEBANK/ZERION, rawSymbol, rawName, contractAddress, chainId, networkId FK networks NULL, decimals, tokenStandard, logoUri, explorerUrl, sourceMetadata JSONB, discoveryStatus pending_review|approved|rejected|ignored, discoveredAt, reviewedAt
- Create `external_asset_mappings`: id, externalAssetId FK external_assets CASCADE, internalAssetId FK assets NULLABLE, mappingStatus pending|verified|rejected, mappedAt, confidenceScore, mappingSource manual|auto, notes, UNIQUE(externalAssetId)
- Flow: Unknown Token -> Discovery -> Review Queue -> Mapping -> Asset Registry (only verified mappings connect to Asset Registry).

**Risk:** Critical if skipped — asset registry pollution. Mitigation: assetId NULLABLE in observed_positions, quarantine.

### Phase 4 — Wallet Identity Layer

**Purpose:** Store blockchain wallet address, network/chain, ownership relationship, user association, optional link to internal asset accounts — WITHOUT creating accounting transactions.

**Correct Example:** Wallet 0xABC Network Ethereum Owner User A Linked Ledger Account ETH Asset Account No accounting movement.

**Incorrect Example:** Import Wallet -> Create Buy Transaction -> Create Lot -> Increase Portfolio — forbidden.

- Create `wallet_identities`: id, userId FK users, address text NOT NULL lowercased, networkId FK networks, chainId integer, label text, walletType personal|external_research|protocol_treasury, ownershipCategory self_custody|external|research, isVerified bool, linkedAccountId FK accounts NULLABLE (optional, nullable, SET NULL, no CASCADE to avoid coupling, purpose only reference not ownership), UNIQUE(userId, address, networkId), INDEX(address)
- Service must NOT import postEntry/recordBuy/recordSell, must NOT create journal entries, lots, cost basis.

**Forbidden:** watch_wallets.accountId if that domain is external observation — but wallet_identity is identity domain, optional link allowed as soft reference, but to preserve Financial Core frozen, we make FK SET NULL and service never writes to accounts.

**Risk:** Medium — if linkedAccountId used to auto-create transactions, violation. Mitigation: lint rule forbids ledger imports.

### Phase 5 — Observation Layer (DeBank, Zerion, RPC)

**Implement blockchain observation as read-only infrastructure.**

- Supported providers: DeBank, Zerion, RPC Providers — observe external state, do NOT own financial truth.
- Architecture: External Provider -> Normalizer (sanitizes symbol, contract, decimals, quantity, price, validates) -> Observation Layer -> Reconciliation -> Dashboard — Forbidden DeBank -> Ledger

- Tables:
  - `observation_providers`: id, name UNIQUE DEBANK/ZERION/RPC, type api|rpc, config JSONB, isActive
  - `observation_runs`: id, walletIdentityId FK wallet_identities CASCADE, providerName, status pending/success/failed, startedAt, finishedAt, positionsCount, rawResponseSummary JSONB, errorMessage, createdAt
  - `observed_positions`: id, observationRunId FK observation_runs CASCADE, walletIdentityId FK wallet_identities CASCADE, networkId FK networks, assetId FK assets NULLABLE (if mapped), externalAssetId FK external_assets NULLABLE, rawSymbol, rawContractAddress, positionType token|lp|aave_supply|aave_borrow|pendle_pt|yt|staking|vault, protocol text, quantity numeric(38,18), cachedPriceUSD numeric, cachedValueUSD numeric, metadata JSONB, fetchedAt, snapshotDate date, INDEX(walletIdentityId, networkId)

- Normalizer: maps rawSymbol+contract+chainId -> internalAssetId via external_asset_mappings verified, or leaves assetId NULL and externalAssetId set for quarantine.

- Providers are stubs (no real API calls in this implementation phase to avoid keys) — structure only, with interface `fetchPositions(address, chains)`.

- **Critical Rule:** Observation Layer MUST NEVER WRITE TO Financial Core — no FK to accounts/journal_entries/postings/lots, no import of ledger service.

**Risk:** Critical if DeBank price used as market price SSOT — must store as cachedPriceUSD, not via recordManualPrice.

### Phase 6 — Reconciliation Engine (Reporting Only)

**Purpose:** Compare Internal Ledger State VS External Observed State — Example Ledger ETH 10 DeBank ETH 12 -> Difference +2 ETH Status Needs Review — Forbidden automatically create Buy 2 ETH — Reconciliation NEVER creates transactions.

- Tables:
  - `reconciliation_runs`: id, userId FK users, runType wallet_reconciliation|portfolio_reconciliation, status pending|completed, createdAt
  - `reconciliation_items`: id, reconciliationRunId FK reconciliation_runs CASCADE, walletIdentityId FK wallet_identities NULL, assetId FK assets NULL, externalAssetId FK external_assets NULL, ledgerQuantity, ledgerValue, observedQuantity, observedValue, differenceQuantity, differenceValue, status matched|difference|needs_review|external_only|ledger_only, resolutionStatus pending|reviewed|ignored, notes

- Service reads holdings from `getHoldings()` / `getAccountBalances()` (financial ownership) and observed_positions (observation), compares by wallet address + network + asset, reports difference.

- Must never call postEntry/recordBuy/recordSell.

**Risk:** Critical double count if aggregation directly sums without reconciliation — mitigation via intermediate layer.

### Phase 7 — RWA Domain (Real Estate, Vehicle, Gold)

**RWA must contain Identity, Ownership, Valuation as separate concepts, not single price field.**

- Identity: `real_estate_properties` table already concept: id, assetId FK assets UNIQUE NOT_NULL, userId FK users, propertyType apartment|house|land|commercial, city Ahvaz, area ENUM Kianpars/Golestan/Shahrak Daneshgah/Padad/Kianabad/Zeytoon, address, sizeSqm, floor, yearBuilt, deedNumber, notes — location metadata, not asset identity.
- Vehicle: `vehicle_assets` assetId UNIQUE FK assets, brand, model, year, licensePlate, chassisNumber, mileage, notes
- Ownership: `rwa_ownership_records` id, assetId FK assets, userId FK users, ownershipPercentage numeric(5,2), ownershipType full|partial|partnership|inherited|mortgaged, acquisitionDate, acquisitionPriceIRR/USD, debtId FK debts NULLABLE (mortgage), isActive, notes — because ownership may be 100% owner, 50% partner, inherited, mortgaged, debt attached.
- Valuation: `rwa_valuation_events` or generic `valuation_events`: id, assetId FK assets, valuationDate date NOT NULL, priceIRR, priceUSD, valuationSource manual|appraisal|market_estimate|spot, appraiser, note, sourceId FK market_price_sources NULL, createdAt — example Apartment Purchase 50B, 2027 Appraisal 80B, 2028 Market Estimate 110B are valuation events, not one price field.

- Price history: On valuation event, also call `recordManualPrice()` via marketData service to store in market_snapshots for SSOT historical tracking, but RWA side tables own metadata.

- Isolated from ledger: No FK to accounts/journal/postings/lots — purchase may optionally create ledger entry via recordBuy if user wants owned asset in net worth via ledger, but appraisal updates must NOT create ledger entries.

### Phase 8 — Valuation Engine

**Implement valuation as separate domain, do not mix price with valuation. Different assets require different policies: Crypto Market Price, Gold Spot Price, Real Estate Appraisal, Private Equity Manual Valuation.**

- Architecture: Asset -> Valuation Source -> Valuation Event -> Valuation Engine
- Tables:
  - `valuation_sources`: id, assetId FK assets UNIQUE?, sourceType market_price|spot_price|appraisal|manual|book_value, primaryProviderName COINGECKO|TSETMC|MANUAL|APPRAISAL, isActive, config JSONB
  - Reuse `rwa_valuation_events` or generic `valuation_events` as events
- Service `valuationEngine` selects latest valuation event per policy, returns current valuation.

- Must READ market data SSOT, RWA valuation events, manual sources, but not write ledger.

### Phase 9 — Wealth Aggregation Engine

**Implement Net Worth calculation as aggregation only, not accounting source.**

- Architecture: Ledger -> Owned Asset Valuation, RWA -> RWA Valuation, Observation -> Observed Valuation -> Wealth Aggregation -> Net Worth

- Aggregation must be read only, not own financial data, not write into Ledger, not create transactions.

- Ownership Resolution required between Financial Assets + Self Watch Assets + RWA Assets -> Ownership Resolution -> Final Net Worth instead of directly summing, to prevent 3 ETH ledger + 3 ETH watch = 6 ETH double count.

- Tables:
  - `wealth_aggregation_runs`: id, userId FK users, asOf date, totalOwnedUSD, totalOwnedIRR, totalRWAUSD, totalRWAIRR, totalObservedUSD, totalObservedIRR, netWorthUSD, netWorthIRR, breakdown JSONB, createdAt
  - Optional `wealth_aggregation_lines` per asset breakdown

- Service reads portfolio valuation (owned), RWA valuation events (RWA), observed positions filtered self_watch (observed), runs through reconciliation (deduplication by wallet address + asset), produces aggregated view.

---

## 2. Domain Boundaries

- **Wallet Identity Layer:** Owns wallet address, network, chain, ownership relationship, user association. May have optional link to internal asset accounts via nullable FK SET NULL, but MUST NOT create accounting transactions. Owner: walletIdentity domain.

- **Observation Layer:** Owns external observation cache (observed_positions, observation_runs, observation_providers). Reads wallet identities, assets, networks. Writes only own tables. Never writes Financial Core, never imports ledger service. Owner: observation domain.

- **Reconciliation Layer:** Owns reconciliation runs and items. Reads ledger holdings (via portfolio/ledger queries) + observed positions. Reports difference. Never creates accounting transactions. Owner: reconciliation domain.

- **External Asset Discovery:** Owns external_assets discovery queue. Reads from observation layer raw tokens. Writes own table. Owner: externalAssets domain.

- **External Asset Mapping:** Owns external_asset_mappings. Reads external_assets + assets. Maps after manual approval. Owner: mapping domain.

- **Asset Registry Extension:** Owns assets identity (existing) plus asset_classes hierarchy parentId, asset_networks many-to-many, asset_token_metadata. Only asset registry service may write assets, asset_classes, asset_networks. Owner: assetRegistry domain.

- **RWA Domain:** Owns real_estate_properties, vehicle_assets, ownership_records, valuation_events (RWA specific). Reads assets, networks, currencies, market data. Writes only own tables plus calls recordManualPrice for price history via market data service (not direct table write). Owner: RWA domain.

- **Valuation Engine:** Owns valuation_sources, valuation_events (generic). Reads market_snapshots, market_prices, RWA valuation events. Produces valuation. Owner: valuation domain.

- **Wealth Aggregation Engine:** Owns aggregation runs, calculated views only. Reads owned asset valuation (portfolio), RWA valuation, observed valuation, reconciliation results. Produces net worth. Never writes ledger. Owner: aggregation domain.

---

## 3. New Modules Required (Folder Structure)

```
src/features/
  walletIdentity/
    service.ts
    types.ts
    validators.ts
    identity/
      walletIdentities.ts

  observation/
    service.ts
    types.ts
    providers/
      debankProvider.ts
      zerionProvider.ts
      rpcProvider.ts
      index.ts (ProviderRegistry)
    normalizer.ts

  reconciliation/
    service.ts
    types.ts
    engine/
      walletReconciliation.ts

  externalAssets/
    discovery/
      service.ts
      types.ts
    mapping/
      service.ts
      types.ts

  assetRegistry/
    service.ts
    types.ts
    assetClasses/
      hierarchy.ts
    assetNetworks/
      service.ts
      types.ts

  rwa/
    realEstate/
      service.ts
      types.ts
      validators.ts
    vehicle/
      service.ts
      types.ts
    ownership/
      service.ts
      types.ts
    valuation/
      service.ts
      types.ts

  valuation/
    service.ts
    types.ts
    sources/
      valuationSources.ts
    engine/
      valuationEngine.ts

  aggregation/
    service.ts
    types.ts
    engine/
      wealthAggregationEngine.ts
      ownershipResolution.ts

Existing preserved:
  ledger/ (frozen)
  marketData/ (SSOT writer)
  portfolio/ (ledger-driven)
  scenarios/ (isolated)
  analytics/ (read-only)
  setup/, planning/, import/
```

---

## 4. Database Impact

**Financial Core Tables — FROZEN, NO ALTER, NO FK FROM NEW DOMAINS:**

- journal_entries
- postings
- accounts (existing FK wallets.id allowed, but new domains must NOT add FK to accounts from observation/reconciliation — walletIdentity optional link is exception but SET NULL, not CASCADE, and service never writes accounts)
- lots
- lot_consumptions

**Reference Tables — Allowed Additive Alter (nullable, low risk):**

- asset_classes: ADD parentId UUID FK asset_classes.id NULL, level integer DEFAULT 0, attributesSchema JSONB NULL — self-FK for hierarchy Kianpars etc. as area? Actually area should NOT be asset class per audit, but hierarchy for Crypto -> Tokenized -> Gold etc. is valid.
- networks: ADD chainId integer UNIQUE NULL, rpcUrl text NULL, explorerUrl text NULL, isEVM boolean DEFAULT true, isTestnet boolean DEFAULT false — supports Ethereum, Arbitrum, Plasma, Solana, HyperEVM, Base, BSC

**New Isolated Tables — FK Only assets, networks, currencies, users, wallet_identities, external_assets — NO FK to accounts, journal_entries, postings, lots:**

- wallet_identities (userId FK users, networkId FK networks, linkedAccountId FK accounts NULLABLE SET NULL, address, chainId, label, walletType, isVerified, UNIQUE(userId, address, networkId))
- observation_providers
- observation_runs (walletIdentityId FK wallet_identities CASCADE)
- observed_positions (observationRunId CASCADE, walletIdentityId CASCADE, networkId FK networks, assetId FK assets NULLABLE, externalAssetId FK external_assets NULLABLE)
- external_assets (networkId FK networks, discoveryStatus)
- external_asset_mappings (externalAssetId CASCADE, internalAssetId FK assets NULLABLE)
- asset_networks (assetId FK assets, networkId FK networks, contractAddress, chainId, UNIQUE(assetId, networkId, contractAddress))
- asset_token_metadata (assetId UNIQUE FK assets, underlyingAssetId FK assets NULL, logoUri, coingeckoId)
- real_estate_properties (assetId UNIQUE FK assets, userId FK users, city, area ENUM Kianpars/Golestan/Shahrak Daneshgah/Padad/Kianabad/Zeytoon, sizeSqm, etc.)
- vehicle_assets (assetId UNIQUE FK assets, brand, model, year, etc.)
- rwa_ownership_records (assetId FK assets, userId FK users, ownershipPercentage, ownershipType, debtId FK debts NULLABLE)
- rwa_valuation_events / valuation_events (assetId FK assets, valuationDate, priceIRR/USD, source, appraiser)
- valuation_sources (assetId FK assets UNIQUE, sourceType, primaryProviderName)
- reconciliation_runs (userId FK users) + reconciliation_items (reconciliationRunId CASCADE, walletIdentityId FK wallet_identities NULL, assetId FK assets NULL)
- wealth_aggregation_runs (userId FK users, breakdown JSONB)

**Migrations:** All CREATE TABLE IF NOT EXISTS, no ALTER of Financial Core. Existing `src/db/init-schema.ts` already has pattern.

**Risk:** Low — additive, nullable, IF NOT EXISTS, existing tests use PGlite createSchemaIfNotExists() loop — new tables auto-created.

---

## 5. Dependency Graph (Allowed / Forbidden)

```
External Providers (DeBank, Zerion, RPC, CoinGecko, TSETMC, Gold API)
        |
        | fetch
        v
+-------------------+      +-------------------+      +-------------------+
| Market Data       |      | DeFi Watcher      |      | Wallet Identity   |
| Providers         |      | Providers         |      |                   |
| (coingecko,       |      | (debank, zerion)  |      | Stores address,   |
|  tsetmc, gold)    |      |                   |      | network, owner,   |
+-------------------+      +-------------------+      | optional account  |
        | fetch PriceQuote          | fetch Positions          | link (soft)
        |                           |                          |
        v                           v                          v
+-------------------+      +-------------------+      +-------------------+
| Market Data       |<-----| Normalizer        |<-----| wallet_identities |
| External Service  |      | (sanitize, map)   |      | (identity)        |
| (aggregates       |      +-------------------+      +-------------------+
|  price providers) |               |
        |                           | observed_positions cache
        | recordExternalPrice()     v
        | (only writer)    +-------------------+
        v                  | Observation Layer |----> Reconciliation Layer
+-------------------+      | (observed_        |      (compare ledger vs
| Market Data SSOT  |      |  positions, runs) |       observed, report diff)
| service.ts        |      +-------------------+               |
| market_prices     |               |                          |
| market_snapshots  |               |                          v
| prices            |               |                +-------------------+
+-------------------+               |                | External Asset    |
        | READ                      |                | Discovery + Mapping
        |--------------------------------------------| external_assets,
        |               |                 |          | external_mappings
        v               v                 v          +-------------------+
+---------------+ +---------------+ +---------------+          |
| Portfolio     | |   Scenario    | |     RWA       |          v
| (ledger-      | |   Engine      | |  Domain       |   +---------------+
|  driven)      | |  (read-only)  | | (metadata,    |   | Asset Registry  |
| holdings      | |               | |  ownership,   |   | Extension       |
| + market      | |               | |  valuation)   |   | asset_classes   |
|   price)      | |               | |               |   | hierarchy,      |
+---------------+ +---------------+ +---------------+   | asset_networks  |
        |               |                 |              | token metadata  |
        |               |                 |              +---------------+
        |------------------------------------------------------|
        |               |                 |
        v               v                 v
        +---------------------------------+
        |  Valuation Engine               |
        |  Asset -> Source -> Event ->    |
        |  Engine (market, appraisal,     |
        |  manual, spot)                  |
        +---------------------------------+
                        |
                        v
        +---------------------------------+
        |  Wealth Aggregation Engine      |
        |  Ledger Owned Valuation +       |
        |  RWA Valuation +                |
        |  Observed Valuation (self_watch)|
        |  -> Ownership Resolution ->     |
        |  Net Worth (read-only)          |
        +---------------------------------+
                        |
                        v
                    Net Worth

Allowed Dependencies:
  Aggregation -> Portfolio, Aggregation -> Valuation, Aggregation -> Reconciliation, Aggregation -> Observation (self_watch only), Portfolio -> Ledger (queries), Portfolio -> Market Data (getMarketPrices), Analytics -> Portfolio, Analytics -> Ledger (capitalFlows), Scenarios -> Market Data, Scenarios -> Assets, Scenarios -> Benchmark, Observation -> Wallet Identity, Observation -> Assets/Networks, Observation -> Market Data READ (for price comparison only, not write), Reconciliation -> Ledger READ (holdings), Reconciliation -> Observation READ, RWA -> Market Data WRITE via recordManualPrice() ONLY (for price history), RWA -> Assets READ, Valuation -> Market Data READ + RWA valuation events READ, Wallet Identity -> Networks READ, Wallet Identity -> Accounts READ (optional link, nullable).

Forbidden Dependencies:
  Ledger -> Aggregation, Ledger -> Observation, Ledger -> Scenarios, Ledger -> Market Data, Market Data -> Ledger, Market Data -> Portfolio, Portfolio -> Analytics, Portfolio -> Scenarios, Observation -> Ledger WRITE (postEntry, recordBuy, recordSell), Observation -> Accounts FK, Observation -> journal_entries FK, Observation -> postings FK, Observation -> lots FK, Reconciliation -> Ledger WRITE (auto buy), DeBank -> Ledger, Zerion -> Ledger, DeBank -> Market Data WRITE (price), Zerion -> Market Data WRITE if DeBank price used.

```

---

## 6. Financial Core Protection Verification (Pre-Implementation Checklist)

- [x] No migration alters journal_entries, postings, accounts, lots, lot_consumptions structure — verified init-schema.ts additions are CREATE TABLE IF NOT EXISTS for new tables only, no ALTER of core.
- [x] No new FK from external observation domains (observation, reconciliation, external_assets) into accounts, journal_entries, postings, lots — verified via schema review: observation_runs FK wallet_identities CASCADE, observed_positions FK wallet_identities CASCADE + networkId + assetId NULLABLE + externalAssetId NULLABLE — no FK to accounts/journal/postings/lots.
- [x] No import of postEntry, recordBuy, recordSell in observation, reconciliation, externalAssets, assetRegistry, rwa, valuation, aggregation services — will enforce via grep + lint rule.
- [x] Portfolio remains ledger-driven: getHoldings() sums postings, getPortfolioValuation() reads holdings + openLots + marketPrices — no change.
- [x] Market Data remains SSOT: Only service.ts writes market_prices/market_snapshots/prices — observation providers return PriceQuote but do not write, externalService calls recordManualPrice via service.ts (only writer).
- [x] Scenario Engine remains isolated: No change to scenario tables FK pattern.
- [x] RWA purchase may optionally create ledger entry via recordBuy() only if user explicitly creates acquisition transaction through existing TransactionForm (owned asset flow) — appraisal updates must NOT call recordBuy, only recordManualPrice.
- [x] Existing tests: market-data.test.ts proves market price update does NOT create journal_entries/postings, ledger balances unchanged; analytics-layer.test.ts proves analytics never creates journal/postings; scenario-engine.test.ts proves scenario creation/execution does NOT modify postings/portfolio_snapshots/market_prices, uses SSOT — all must remain green after new domains.
- [x] Wallet Identity optional link to accounts is nullable SET NULL, not CASCADE, service never creates accounting movement — wallet identity is identity, not accounting replacement.

**Verification Method After Implementation:**

- Run `grep -rn "postEntry\|recordBuy\|recordSell" src/features/observation/ src/features/reconciliation/ src/features/externalAssets/ src/features/walletIdentity/ src/features/rwa/ src/features/valuation/ src/features/aggregation/ src/features/assetRegistry/` must return zero (except comments about forbidden).
- Run `grep -rn "accounts\|journal_entries\|postings\|lots" src/db/schema.ts | grep -E "observation|watch|reconciliation|external_asset|real_estate|vehicle|rwa|valuation|aggregation"` must show no FK to those core tables.
- Run existing test suites: `npx tsx --test tests/market-data.test.ts tests/analytics-layer.test.ts tests/portfolio-valuation.test.ts tests/scenario-engine.test.ts` must pass.

---

## 7. Risk Assessment

### Critical Risks (Must Mitigate Before Merge)

1. Double Counting 3 ETH Ledger + 3 ETH Watch = 6 ETH — Mitigation: Ownership Resolution intermediate layer between Financial Assets + Self Watch + RWA -> Final Net Worth, matching by wallet address + network + asset, classification Already Accounted / Not Yet Accounted / External Research, deduplication, flagging. Never direct sum.

2. Asset Registry Pollution via Spam Tokens — Mitigation: external_assets discovery queue with status pending_review, external_asset_mappings with verified status, observed_positions.assetId NULLABLE, quarantine until manual approval.

3. Price SSOT Conflict DeBank value as price — Mitigation: observation cachedPriceUSD named observedPriceUSD/cache, never via recordManualPrice, price providers chain only CoinGecko primary + Zerion backup -> marketData/service.ts.

4. Financial Core Contamination via FK or auto buy — Mitigation: No FK from observation domains into accounts/journal_entries/postings/lots, lint rule no-restricted-imports forbids ledger service in watcher/reconciliation.

### High Risks

- External Research Wallet Leakage into Personal Net Worth — Mitigation: wallet_identities.walletType self vs external_research discriminator, all personal net worth queries filter self_watch, research dashboard separate.
- Token Analytics Cost Misrepresentation for Watch-Only — Mitigation: Watch-only displays Holdings Value, Quantity, Current Price only, not Total Cost/Avg Net Cost/Unrealized P/L (which require lots). Owned assets via ledger show cost/PnL, RWA via purchase price valuation.

### Medium Risks

- Folder structure scalability — missing asset registry service centralizing writes to assets table — Mitigation: create assetRegistry/service.ts as explicit owner.
- Two snapshot tables duplication legacy snapshots vs portfolio_snapshots — Mitigation: document legacy vs new, prefer portfolio_snapshots for new.
- Market Data provider registry missing — Mitigation: create providers/index.ts ProviderRegistry.

### Low Risks

- UI boundary RTL Persian Shamsi calendar — already separated in lib/format.ts, domain uses ISO.

---

## IMPLEMENTATION ORDER (Incremental After Approval)

1. Asset Registry Extension (parentId hierarchy, asset_networks, asset_token_metadata)
2. External Asset Discovery + Mapping (safer gate before observation)
3. Wallet Identity Layer
4. Observation Layer (DeBank, Zerion, RPC stubs + normalizer)
5. Reconciliation Layer (report differences, never auto-buy)
6. RWA Domain (real_estate, vehicle, ownership, valuation_events)
7. Valuation Engine (source -> event -> engine)
8. Wealth Aggregation Engine (with ownership resolution)

Each phase additive, IF NOT EXISTS tables, no core alteration, tests green.

---

## FINAL PRINCIPLE

Transform current application into Enterprise Personal Wealth Operating System WITHOUT breaking Accounting Core, WITHOUT double counting assets, WITHOUT mixing observation with ownership, WITHOUT corrupting Asset Registry, WITHOUT creating hidden dependencies. Financial Core remains unchanged. New capabilities are added around it. Architecture boundaries are mandatory.
