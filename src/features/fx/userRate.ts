import { db } from "@/db";
import { userFxSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { D } from "@/domain/decimal";

const DEFAULT_RATE = "190000";
const RATE_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type UserFxSnapshot = {
  rate: string;
  effectiveDate: string;
  source: string;
  lastUpdatedAt: string | null;
  canUpdate: boolean;
  nextUpdateAt: string | null;
};

export async function getUserFxRate(userId: string | null | undefined): Promise<UserFxSnapshot> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);

  if (!userId) {
    return {
      rate: DEFAULT_RATE,
      effectiveDate: todayIso,
      source: "default",
      lastUpdatedAt: null,
      canUpdate: true,
      nextUpdateAt: null,
    };
  }

  try {
    const [row] = await db.select().from(userFxSettings).where(eq(userFxSettings.userId, userId)).limit(1);
    if (row?.currentRate) {
      const last = row.lastUpdatedAt ? new Date(row.lastUpdatedAt) : null;
      const canUpdate = !last || now.getTime() - last.getTime() >= RATE_UPDATE_INTERVAL_MS;
      const next = last && !canUpdate ? new Date(last.getTime() + RATE_UPDATE_INTERVAL_MS).toISOString() : null;
      return {
        rate: row.currentRate.toString(),
        effectiveDate: todayIso,
        source: "user_settings",
        lastUpdatedAt: last?.toISOString() ?? null,
        canUpdate,
        nextUpdateAt: next,
      };
    }
  } catch {}

  // No user setting yet -> create with default
  try {
    await db.insert(userFxSettings).values({ userId, currentRate: DEFAULT_RATE }).onConflictDoNothing();
  } catch {}
  return {
    rate: DEFAULT_RATE,
    effectiveDate: todayIso,
    source: "default",
    lastUpdatedAt: null,
    canUpdate: true,
    nextUpdateAt: null,
  };
}

export async function updateUserFxRate(
  userId: string,
  newRate: string,
): Promise<{ ok: boolean; message: string; snapshot?: UserFxSnapshot }> {
  const dec = D(newRate);
  if (dec.lte(0)) return { ok: false, message: "نرخ باید بزرگ‌تر از صفر باشد." };
  if (dec.lt("1000") || dec.gt("10000000")) return { ok: false, message: "نرخ خارج از محدوده مجاز است." };

  const now = new Date();
  const [existing] = await db.select().from(userFxSettings).where(eq(userFxSettings.userId, userId)).limit(1);

  if (existing?.lastUpdatedAt) {
    const last = new Date(existing.lastUpdatedAt);
    const elapsed = now.getTime() - last.getTime();
    if (elapsed < RATE_UPDATE_INTERVAL_MS) {
      const remainingMs = RATE_UPDATE_INTERVAL_MS - elapsed;
      const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return {
        ok: false,
        message: `نرخ ارز فقط هر ۲۴ ساعت یک‌بار قابل به‌روزرسانی است. ${hours} ساعت دیگر می‌توانید مجدداً به‌روزرسانی کنید.`,
      };
    }
  }

  if (existing) {
    await db
      .update(userFxSettings)
      .set({ currentRate: dec.toString(), lastUpdatedAt: now, updatedAt: now })
      .where(eq(userFxSettings.userId, userId));
  } else {
    await db.insert(userFxSettings).values({ userId, currentRate: dec.toString(), lastUpdatedAt: now });
  }

  const snapshot = await getUserFxRate(userId);
  return { ok: true, message: "نرخ ارز با موفقیت به‌روزرسانی شد.", snapshot };
}

// Global fallback for non-authenticated or legacy calls
export { DEFAULT_RATE };
