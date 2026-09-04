/**
 * Real-estate VISIBILITY diagnosis — «چرا ملک من در ماژول دارایی‌های واقعی دیده نمی‌شود؟»
 *
 * The املاک section of `/asset-registry` never reads the `assets` table directly.
 * It reads `real_estate_properties` through `loadProperties()`
 * (see src/features/rwa/realEstate/service.ts), whose filter is:
 *
 *     FROM real_estate_properties p
 *     INNER JOIN assets a ON a.id = p.asset_id
 *     WHERE p.user_id = <session user id>     -- tenant scoping (SECURITY, H-01)
 *       AND a.deleted_at IS NULL              -- soft-deleted assets are gone
 *
 * So a row can be present in the database and still be invisible for a small,
 * enumerable set of reasons. This module reproduces that predicate and labels
 * each row with the reason, so an operator can tell "your data is gone" apart
 * from "your data is there but scoped away" without guessing.
 *
 * PURE + READ-ONLY: it takes a query runner, issues SELECTs only, and never
 * mutates a property, an asset, a snapshot, or any accounting primitive.
 */

export type QueryRunner = (sqlText: string) => Promise<Record<string, any>[]>;

export type PropertyInventoryRow = {
  id: string;
  asset_id: string | null;
  symbol: string | null;
  asset_name: string | null;
  asset_deleted_at: string | Date | null;
  user_id: string | null;
  created_at: string | Date | null;
  purchase_price_toman: string | null;
  current_value_toman: string | null;
  ledger_entry_id: string | null;
  city_id: string | null;
};

export type Verdict =
  /** rendered by the module */
  | "VISIBLE"
  /** `user_id IS NULL` → predates multi-user, belongs to no tenant */
  | "HIDDEN_NO_OWNER"
  /** owned by a different user id */
  | "HIDDEN_OTHER_TENANT"
  /** `assets.deleted_at` set → deleted, sold, or orphan-repaired */
  | "HIDDEN_ASSET_SOFT_DELETED"
  /** the linked `assets` row is gone (breaks the NOT NULL + FK invariant) */
  | "HIDDEN_ASSET_MISSING";

/**
 * The exact visibility rule of the module, as a pure function — kept next to
 * `loadProperties()` in intent: change one, change the other.
 */
export function classify(row: PropertyInventoryRow, tenantId: string | null): Verdict {
  if (!row.asset_id) return "HIDDEN_ASSET_MISSING";
  if (row.asset_deleted_at) return "HIDDEN_ASSET_SOFT_DELETED";
  if (row.user_id === null || row.user_id === undefined) return "HIDDEN_NO_OWNER";
  if (tenantId !== null && row.user_id !== tenantId) return "HIDDEN_OTHER_TENANT";
  return "VISIBLE";
}

/** Plain-language meaning + the only safe remediation for each verdict. */
export const VERDICT_INFO: Record<Verdict, { fa: string; fix: string }> = {
  VISIBLE: { fa: "در بخش «املاک من» نمایش داده می‌شود", fix: "" },
  HIDDEN_NO_OWNER: {
    fa: "هیچ مالکی ندارد (real_estate_properties.user_id = NULL) — رکورد پیش از حالت چندکاربرینه ساخته شده و عمداً به هیچ tenant داده نمی‌شود",
    fix:
      "با مهاجرت آگاهانهٔ تک‌بار مالکیت را منتقل کنید: PWOS_ALLOW_LEGACY_CLAIM=true npm run db:legacy-claim " +
      "(فقط وقتی دقیقاً یک کاربر با نقش owner وجود دارد اجرا می‌شود؛ بعد از موفقیت، فلگ را حذف کنید).",
  },
  HIDDEN_OTHER_TENANT: {
    fa: "به شناسهٔ کاربر دیگری وابسته است — یعنی با آن حساب ثبت شده، نه این حساب",
    fix:
      "با همان حسابی که ملک را ثبت کرده‌اید وارد شوید. دو حساب (مثلاً یکی Google و یکی نام‌کاربری) عمداً داده‌ها را " +
      "به اشتراک نمی‌گذارند؛ انتقال مالکیت فقط از مسیر یک مهاجرت صریح و قابل ممیزی انجام می‌شود.",
  },
  HIDDEN_ASSET_SOFT_DELETED: {
    fa: "ردیف دارایی soft-delete شده است (assets.deleted_at پر است) — حذف ملک، فروش ملک، یا پاک‌سازی دارایی یتیم",
    fix:
      "سند دفترکل و تاریخچه دست‌نخورده‌اند. برای بازگرداندن باید صریحاً assets.deleted_at = NULL شود و بررسی شود " +
      "که شناسهٔ کوتاه آزادشده (۰۰۱/۰۰۲…) به دارایی دیگری نچسبیده باشد. (مسیرهای ایجادکننده: deleteRealEstateAsset، " +
      "sellRealEstateAsset، repairOrphanedRealEstate)",
  },
  HIDDEN_ASSET_MISSING: {
    fa: "ردیف دارایی (assets) وجود ندارد — یکپارچگی داده نقض شده",
    fix: "ثبت ملک بدون asset ممکن نیست (asset_id NOT NULL + FK). بازگردانی از restore point تنها راه امن است.",
  },
};

