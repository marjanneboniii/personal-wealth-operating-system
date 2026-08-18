# Pre-Implementation Impact Audit — Existing IRT→USD Conversion × Account Denomination / FX Journal

**Verdict: SAFE WITH REQUIRED CHANGES**

No schema migration. Reuse `getLatestUsdIrtRateForUser` + `entry_fx_snapshots`. Do not duplicate conversion. Do not change `assertBalanced` / FIFO / historical `base_value`.

## Existing conversion (must keep)

| Piece | Role |
|---|---|
| `SmartAmountPreview` + `useLatestRate` | UI preview only |
| `format.ts` `irtToUsd` | Pure display math |
| `/api/fx/latest` + `lib/fx.ts` | Live rate for preview |
| `createTransactionAction` | **Authoritative** IRT→USD via **server** `getLatestUsdIrtRateForUser`; writes `base_value` as USD; freezes `entry_fx_snapshots` |
| `registerMoneyAccount` | Opening IRT → USD `base_value` with same rate helper |

UI rate is not trusted for posting. Snapshot is immutable. FIFO is not used on money openings.

## Required changes (this implementation)

1. `recordTransfer`: reject when from/to `assetId` differ.
2. New `recordFx`: two native legs, USD `base_value`, no lots.
3. `createTransactionAction` + API: route mixed-denomination transfers to `recordFx`.
4. UI labels: denomination vs book USD; mixed-transfer hint.

## FIFO / history / production

Unchanged meaning of `base_value`. Same-currency users unchanged. No migration.
