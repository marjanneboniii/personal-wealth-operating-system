/**
 * خودرو: هزینه‌ی واقعی نگه‌داشتن — what a car costs beyond its price.
 *
 * Each car has ONE hashtag (vehicle_assets.expense_tag) and its running costs
 * are ordinary expenses carrying that tag. Tags already exist, are editable
 * after posting and can be applied to many entries at once — so last year's
 * fuel and repairs can be linked retroactively without any new screen. The tag
 * is derived from the car once and then stored, so renaming the car never
 * unlinks its history.
 *
 * The cost of ownership is then two numbers the ledger already knows:
 *   running costs  = Σ frozen Toman of expenses tagged with the car
 *                    + premiums of insurance policies linked to the car
 *                    (each entry counted once)
 *   value change   = current value − purchase price
 *
 * Due dates (inspection, the annual municipal toll, service) are reminders;
 * nothing here posts.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { vehicleAssets, vehicleDueDates } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { addJalaliMonths } from "@/features/income/recurring";
import { normalizeTag } from "@/features/tags/normalize";
import { getVehicleDashboard } from "@/features/rwa/vehicle/service";
import { todayIso } from "@/lib/format";

export const DUE_KINDS = ["inspection", "toll", "service", "other"] as const;
export type DueKind = (typeof DUE_KINDS)[number];
export const DUE_KIND_LABEL: Record<DueKind, string> = {
  inspection: "معاینه فنی",
  toll: "عوارض سالانه",
  service: "سرویس دوره‌ای",
  other: "سایر",
};
/** A due date this close (or overdue) is a reminder. */
export const VEHICLE_DUE_HORIZON_DAYS = 14;

/** The tag a car's costs go under: «پژو_۲۰۶», suffixed with its number only on a clash. PURE. */
export function vehicleTag(brand: string, model: string, seq: number | null | undefined, taken: ReadonlySet<string>): string {
  const base = normalizeTag(`${brand} ${model}`) ?? `خودرو_${seq ?? 1}`;
  if (!taken.has(base)) return base;
  return normalizeTag(`${base}_${seq ?? taken.size + 1}`) ?? `${base}_${taken.size + 1}`;
}

/** Give every car of this user its tag (once); returns vehicle id → tag. */
export async function ensureVehicleTags(userId: string): Promise<Map<string, string>> {
  const cars = await db
    .select({ id: vehicleAssets.id, brand: vehicleAssets.brand, model: vehicleAssets.model, seq: vehicleAssets.userSeq, tag: vehicleAssets.expenseTag })
    .from(vehicleAssets)
    .where(eq(vehicleAssets.userId, userId))
    .orderBy(asc(vehicleAssets.createdAt));
  const taken = new Set(cars.map((c) => c.tag).filter((t): t is string => !!t));
  const out = new Map<string, string>();
  for (const car of cars) {
    let tag = car.tag;
    if (!tag) {
      tag = vehicleTag(car.brand, car.model, car.seq, taken);
      taken.add(tag);
      await db.update(vehicleAssets).set({ expenseTag: tag }).where(and(eq(vehicleAssets.id, car.id), eq(vehicleAssets.userId, userId)));
    }
    out.set(car.id, tag);
  }
  return out;
}

export type VehicleCost = {
  total: string;
  last12Months: string;
  entries: number;
  topCategories: { name: string; toman: string }[];
};