export type GhostAsset = {
  id: string;
  symbol: string | null;
  name: string | null;
  class_name: string | null;
};

export type TenantReport = {
  user: { id: string | null; name?: string | null; username?: string | null; email?: string | null; role?: string | null };
  visibleCount: number;
  hidden: { verdict: Verdict; row: PropertyInventoryRow }[];
  /** «واقعی» assets (per splitAssetFamilies) with no real_estate_properties row */
  ghostAssets: GhostAsset[];
};

export type VisibilityReport = {
  users: any[];
  tenants: TenantReport[];
  unownedPropertyCount: number;
  totalProperties: number;
  snapshotOwnerMismatches: number;
  /** recent audit evidence for the destructive/reparative actions that hide rows */
  auditEvents: any[];
  masterData: { cities: number; citiesActive: number; neighborhoods: number; propertyTypes: number } | null;
  notes: string[];
};

async function tableExists(q: QueryRunner, name: string): Promise<boolean> {
  const rows = await q(
    `select 1 as ok from information_schema.tables
      where table_schema = 'public' and table_name = '${name.replace(/[^a-z_]/g, "")}' limit 1`,
  );
  return rows.length > 0;
}

/**
 * Build the report. `userId` narrows the tenant section (username, email or
 * uuid accepted); without it every account is reported, because "the data is
 * on another account" is one of the actual causes.
 */
