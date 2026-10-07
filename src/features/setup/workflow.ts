import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, setupSessions, userSetupState, vehicleValuationSnapshots, userFxSettings } from "@/db/schema";
import { encryptSensitive, decryptSensitive } from "@/lib/fieldEncryption";
import { completeSetup, getSetupState, type SetupInput } from "./service";
import { D } from "@/domain/decimal";
import { resolveAutomaticPurchaseRate } from "@/features/rwa/vehicle/fx";
import { createUserVehicle } from "@/features/rwa/vehicle/service";
import { recordVehicleValuationSnapshot } from "@/features/rwa/vehicle/valuation";
import { createRealEstateAsset } from "@/features/rwa/realEstate/service";
import { createDebtRecord, validateDebtInput, type CreateDebtInput } from "@/features/planning/createDebt";
import {getSupportedCryptoBySymbol} from "@/features/pricing/supportedAssets";
import { todayIso } from "@/lib/format";

export const SETUP_SECTIONS = ["holdings", "instruments", "properties", "vehicles", "debts"] as const;
export type SetupAnswers = Record<(typeof SETUP_SECTIONS)[number], "yes" | "no">;
type Receipt = { id: string; hash: string };
type Progress = { fxRate?: string; inputMethod?: string; base?: string; items?: Record<string, Receipt>; done?: boolean };
const digest = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const context = (userId: string) => `setup-draft:${userId}`;

export async function saveSetupDraft(userId: string, draft: unknown) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("پیش‌نویس نامعتبر است.");
  const text = JSON.stringify(draft);
  if (text.length > 250000) throw new Error("پیش‌نویس بیش از حد بزرگ است.");
  const encrypted = encryptSensitive(text, context(userId));
  await db.insert(setupSessions).values({ userId, draftEncrypted: encrypted }).onConflictDoNothing();
  await db.update(setupSessions).set({ draftEncrypted: encrypted, updatedAt: new Date() }).where(and(eq(setupSessions.userId, userId), sql`${setupSessions.leaseToken} is null and not exists (select 1 from user_setup_state s where s.user_id=${userId} and s.completed)`));
}
export async function loadSetupDraft(userId: string) {
  const [row] = await db.select().from(setupSessions).where(eq(setupSessions.userId, userId));
  return row?.draftEncrypted ? JSON.parse(decryptSensitive(row.draftEncrypted, context(userId))!) : null;
}

export function validateSetupSelection(input: SetupInput, answers: SetupAnswers, debtInputs: CreateDebtInput[]) {
  if(input.bankPresence === "no" && input.inputMethod === "sms") throw new Error("برای دریافت پیامک ابتدا یک حساب بانکی معرفی کنید یا روش دستی/فایل را انتخاب کنید.");
  if(input.bankPresence === "yes" && !(input.bankAccounts?.length)) throw new Error("حساب بانکی انتخاب‌شده باید کامل معرفی شود.");
  const counts = { holdings: (input.cryptoHoldings?.length ?? 0) + (D(input.goldOpeningQty || "0").gt(0) ? 1 : 0), instruments: input.instruments?.length ?? 0, properties: input.properties?.length ?? 0, vehicles: input.vehicles?.length ?? 0, debts: debtInputs.length };
  for (const section of SETUP_SECTIONS) {
    if (!answers || !["yes", "no"].includes(answers[section])) throw new Error("برای همه بخش‌ها پاسخ «دارم» یا «ندارم» الزامی است.");
    if ((answers[section] === "yes") !== (counts[section] > 0)) throw new Error("پاسخ دارم/ندارم با ردیف‌های واردشده یکسان نیست.");
  }
  if ((input.cryptoHoldings?.length ?? 0) > 100) throw new Error("حداکثر ۱۰۰ خرید رمزارز را وارد کنید.");
  for (const row of input.cryptoHoldings ?? []) {
    if (!getSupportedCryptoBySymbol(row.symbol)) throw new Error("رمزارز انتخاب‌شده پشتیبانی نمی‌شود.");
    if (!row.purchaseDate || !D(row.quantity || "0").gt(0) || !D(row.unitPrice || "0").gt(0) || !row.walletName) throw new Error("مقدار، قیمت، تاریخ خرید و محل نگهداری رمزارز الزامی است.");
  }
  if (D(input.goldOpeningQty || "0").gt(0) && (!input.goldPurchaseDate || !input.goldHoldingPlace || !D(input.goldUnitPrice || "0").gt(0))) throw new Error("محل نگهداری، تاریخ و قیمت خرید طلا الزامی است.");
  if (D(input.goldOpeningQty || "0").gt(0) && input.goldPriceCurrency !== "IRT") throw new Error("بهای خرید طلای آب‌شده باید به تومان وارد شود.");
  for (const row of input.instruments ?? []) {
    if (!row.symbol?.trim()) throw new Error("نماد دارایی الزامی است.");
    if (!D(row.quantity || "0").gt(0) || !D(row.unitPrice || "0").gt(0) || (row.kind === "wallex" && !row.purchaseDate)) throw new Error("مقدار، بهای خرید و تاریخ دارایی مشمول الزامی است.");
    if (row.kind !== "wallex" && row.priceCurrency !== "IRT") throw new Error("سهام و صندوق بورسی با مبلغ تومانی ثبت می‌شوند.");
  }
  for (const row of input.vehicles ?? []) if (!row.ownershipDate || !D(row.purchasePriceToman).gt(0)) throw new Error("تاریخ و مبلغ خرید خودرو الزامی است.");
  for (const row of input.properties ?? []) if (!row.acquisitionDate || !D(row.purchasePriceToman).gt(0)) throw new Error("تاریخ و مبلغ خرید ملک الزامی است.");
  for (const row of debtInputs) { const error = validateDebtInput(row); if (error) throw new Error(error); }
}