async function runningCosts(userId: string, vehicleId: string, tag: string, since: string | null, today: string): Promise<VehicleCost> {
  const yearAgo = new Date(`${today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const res = await db.execute(sql`
    with linked as (
      select je.id, je.entry_date, je.category_id,
        coalesce((select s.irt_amount from entry_fx_snapshots s where s.entry_id = je.id limit 1), 0) as toman
      from journal_entries je
      where je.user_id = ${userId}::uuid and je.status = 'posted' and je.type = 'expense'
        ${since ? sql`and je.entry_date >= ${since}::date` : sql``}
        and (
          exists (select 1 from entry_tags t where t.entry_id = je.id and t.tag = ${tag})
          or je.id in (
            select pt.executed_entry_id from planned_transactions pt
              join insurance_policies ip on ip.id = pt.insurance_policy_id
            where ip.user_id = ${userId}::uuid and ip.insured_vehicle_id = ${vehicleId}::uuid and pt.executed_entry_id is not null
          )
        )
    )
    select
      coalesce(sum(toman), 0)::text as total,
      coalesce(sum(toman) filter (where entry_date >= ${yearAgo.toISOString().slice(0, 10)}::date), 0)::text as "last12",
      count(*)::int as n,
      coalesce((
        select json_agg(x order by x.toman desc) from (
          select coalesce(ec.name, 'بدون دسته') as name, sum(l.toman)::text as toman
          from linked l left join expense_categories ec on ec.id = l.category_id
          group by ec.name order by sum(l.toman) desc limit 3
        ) x
      ), '[]') as top
    from linked
  `);
  const r = res.rows[0] as { total: string; last12: string; n: number; top: { name: string; toman: string }[] | string };
  const top = typeof r.top === "string" ? JSON.parse(r.top) : r.top;
  return {
    total: D(r.total).toFixed(0),
    last12Months: D(r.last12).toFixed(0),
    entries: Number(r.n),
    topCategories: (top ?? []).map((t: { name: string; toman: string }) => ({ name: t.name, toman: D(t.toman).toFixed(0) })),
  };
}

export type DueDateRow = { id: string; vehicleId: string; kind: DueKind; title: string; dueDate: string; repeatMonths: number | null };

export type VehicleOverview = {
  id: string;
  label: string;
  tag: string;
  status: "active" | "sold";
  ownershipDate: string | null;
  purchaseToman: string | null;
  currentToman: string | null;
  /** current − purchase; negative = the car lost value. */
  valueChangeToman: string | null;
  costs: VehicleCost;
  /** (running costs − value change) ÷ months owned — what the car really costs per month. */
  monthlyCostToman: string | null;
  dueDates: DueDateRow[];
};

function monthsBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(1, ms / (86_400_000 * 30.4375));
}

export async function listVehicleOverview(userId: string, today = todayIso()): Promise<VehicleOverview[]> {
  const [tags, dashboard, dues] = await Promise.all([
    ensureVehicleTags(userId),
    getVehicleDashboard(userId),
    db
      .select()
      .from(vehicleDueDates)
      .where(and(eq(vehicleDueDates.userId, userId), eq(vehicleDueDates.status, "pending")))
      .orderBy(asc(vehicleDueDates.dueDate)),
  ]);
  const out: VehicleOverview[] = [];
  for (const item of dashboard) {
    const v = item.vehicle;
    const tag = tags.get(v.id);
    if (!tag) continue;
    const costs = await runningCosts(userId, v.id, tag, v.ownershipDate, today);
    const end = v.status === "sold" ? v.salePriceToman : item.valuation.currentValueToman;
    const change = v.purchasePriceToman && end ? D(end).sub(v.purchasePriceToman) : null;
    const until = v.status === "sold" && v.saleDate ? v.saleDate : today;
    const monthly =
      v.ownershipDate && (change || D(costs.total).gt(0))
        ? D(costs.total).sub(change ?? Decimal.zero()).div(String(monthsBetween(v.ownershipDate, until))).toFixed(0)
        : null;
    out.push({
      id: v.id,
      label: `${v.brand} ${v.model} ${v.year}`,
      tag,
      status: v.status === "sold" ? "sold" : "active",
      ownershipDate: v.ownershipDate,
      purchaseToman: v.purchasePriceToman ? D(v.purchasePriceToman).toFixed(0) : null,
      currentToman: end ? D(end).toFixed(0) : null,
      valueChangeToman: change ? change.toFixed(0) : null,
      costs,
      monthlyCostToman: monthly,
      dueDates: dues
        .filter((d) => d.vehicleId === v.id)
        .map((d) => ({ id: d.id, vehicleId: d.vehicleId, kind: d.kind as DueKind, title: d.title, dueDate: d.dueDate, repeatMonths: d.repeatMonths })),
    });
  }
  return out;
}

export type DueInput = { vehicleId: string; kind: string; title?: string | null; dueDate: string; repeatMonths?: number | null };

export async function addDueDate(userId: string, input: DueInput): Promise<string> {
  if (!DUE_KINDS.includes(input.kind as DueKind)) throw new Error("نوع سررسید را انتخاب کنید.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new Error("تاریخ سررسید را وارد کنید.");
  const repeat = input.repeatMonths ? Math.trunc(input.repeatMonths) : null;
  if (repeat != null && (repeat < 1 || repeat > 60)) throw new Error("دوره‌ی تکرار بین ۱ تا ۶۰ ماه است.");
  const [car] = await db
    .select({ id: vehicleAssets.id })
    .from(vehicleAssets)
    .where(and(eq(vehicleAssets.id, input.vehicleId), eq(vehicleAssets.userId, userId)))
    .limit(1);
  if (!car) throw new Error("خودروی انتخاب‌شده متعلق به شما نیست.");
  const title = (input.title ?? "").trim() || DUE_KIND_LABEL[input.kind as DueKind];
  if (title.length > 80) throw new Error("عنوان حداکثر ۸۰ نویسه است.");
  const [row] = await db
    .insert(vehicleDueDates)
    .values({ userId, vehicleId: car.id, kind: input.kind, title, dueDate: input.dueDate, repeatMonths: repeat })
    .returning({ id: vehicleDueDates.id });
  return row.id;
}

/** Done: a repeating due date rolls forward from its own date (not from today), so a late renewal keeps the cycle. */
export async function completeDueDate(userId: string, id: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [due] = await tx
      .update(vehicleDueDates)
      .set({ status: "done", doneAt: new Date() })
      .where(and(eq(vehicleDueDates.id, id), eq(vehicleDueDates.userId, userId), eq(vehicleDueDates.status, "pending")))
      .returning();
    if (!due) throw new Error("سررسید پیدا نشد یا قبلاً انجام شده است.");
    if (!due.repeatMonths) return null;
    const [next] = await tx
      .insert(vehicleDueDates)
      .values({ userId, vehicleId: due.vehicleId, kind: due.kind, title: due.title, dueDate: addJalaliMonths(due.dueDate, due.repeatMonths), repeatMonths: due.repeatMonths })
      .returning({ id: vehicleDueDates.id });
    return next.id;
  });
}

export async function cancelDueDate(userId: string, id: string): Promise<void> {
  const res = await db
    .update(vehicleDueDates)
    .set({ status: "cancelled" })
    .where(and(eq(vehicleDueDates.id, id), eq(vehicleDueDates.userId, userId), eq(vehicleDueDates.status, "pending")))
    .returning({ id: vehicleDueDates.id });
  if (!res.length) throw new Error("سررسید پیدا نشد.");
}

/** Pending due dates of cars still owned, due before `until` (overdue included) — for reminders. */
export async function vehicleDueReminders(userId: string, until: string) {
  return db
    .select({ id: vehicleDueDates.id, title: vehicleDueDates.title, dueDate: vehicleDueDates.dueDate, vehicleId: vehicleDueDates.vehicleId, brand: vehicleAssets.brand, model: vehicleAssets.model })
    .from(vehicleDueDates)
    .innerJoin(vehicleAssets, eq(vehicleAssets.id, vehicleDueDates.vehicleId))
    .where(
      and(
        eq(vehicleDueDates.userId, userId),
        eq(vehicleDueDates.status, "pending"),
        sql`${vehicleAssets.status} <> 'sold'`,
        sql`${vehicleDueDates.dueDate} <= ${until}`,
      ),
    )
    .orderBy(asc(vehicleDueDates.dueDate));
}

/** For the expense form: the user's cars still owned, with the tag their costs go under. */
export async function vehicleTagOptions(userId: string): Promise<{ label: string; tag: string }[]> {
  const tags = await ensureVehicleTags(userId);
  const cars = await db
    .select({ id: vehicleAssets.id, brand: vehicleAssets.brand, model: vehicleAssets.model })
    .from(vehicleAssets)
    .where(and(eq(vehicleAssets.userId, userId), sql`${vehicleAssets.status} <> 'sold'`))
    .orderBy(asc(vehicleAssets.createdAt));
  return cars.filter((c) => tags.has(c.id)).map((c) => ({ label: `${c.brand} ${c.model}`, tag: tags.get(c.id)! }));
}