export async function buildVisibilityReport(
  q: QueryRunner,
  opts: { userIdentity?: string | null } = {},
): Promise<VisibilityReport> {
  const notes: string[] = [];
  const hasProps = await tableExists(q, "real_estate_properties");
  const hasAssets = await tableExists(q, "assets");
  if (!hasProps || !hasAssets) {
    notes.push(
      "جدول real_estate_properties یا assets در این بانک وجود ندارد؛ در نتیجه خودِ بخش املاک هم نمی‌تواند رندر شود. " +
        "اول `npm run db:migrate` را اجرا کنید (یا یک‌بار صفحه را باز کنید تا ensureSchemaOnce جدول را بسازد).",
    );
    return {
      users: [],
      tenants: [],
      unownedPropertyCount: 0,
      totalProperties: 0,
      snapshotOwnerMismatches: 0,
      auditEvents: [],
      masterData: null,
      notes,
    };
  }

  const hasUsers = await tableExists(q, "users");
  const users = hasUsers
    ? await q(
        `select id, name, role, username, email, google_id, created_at,
                (password_hash is not null) as has_password
           from users where deleted_at is null order by created_at`,
      )
    : [];

  const props = (await q(
    `select p.id, p.asset_id, a.symbol, a.name as asset_name, a.deleted_at as asset_deleted_at,
            p.user_id, p.created_at, p.purchase_price_toman, p.current_value_toman,
            p.ledger_entry_id, p.city_id
       from real_estate_properties p
       left join assets a on a.id = p.asset_id
      order by p.created_at desc`,
  )) as PropertyInventoryRow[];

  // An asset that the portfolio read model counts as a REAL asset (so it shows
  // under «دارایی‌های واقعی» on /assets) while having no property row at all:
  // the املاک module can never list it. That is the "counted there, missing here" case.
  const vehicleClause = (await tableExists(q, "vehicle_assets"))
    ? "and not exists (select 1 from vehicle_assets va where va.asset_id = a.id)"
    : "";
  const ownershipClause = (await tableExists(q, "rwa_ownership_records"))
    ? "and not exists (select 1 from rwa_ownership_records ro where ro.asset_id = a.id and ro.is_active = true)"
    : "";
  // Cash-currency assets (USD/IRT) can share the «دارایی واقعی» class label in
  // half-seeded databases; they are money, not property, and never belong here.
  const currencyClause = (await tableExists(q, "currencies"))
    ? "and not exists (select 1 from currencies c where upper(c.code) = upper(a.symbol))"
    : "";
  const ghostAssets = (await q(
    `select a.id, a.symbol, a.name, ac.name as class_name
       from assets a
       join asset_classes ac on ac.id = a.class_id
      where a.deleted_at is null
        and (ac.code = 'RWA' or ac.name in ('املاک','دارایی واقعی','مستغلات','طلا','کالا','خودرو'))
        ${currencyClause}
        and not exists (select 1 from real_estate_properties rep where rep.asset_id = a.id)
        ${vehicleClause}
        ${ownershipClause}
      order by a.created_at desc limit 50`,
  )) as GhostAsset[];

  let snapshotOwnerMismatches = 0;
  if (await tableExists(q, "real_estate_valuation_snapshots")) {
    // loadSnapshotsByProperty() scopes snapshots by the SNAPSHOT's own user_id.
    // A drifted/NULL snapshot owner leaves «تاریخچه ارزش‌گذاری» empty even for a
    // property that is listed.
    const rows = await q(
      `select count(*)::int as n
         from real_estate_valuation_snapshots s
         join real_estate_properties p on p.id = s.property_id
        where (s.user_id is null and p.user_id is not null)
           or (s.user_id is not null and p.user_id is distinct from s.user_id)`,
    );
    snapshotOwnerMismatches = Number(rows[0]?.n ?? 0);
  }

  const auditEvents = (await tableExists(q, "audit_log"))
    ? await q(
        `select created_at, action, entity_type, entity_id, user_id,
                left(coalesce(payload, metadata, ''), 240) as detail
           from audit_log
          where action in ('CREATE_REAL_ESTATE_ASSET','REVALUE_REAL_ESTATE_ASSET','SELL_REAL_ESTATE_ASSET',
                           'DELETE_REAL_ESTATE_ASSET','REPAIR_ORPHANED_RWA_ASSET','LEGACY_OWNER_CLAIM','RESTORE')
          order by created_at desc limit 25`,
      )
    : [];

  let masterData: VisibilityReport["masterData"] = null;
  if ((await tableExists(q, "cities")) && (await tableExists(q, "neighborhoods")) && (await tableExists(q, "property_types"))) {
    const row = (
      await q(
        `select (select count(*) from cities)::int as cities,
                (select count(*) from cities where is_active = true)::int as cities_active,
                (select count(*) from neighborhoods)::int as neighborhoods,
                (select count(*) from property_types)::int as property_types`,
      )
    )[0];
    masterData = {
      cities: Number(row?.cities ?? 0),
      citiesActive: Number(row?.cities_active ?? 0),
      neighborhoods: Number(row?.neighborhoods ?? 0),
      propertyTypes: Number(row?.property_types ?? 0),
    };
    if (masterData.citiesActive === 0 || masterData.neighborhoods === 0 || masterData.propertyTypes === 0) {
      notes.push("داده پایه خالی است → فرم «ثبت ملک» گزینه‌ای برای انتخاب ندارد و ثبت جدید عملاً ممکن نیست.");
    }
  }

  const wanted = (opts.userIdentity ?? "").trim().toLowerCase();
  const matched = wanted
    ? users.filter(
        (u: any) =>
          String(u.id).toLowerCase() === wanted ||
          String(u.username ?? "").toLowerCase() === wanted ||
          String(u.email ?? "").toLowerCase() === wanted,
      )
    : users;
  if (wanted && matched.length === 0) {
    notes.push(`حسابی با «${opts.userIdentity}» پیدا نشد؛ گزارش برای همه حساب‌ها نمایش داده می‌شود.`);
  }

  const scopeUsers: any[] = matched.length
    ? matched
    : [{ id: null, name: "(هیچ حساب کاربری ثبت نشده — حالت تک‌مالکی)" }];
  const tenants: TenantReport[] = scopeUsers.map((user: any) => {
    const hidden: { verdict: Verdict; row: PropertyInventoryRow }[] = [];
    let visibleCount = 0;
    for (const row of props) {
      const verdict = classify(row, user.id ?? null);
      if (verdict === "VISIBLE") visibleCount++;
      else hidden.push({ verdict, row });
    }
    return {
      user,
      visibleCount,
      hidden,
      ghostAssets,
    };
  });

  const unownedPropertyCount = props.filter((p) => p.user_id === null || p.user_id === undefined).length;
  if (unownedPropertyCount > 0 && users.length > 1) {
    notes.push(
      `${unownedPropertyCount} ملک بی‌مالک است و بیش از یک حساب وجود دارد → مهاجرت خودکار رد می‌شود؛ باید تک‌تک و با ممیزی منتقل شوند.`,
    );
  }

  return {
    users,
    tenants,
    unownedPropertyCount,
    totalProperties: props.length,
    snapshotOwnerMismatches,
    auditEvents,
    masterData,
    notes,
  };
}

/* ─────────────────────────────── presentation ─────────────────────────────── */

