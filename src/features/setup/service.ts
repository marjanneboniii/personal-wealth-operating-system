import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  assets,
  auditLog,
  currencies,
  prices,
  settings,
  userSetupState,
  users,
} from "@/db/schema";
import { postEntry } from "@/features/ledger/service";
import { ensureCategoryCatalog } from "@/features/categories/service";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export type SetupInput = {
  userName: string;
  baseCurrency: string; // Accounting currency (e.g. USD, EUR, IRR)
  displayCurrency: string; // User display currency (e.g. USD, IRT, EUR)
  dateCalendar: "jalali" | "gregorian";
  digitStyle: "fa" | "en";
  bankAccountName?: string;
  cashWalletName?: string;
  bankOpeningBalance?: string; // in base currency or asset quantity
  cashOpeningBalance?: string;
  cryptoOpeningQty?: string;
  cryptoUnitPrice?: string; // Price in base currency
  goldOpeningQty?: string; // in grams
  goldUnitPrice?: string; // Price per gram in base currency
};

export async function getSetupState() {
  const rows = await db.select().from(userSetupState).limit(1);
  if (!rows.length) return { completed: false, currentStep: 1 };
  return { completed: rows[0].completed, currentStep: rows[0].currentStep };
}

/**
 * Setup Wizard Orchestrator
 *
 * Enforces:
 * - Duplicate prevention (throws if setup is already completed).
 * - All financial mutations go strictly through postEntry() — never direct SQL inserts to ledger.
 * - Accounting Currency and Display Currency remain separate.
 * - Clean onboarding without demo transactions.
 */