/** Per-owner lease plus receipts written in each asset's own transaction. */
export async function finishSetup(userId: string, input: SetupInput, answers: SetupAnswers, debtInputs: CreateDebtInput[]) {
  if ((await getSetupState(userId)).completed) return {ok:true,message:"راه‌اندازی قبلاً تکمیل شده است."};
  validateSetupSelection(input, answers, debtInputs);
  // Resolve mandatory historical data before any durable financial mutation.
  for (const date of new Set([...(input.vehicles ?? []).map(r => r.ownershipDate), ...(input.properties ?? []).map(r => r.acquisitionDate), ...(input.cryptoHoldings ?? []).map(r => r.purchaseDate!), ...(input.instruments ?? []).filter(r => r.kind === "wallex").map(r => r.purchaseDate!), ...(input.goldPurchaseDate ? [input.goldPurchaseDate] : [])])) {
    if (date !== todayIso()) await resolveAutomaticPurchaseRate(date, userId);
  }
  await db.insert(setupSessions).values({ userId }).onConflictDoNothing();
  const token = crypto.randomUUID();
  const lease = await db.update(setupSessions).set({ leaseToken: token, leaseUntil: new Date(Date.now() + 300000) }).where(and(eq(setupSessions.userId, userId), sql`(${setupSessions.leaseToken} is null or ${setupSessions.leaseUntil} < now())`)).returning();
  if (!lease.length) throw new Error("ثبت راه‌اندازی در حال انجام است؛ کمی بعد وضعیت را بررسی کنید.");
  const progress = (lease[0].progress ?? {}) as Progress;
  const update = async (client: any = db) => {
    const saved = await client.update(setupSessions).set({ progress, updatedAt: new Date(), leaseUntil: new Date(Date.now() + 300000) }).where(and(eq(setupSessions.userId, userId), eq(setupSessions.leaseToken, token))).returning({id:setupSessions.userId});
    if (!saved.length) throw new Error("مهلت ثبت منقضی شد؛ وضعیت را دوباره بررسی کنید.");
  };
  const item = async (key: string, data: unknown, create: (save: (tx: any, id: string) => Promise<void>) => Promise<unknown>) => {
    await update();
    const hash = digest(data); const prior = progress.items?.[key];
    if (prior) { if (prior.hash !== hash) throw new Error("اطلاعات ثبت‌شده تغییر کرده؛ فقط موارد ثبت‌نشده را اصلاح کنید."); return prior.id; }
    let id = "";
    await create(async (tx, createdId) => { id = createdId; progress.items = { ...progress.items, [key]: { id, hash } }; await update(tx); });
    return id;
  };
  try {
    if ((await getSetupState(userId)).completed) return { ok: true, message: "راه‌اندازی قبلاً تکمیل شده است." };
    const core = { ...input, vehicles: [], properties: [] };
    const {inputMethod: _method,...financialCore}=core;
    const hash = digest(financialCore);
    if (progress.base && progress.base !== hash) throw new Error("حساب‌ها و موجودی اولیه قبلاً ثبت شده‌اند؛ آن‌ها را دوباره تغییر ندهید.");
    if (!progress.base) {
      const existing = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId)).limit(1);
      if (existing.length) throw new Error("حساب‌های قبلی موجودند؛ مسیر تأیید اطلاعات موجود را تکمیل کنید تا موجودی دوباره ثبت نشود.");
      await completeSetup(core, userId, { onCoreCommitted: async tx => {
        if (input.fxRate && D(input.fxRate).gt(0)) await tx.insert(userFxSettings).values({userId,currentRate:input.fxRate,lastUpdatedAt:new Date()}).onConflictDoUpdate({target:userFxSettings.userId,set:{currentRate:input.fxRate,lastUpdatedAt:new Date(),updatedAt:new Date()}});
        progress.fxRate=input.fxRate;
        progress.inputMethod=input.inputMethod;
        progress.base = hash; await update(tx);
      } });
    }
    for (const [index, row] of (input.vehicles ?? []).entries()) {
      const id = await item(`vehicle:${index}`, row, save => createUserVehicle({ ...row, manufacturingYear: Number(row.manufacturingYear), userId }, save));
      if (row.currentValueToman && D(row.currentValueToman).gt(0)) {
        const prior = await db.select().from(vehicleValuationSnapshots).where(and(eq(vehicleValuationSnapshots.userVehicleId, id), eq(vehicleValuationSnapshots.snapshotDate, todayIso()))).limit(1);
        if (prior.length && !D(prior[0].currentValueToman).sub(row.currentValueToman).isZero()) throw new Error("ارزش‌گذاری ثبت‌شده تغییر کرده است.");
        if (!prior.length) await recordVehicleValuationSnapshot({ catalogId: row.catalogId, userVehicleId: id, snapshotDate: todayIso(), currentValueToman: row.currentValueToman, usdRate: input.fxRate, source: "manual", createdByUserId: userId });
      }
    }
    for (const [index, row] of (input.properties ?? []).entries()) await item(`property:${index}`, row, save => createRealEstateAsset({ ...row, userId, valuationDate: row.currentValueToman ? todayIso() : row.acquisitionDate, currentValueToman: row.currentValueToman || row.purchasePriceToman, valuationFxRate: row.currentValueToman ? input.fxRate : undefined }, save));
    for (const [index, row] of debtInputs.entries()) await item(`debt:${index}`, row, save => db.transaction(async tx => { const id = await createDebtRecord(row, { usdIrtRate: input.fxRate!, tx: tx as any }); await save(tx, id); }));
    await db.transaction(async tx => {
      for (const [category, answer] of Object.entries({ online_gold: input.goldHoldingPlace && input.goldHoldingPlace !== "نگهداری شخصی" ? "yes" : "no", real_estate: answers.properties, vehicle: answers.vehicles, crypto: input.cryptoHoldings?.length ? "yes" : "no", fund: input.instruments?.some(r => r.kind === "fund") ? "yes" : "no", stock: input.instruments?.some(r => r.kind === "stock") ? "yes" : "no" })) {
        // Write claims only; claims never post financial entries.
        const { onboardingIntents } = await import("@/db/schema");
        await tx.insert(onboardingIntents).values({ userId, category, answer }).onConflictDoUpdate({ target: [onboardingIntents.userId, onboardingIntents.category], set: { answer, updatedAt: new Date() } });
      }
      await tx.update(userSetupState).set({ completed: true, currentStep: 9, updatedAt: new Date() }).where(eq(userSetupState.userId, userId));
      progress.inputMethod=input.inputMethod;
      progress.done = true; await update(tx);
      await tx.update(setupSessions).set({ draftEncrypted: null }).where(eq(setupSessions.userId, userId));
    });
    return { ok: true, message: "همه اطلاعات انتخاب‌شده ثبت شدند؛ راه‌اندازی تکمیل شد." };
  } finally { await db.update(setupSessions).set({ leaseToken: null, leaseUntil: null }).where(and(eq(setupSessions.userId, userId), eq(setupSessions.leaseToken, token))); }
}