function fmt(v: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** `4500000000.000000000000000000` → `4,500,000,000` (numeric(38,18) is noisy in a terminal). */
function fmtMoney(v: any): string {
  const raw = fmt(v);
  if (raw === "—") return raw;
  const neg = raw.startsWith("-");
  const [int, frac = ""] = raw.replace(/^-/, "").split(".");
  const trimmed = frac.replace(/0+$/, "");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${trimmed ? `.${trimmed}` : ""}`;
}

export function renderReport(report: VisibilityReport): string {
  const out: string[] = [];
  out.push("═══ تشخیص: چرا بخش املاک خالی است؟ (فقط‌خواندنی) ═══");
  out.push("");
  out.push(`کل ردیف‌های real_estate_properties: ${report.totalProperties}`);
  out.push(`حساب‌های کاربری: ${report.users.length}`);
  for (const u of report.users) {
    const ident = [u.username ? `username=${u.username}` : null, u.email ? `email=${u.email}` : null, u.google_id ? "google-oauth" : null]
      .filter(Boolean)
      .join(", ");
    out.push(`  - ${fmt(u.name)} · role=${fmt(u.role)} · ${ident || "بدون نام‌کاربری/ایمیل"} · id=${fmt(u.id)}`);
  }
  if (report.unownedPropertyCount > 0) {
    out.push(`  ⚠ ${report.unownedPropertyCount} ملک هیچ مالکی ندارد (user_id = NULL) → برای هیچ حسابی قابل مشاهده نیست.`);
  }

  for (const t of report.tenants) {
    out.push("");
    out.push(`── «${fmt(t.user.name ?? t.user.username ?? t.user.id)}» ──`);
    out.push(`   قابل مشاهده در «املاک من»: ${t.visibleCount}`);
    const groups = new Map<Verdict, PropertyInventoryRow[]>();
    for (const h of t.hidden) {
      groups.set(h.verdict, [...(groups.get(h.verdict) ?? []), h.row]);
    }
    for (const [verdict, rows] of groups) {
      const info = VERDICT_INFO[verdict];
      out.push(`   ✗ ${rows.length} رکورد مخفی — ${info.fa}`);
      for (const r of rows.slice(0, 8)) {
        out.push(
          `       · ${fmt(r.symbol ?? r.asset_name ?? "(بدون دارایی)")} · ملک id=${String(r.id).slice(0, 8)} · ` +
            `خرید=${fmtMoney(r.purchase_price_toman)} تومان · user_id=${r.user_id ? String(r.user_id).slice(0, 8) : "NULL"}`,
        );
      }
      if (rows.length > 8) out.push(`       … و ${rows.length - 8} مورد دیگر`);
      if (info.fix) out.push(`       ↪ راه‌حل: ${info.fix}`);
    }
    if (t.ghostAssets.length > 0) {
      out.push(`   ⓘ ${t.ghostAssets.length} دارایی در خانوادهٔ «واقعی» شمرده می‌شود اما ردیف ملک ندارد:`);
      for (const g of t.ghostAssets.slice(0, 8)) {
        out.push(`       · ${fmt(g.symbol)} — ${fmt(g.name)} · کلاس=${fmt(g.class_name)}`);
      }
      out.push(
        "       ↪ ماژول املاک فقط real_estate_properties را می‌خواند؛ این ردیف‌ها یا از مسیر عمومی «ثبت خرید دارایی» " +
          "آمده‌اند یا کلاس‌بندی‌شان نقدی/اشتباه است. برای دیده‌شدن در «املاک من» باید یک رکورد ملک برایشان ثبت شود.",
      );
    }
  }

  if (report.snapshotOwnerMismatches > 0) {
    out.push(
      `\n⚠ ${report.snapshotOwnerMismatches} snapshot ارزش‌گذاری با مالک ملک هم‌خوان نیست → «تاریخچه ارزش‌گذاری» خالی می‌ماند، حتی اگر خود ملک فهرست شود.`,
    );
  }

  if (report.masterData) {
    const m = report.masterData;
    out.push(`\nداده پایه: شهر ${m.cities} (فعال ${m.citiesActive}) · محله ${m.neighborhoods} · نوع ملک ${m.propertyTypes}`);
  }

  if (report.auditEvents.length > 0) {
    out.push("\n── شواهد حسابرسی (۲۵ رویداد آخر) ──");
    for (const e of report.auditEvents) {
      out.push(`   ${fmt(e.created_at)} · ${fmt(e.action)} · ${fmt(e.entity_type)} · ${fmt(e.detail)}`);
    }
  }

  for (const n of report.notes) out.push(`\nℹ ${n}`);
  return out.join("\n");
}