export async function completeSetup(input: SetupInput): Promise<{ ok: boolean; message: string }> {
  // 1. Prevent duplicate setup
  const existingState = await getSetupState();
  if (existingState.completed) {
    throw new Error("راه‌اندازی اولیه قبلاً انجام شده است.");
  }

  return db.transaction(async (tx) => {
    const today = todayIso();

    // 2. Configure Reference Currencies if not existing
    let curList = await tx.select().from(currencies);
    if (!curList.length) {
      curList = await tx
        .insert(currencies)
        .values([
          { code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true },
          { code: "IRT", name: "تومان", symbol: "تومان", decimals: 0, isFiat: true },
          { code: "EUR", name: "یورو", symbol: "€", decimals: 2, isFiat: true },
          { code: "IRR", name: "ریال ایران", symbol: "ریال", decimals: 0, isFiat: true },
        ])
        .returning();
    }
    const curMap = Object.fromEntries(curList.map((c) => [c.code, c.id]));

    // 3. Configure Reference Asset Classes
    let clsList = await tx.select().from(assetClasses);
    if (!clsList.length) {
      clsList = await tx
        .insert(assetClasses)
        .values([
          { code: "cash", name: "نقد و بانک", color: "#38bdf8", sortOrder: 1 },
          { code: "stable", name: "استیبل‌کوین", color: "#34d399", sortOrder: 2 },
          { code: "crypto", name: "رمزارز", color: "#a78bfa", sortOrder: 3 },
          { code: "gold", name: "طلا", color: "#fbbf24", sortOrder: 4 },
        ])
        .returning();
    }
    const clsMap = Object.fromEntries(clsList.map((c) => [c.code, c.id]));

    // 4. Configure Reference Assets
    let astList = await tx.select().from(assets);
    if (!astList.length) {
      astList = await tx
        .insert(assets)
        .values([
          {
            symbol: input.baseCurrency,
            name: `${input.baseCurrency} (ارز پایه)`,
            classId: clsMap.cash,
            currencyId: curMap[input.baseCurrency] ?? curMap.USD,
            decimals: input.baseCurrency === "IRT" || input.baseCurrency === "IRR" ? 0 : 2,
          },
          { symbol: "USDT", name: "تتر", classId: clsMap.stable, decimals: 6 },
          { symbol: "BTC", name: "بیت‌کوین", classId: clsMap.crypto, decimals: 8 },
          { symbol: "ETH", name: "اتریوم", classId: clsMap.crypto, decimals: 8 },
          { symbol: "GOLD18", name: "طلای ۱۸ عیار (گرم)", classId: clsMap.gold, decimals: 3 },
        ])
        .returning();
    }
    const assetMap = Object.fromEntries(astList.map((a) => [a.symbol, a.id]));

    // 5. User Creation & Settings Storage
    const [user] = await tx
      .insert(users)
      .values({ name: input.userName.trim() || "مالک خانواده", role: "owner" })
      .returning();

    const configItems = [
      { key: "base_currency", value: input.baseCurrency },
      { key: "display_currency", value: input.displayCurrency },
      { key: "date_calendar", value: input.dateCalendar },
      { key: "digit_style", value: input.digitStyle },
    ];

    for (const cfg of configItems) {
      await tx
        .insert(settings)
        .values(cfg)
        .onConflictDoUpdate({ target: settings.key, set: { value: cfg.value } });
    }

    // 6. Chart of Accounts Creation
    const baseAssetId = assetMap[input.baseCurrency] ?? assetMap.USD;
    const acctRows = [
      { code: "1000", name: "دارایی‌ها", type: "asset" },
      { code: "1010", name: input.bankAccountName?.trim() || "حساب بانکی اصلی", type: "asset", assetId: baseAssetId },
      { code: "1020", name: input.cashWalletName?.trim() || "صندوق نقد", type: "asset", assetId: baseAssetId },
      { code: "1200", name: "کیف رمزارز (ETH)", type: "asset", assetId: assetMap.ETH },
      { code: "1300", name: "طلای ۱۸ عیار", type: "asset", assetId: assetMap.GOLD18 },
      { code: "2000", name: "بدهی‌ها", type: "liability" },
      { code: "2010", name: "وام / بدهی عمومی", type: "liability", assetId: baseAssetId },
      { code: "3000", name: "سرمایه", type: "equity" },
      { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: baseAssetId },
      // Non-cash reserve: counter account of depreciation / reserve expense
      // entries (nature = non_cash) so no cash account ever moves.
      { code: "3200", name: "ذخیره استهلاک و تعمیرات آتی", type: "equity", assetId: baseAssetId },
      { code: "4000", name: "درآمدها", type: "income" },
      { code: "4010", name: "حقوق و درآمد", type: "income", assetId: baseAssetId },
      { code: "4100", name: "سود سرمایه‌ای تحقق‌یافته", type: "income", assetId: baseAssetId },
      { code: "5000", name: "هزینه‌ها", type: "expense" },
      { code: "5010", name: "خوراک و خانه", type: "expense", assetId: baseAssetId },
      { code: "5020", name: "مسکن و اجاره", type: "expense", assetId: baseAssetId },
      { code: "5900", name: "هزینه متفرقه", type: "expense", assetId: baseAssetId },
    ];

    const insertedAccounts = await tx.insert(accounts).values(acctRows).returning();
    const acctMap = Object.fromEntries(insertedAccounts.map((a) => [a.code, a.id]));

    // Standard hierarchical expense category catalog (reporting dimension).
    // Idempotent; runs inside the setup transaction.
    await ensureCategoryCatalog(tx);

    // 7. Physical gold is a manually valued real asset. The crypto unit price
    // entered above is purchase/cost information only (used by the opening
    // journal/FIFO lot below) and is deliberately NOT stored as a current
    // crypto price. Current ETH price comes only from CoinGecko.
    if (input.goldUnitPrice && D(input.goldUnitPrice).gt(0) && assetMap.GOLD18) {
      await tx.insert(prices).values({
        assetId: assetMap.GOLD18,
        asOf: today,
        priceBase: D(input.goldUnitPrice).toString(),
        source: "manual",
      });
    }

    // 8. Opening Balances Entry Creation
    const draftPostings = [];
    let totalOpeningEquityBase = Decimal.zero();

    // Bank Opening Balance
    if (input.bankOpeningBalance && D(input.bankOpeningBalance).gt(0)) {
      const bankVal = D(input.bankOpeningBalance);
      draftPostings.push({
        accountId: acctMap["1010"],
        assetId: baseAssetId,
        quantity: bankVal.toString(),
        baseValue: bankVal.toString(),
        memo: "موجودی اولیه بانک",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(bankVal);
    }

    // Cash Opening Balance
    if (input.cashOpeningBalance && D(input.cashOpeningBalance).gt(0)) {
      const cashVal = D(input.cashOpeningBalance);
      draftPostings.push({
        accountId: acctMap["1020"],
        assetId: baseAssetId,
        quantity: cashVal.toString(),
        baseValue: cashVal.toString(),
        memo: "موجودی اولیه نقد",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(cashVal);
    }

    // Crypto Opening Balance
    let ethLotInfo: { accountId: string; assetId: string; quantity: string; costBase: string } | undefined;
    if (input.cryptoOpeningQty && D(input.cryptoOpeningQty).gt(0)) {
      const ethQty = D(input.cryptoOpeningQty);
      const ethPrice = D(input.cryptoUnitPrice || "0");
      const ethValue = ethQty.mul(ethPrice);
      draftPostings.push({
        accountId: acctMap["1200"],
        assetId: assetMap.ETH,
        quantity: ethQty.toString(),
        baseValue: ethValue.toString(),
        memo: "موجودی اولیه اتریوم",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(ethValue);
      ethLotInfo = {
        accountId: acctMap["1200"],
        assetId: assetMap.ETH,
        quantity: ethQty.toString(),
        costBase: ethValue.toString(),
      };
    }

    // Gold Opening Balance
    let goldLotInfo: { accountId: string; assetId: string; quantity: string; costBase: string } | undefined;
    if (input.goldOpeningQty && D(input.goldOpeningQty).gt(0)) {
      const goldQty = D(input.goldOpeningQty);
      const goldPrice = D(input.goldUnitPrice || "0");
      const goldValue = goldQty.mul(goldPrice);
      draftPostings.push({
        accountId: acctMap["1300"],
        assetId: assetMap.GOLD18,
        quantity: goldQty.toString(),
        baseValue: goldValue.toString(),
        memo: "موجودی اولیه طلای ۱۸ عیار",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(goldValue);
      goldLotInfo = {
        accountId: acctMap["1300"],
        assetId: assetMap.GOLD18,
        quantity: goldQty.toString(),
        costBase: goldValue.toString(),
      };
    }

    // Balance against Opening Balance Equity Account (3010)
    if (draftPostings.length > 0) {
      draftPostings.push({
        accountId: acctMap["3010"],
        assetId: baseAssetId,
        quantity: totalOpeningEquityBase.neg().toString(),
        baseValue: totalOpeningEquityBase.neg().toString(),
        memo: "موازنه سرمایه افتتاحیه",
      });

      const lotsToOpen = [];
      if (ethLotInfo) lotsToOpen.push(ethLotInfo);
      if (goldLotInfo) lotsToOpen.push(goldLotInfo);

      // Post single atomic opening entry strictly via postEntry()
      await postEntry(
        {
          entryDate: today,
          type: "opening",
          description: "افتتاحیه — ثبت موجودی اولیه حساب‌ها",
          source: "manual",
          postings: draftPostings,
          openLots: lotsToOpen,
        },
        tx,
      );
    }

    // 9. Mark setup as completed in user_setup_state
    await tx.insert(userSetupState).values({
      userId: user.id,
      completed: true,
      currentStep: 4,
    });

    // 10. Audit Log
    await tx.insert(auditLog).values({
      action: "complete_setup",
      entityType: "system",
      payload: JSON.stringify({
        baseCurrency: input.baseCurrency,
        displayCurrency: input.displayCurrency,
        openingPostingsCount: draftPostings.length,
      }),
    });

    return { ok: true, message: "راه‌اندازی اولیه سیستم با موفقیت ثبت شد." };
  });
}
