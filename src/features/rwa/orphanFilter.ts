/**
 * Presentation-layer predicate for an orphaned real-world asset.
 *
 * An orphan is an `assets` row in class RWA whose registry identity is gone
 * (no `real_estate_properties`, no `vehicle_assets`, no active ownership)
 * while `deleted_at` is still NULL — typically after a property-only delete.
 *
 * READ MODELS use this to hide the ghost from holdings, reports, activity
 * and identifier generation. It NEVER mutates journal_entries, postings,
 * lots, lot_consumptions or any other accounting primitive.
 */
import { type SQL, sql } from "drizzle-orm";

function col(alias: string, column: string): SQL {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error("invalid SQL identifier");
  }
  return sql.raw(`${alias}.${column}`);
}

/** True when `alias` is a compact/legacy RWA identity with no live registry row. */
export function isOrphanedRwaAsset(alias: string): SQL {
  return sql`(
    exists (
      select 1 from asset_classes ac_orphan
      where ac_orphan.id = ${col(alias, "class_id")}
        and ac_orphan.code = 'RWA'
    )
    and (${col(alias, "symbol")} ~ '^[0-9]+$' or ${col(alias, "symbol")} ~ '^RE-')
    and ${col(alias, "symbol")} <> 'USD'
    and ${col(alias, "symbol")} not like '__del_%'
    and not exists (select 1 from real_estate_properties rep where rep.asset_id = ${col(alias, "id")})
    and not exists (select 1 from vehicle_assets va where va.asset_id = ${col(alias, "id")})
    and not exists (
      select 1 from rwa_ownership_records rwo
      where rwo.asset_id = ${col(alias, "id")} and rwo.is_active = true
    )
  )`;
}

/** Same predicate when `asset_classes` is already joined under `classAlias`. */
export function isOrphanedRwaAssetWithClass(assetAlias: string, classAlias: string): SQL {
  return sql`(
    ${col(classAlias, "code")} = 'RWA'
    and (${col(assetAlias, "symbol")} ~ '^[0-9]+$' or ${col(assetAlias, "symbol")} ~ '^RE-')
    and ${col(assetAlias, "symbol")} <> 'USD'
    and ${col(assetAlias, "symbol")} not like '__del_%'
    and not exists (select 1 from real_estate_properties rep where rep.asset_id = ${col(assetAlias, "id")})
    and not exists (select 1 from vehicle_assets va where va.asset_id = ${col(assetAlias, "id")})
    and not exists (
      select 1 from rwa_ownership_records rwo
      where rwo.asset_id = ${col(assetAlias, "id")} and rwo.is_active = true
    )
  )`;
}

/** Soft-deleted OR orphaned — the two states a read model must treat as inactive. */
export function isInactiveOrOrphanedRwaAsset(alias: string): SQL {
  return sql`(${col(alias, "deleted_at")} is not null or ${isOrphanedRwaAsset(alias)})`;
}

/**
 * True when a journal entry has at least one posting whose asset is a
 * deleted or orphaned RWA identity. Used to hide the entry from activity /
 * financial-history views without touching the ledger row.
 */
export function entryReferencesInactiveRwa(entryIdSql: SQL): SQL {
  return sql`exists (
    select 1 from postings p_rwa_ghost
    join assets ast_rwa_ghost on ast_rwa_ghost.id = p_rwa_ghost.asset_id
    where p_rwa_ghost.entry_id = ${entryIdSql}
      and ${isInactiveOrOrphanedRwaAsset("ast_rwa_ghost")}
  )`;
}
