import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  assets,
  budgets,
  currencies,
  debts,
  events,
  funds,
  goals,
  installments,
  institutions,
  networks,
  obligations,
  plannedTransactions,
  prices,
  settings,
  snapshotLines,
  snapshots,
  users,
  wallets,
} from "@/db/schema";
import { postEntry, recordBuy, recordExpense, recordIncome, recordSell } from "@/features/ledger/service";
import { payInstallment } from "@/features/planning/service";
import { addMonthsIso, todayIso } from "@/lib/format";
import { D } from "@/domain/decimal";
import { createSchemaIfNotExists, rootCauseOf } from "@/db/init-schema";

let schemaReady: Promise<void> | null = null;
let seeded: Promise<void> | null = null;

/**
 * The browser overlay only shows Drizzle's generic "Failed query: …" wrapper.
 * Log the real root cause + an actionable hint to the dev-server terminal so
 * database misconfiguration is diagnosable without digging into error.cause.
 */
function logDbFailure(err: unknown): void {
  if (err && typeof err === "object") {
    if (loggedFailures.has(err)) return;
    loggedFailures.add(err);
  }
  const root = rootCauseOf(err);
  const url = process.env.DATABASE_URL;
  console.error(
    `\n[db] Database initialization failed: ${root.message}` +
      (root.code ? ` (code: ${root.code})` : "") +
      (url && !url.startsWith("memory://")
        ? `\n[db] DATABASE_URL is set (${url.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@")}). ` +
          `Check that PostgreSQL is running, the database exists, and credentials are correct. ` +
          `Tip: set DATABASE_URL=memory:// in .env for zero-setup local development.`
        : `\n[db] Using the embedded in-memory database (PGlite).`),
  );
}

/**
 * Schema creation is ~90 round-trips; run it once per process instead of on
 * every page load. On failure the cache is cleared so the next request
 * retries from scratch (all statements are idempotent).
 */
const loggedFailures = new WeakSet<object>();

function ensureSchema(): Promise<void> {
  schemaReady ??= createSchemaIfNotExists().catch((err) => {
    schemaReady = null;
    logDbFailure(err);
    throw err;
  });
  return schemaReady;
}

export async function seedIfEmpty(): Promise<void> {
  seeded ??= (async () => {
    await ensureSchema();
    const mode = process.env.APP_MODE ?? "personal";
    const allowDemo = process.env.ALLOW_DEMO_SEED === "true" || mode === "development";

    // In Personal mode (or production), NEVER automatically load demo financial data.
    if (!allowDemo) return;

    const existing = await db.select({ c: sql<number>`count(*)::int` }).from(accounts);
    if ((existing[0]?.c ?? 0) > 0) return;
    await runSeed();
  })().catch((err) => {
    seeded = null;
    logDbFailure(err);
    throw err;
  });
  return seeded;
}

export async function runSeed(): Promise<void> {
  const today = todayIso();
  const m = (n: number) => addMonthsIso(today, n);

  /* Reference data ------------------------------------------------- */
  const cur = await db
    .insert(currencies)
    .values([
      { code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true },
      { code: "IRT", name: "تومان", symbol: "تومان", decimals: 0, isFiat: true },
      { code: "EUR", name: "یورو", symbol: "€", decimals: 2, isFiat: true },
    ])
    .returning();
  const curBy = Object.fromEntries(cur.map((c) => [c.code, c.id]));

  const classes = await db
    .insert(assetClasses)
    .values([
      { code: "cash", name: "نقد و بانک", color: "#38bdf8", sortOrder: 1 },
      { code: "stable", name: "استیبل‌کوین", color: "#34d399", sortOrder: 2 },
      { code: "crypto", name: "رمزارز", color: "#a78bfa", sortOrder: 3 },
      { code: "gold", name: "طلا", color: "#fbbf24", sortOrder: 4 },
      { code: "fund", name: "صندوق سرمایه‌گذاری", color: "#f472b6", sortOrder: 5 },
    ])
    .returning();
  const classBy = Object.fromEntries(classes.map((c) => [c.code, c.id]));

  const nets = await db
    .insert(networks)
    .values([
      { code: "TRC20", name: "ترون", chainType: "evm-like" },
      { code: "ERC20", name: "اتریوم", chainType: "evm" },
      { code: "BTC", name: "بیت‌کوین", chainType: "utxo" },
    ])
    .returning();
  const netBy = Object.fromEntries(nets.map((n) => [n.code, n.id]));

  const insts = await db
    .insert(institutions)
    .values([
      { kind: "bank", name: "بانک ملت", country: "IR" },
      { kind: "bank", name: "بانک سامان", country: "IR" },
      { kind: "exchange", name: "نوبیتکس", country: "IR" },
      { kind: "exchange", name: "Binance", country: "GL" },
      { kind: "broker", name: "کارگزاری مفید", country: "IR" },
    ])
    .returning();
  const instBy = Object.fromEntries(insts.map((i) => [i.name, i.id]));

  const ast = await db
    .insert(assets)
    .values([
      { symbol: "USD", name: "دلار (ارز پایه)", classId: classBy.cash, currencyId: curBy.USD, decimals: 2 },
      { symbol: "IRT", name: "تومان", classId: classBy.cash, currencyId: curBy.IRT, decimals: 0 },
      { symbol: "USDT", name: "تتر", classId: classBy.stable, networkId: netBy.TRC20, decimals: 6 },
      { symbol: "BTC", name: "بیت‌کوین", classId: classBy.crypto, networkId: netBy.BTC, decimals: 8 },
      { symbol: "ETH", name: "اتریوم", classId: classBy.crypto, networkId: netBy.ERC20, decimals: 8 },
      { symbol: "GOLD18", name: "طلای ۱۸ عیار (گرم)", classId: classBy.gold, decimals: 3 },
      { symbol: "KIAN", name: "صندوق طلای کیان", classId: classBy.fund, decimals: 0 },
    ])
    .returning();
  const A = Object.fromEntries(ast.map((a) => [a.symbol, a.id]));

  await db.insert(prices).values(
    [
      ["USD", "1"],
      ["IRT", "0.00001"],
      ["USDT", "1"],
      ["BTC", "95000"],
      ["ETH", "3200"],
      ["GOLD18", "62"],
      ["KIAN", "0.52"],
    ].map(([symbol, price]) => ({ assetId: A[symbol], asOf: today, priceBase: price, source: "manual" })),
  );

  const wl = await db
    .insert(wallets)
    .values([
      { name: "بانک ملت — جاری", kind: "bank", institutionId: instBy["بانک ملت"] },
      { name: "بانک سامان — سپرده", kind: "bank", institutionId: instBy["بانک سامان"] },
      { name: "نوبیتکس", kind: "exchange", institutionId: instBy["نوبیتکس"] },
      { name: "Binance", kind: "exchange", institutionId: instBy["Binance"] },
      { name: "کیف سرد Ledger", kind: "cold", networkId: netBy.BTC },
      { name: "متامسک", kind: "hot", networkId: netBy.ERC20 },
      { name: "گاوصندوق خانه", kind: "cash" },
      { name: "کارگزاری مفید", kind: "fund", institutionId: instBy["کارگزاری مفید"] },
    ])
    .returning();
  const W = Object.fromEntries(wl.map((w) => [w.name, w.id]));

  /* Chart of accounts ---------------------------------------------- */
  const acctRows = [
    { code: "1000", name: "دارایی‌ها", type: "asset" },
    { code: "1010", name: "بانک ملت", type: "asset", assetId: A.IRT, walletId: W["بانک ملت — جاری"] },
    { code: "1020", name: "بانک سامان", type: "asset", assetId: A.IRT, walletId: W["بانک سامان — سپرده"] },
    { code: "1030", name: "نقد در دسترس", type: "asset", assetId: A.IRT, walletId: W["گاوصندوق خانه"] },
    { code: "1100", name: "تتر نوبیتکس", type: "asset", assetId: A.USDT, walletId: W["نوبیتکس"] },
    { code: "1110", name: "تتر Binance", type: "asset", assetId: A.USDT, walletId: W["Binance"] },
    { code: "1200", name: "بیت‌کوین — کیف سرد", type: "asset", assetId: A.BTC, walletId: W["کیف سرد Ledger"] },
    { code: "1210", name: "اتریوم — متامسک", type: "asset", assetId: A.ETH, walletId: W["متامسک"] },
    { code: "1300", name: "طلای آب‌شده", type: "asset", assetId: A.GOLD18, walletId: W["گاوصندوق خانه"] },
    { code: "1400", name: "صندوق طلای کیان", type: "asset", assetId: A.KIAN, walletId: W["کارگزاری مفید"] },
    { code: "1500", name: "صندوق اضطراری", type: "asset", assetId: A.USDT, walletId: W["Binance"] },
    { code: "1510", name: "صندوق حمایت خانواده", type: "asset", assetId: A.IRT, walletId: W["بانک سامان — سپرده"] },
    { code: "1520", name: "پس‌انداز هدف خانه", type: "asset", assetId: A.USDT, walletId: W["Binance"] },
    { code: "2000", name: "بدهی‌ها", type: "liability" },
    { code: "2010", name: "وام بانک ملت", type: "liability", assetId: A.IRT },
    { code: "2020", name: "اقساط خودرو", type: "liability", assetId: A.IRT },
    { code: "3000", name: "سرمایه", type: "equity" },
    { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: A.USD },
    { code: "4000", name: "درآمدها", type: "income" },
    { code: "4010", name: "حقوق و دستمزد", type: "income", assetId: A.USD },
    { code: "4100", name: "سود سرمایه‌ای تحقق‌یافته", type: "income", assetId: A.USD },
    { code: "4900", name: "درآمد متفرقه", type: "income", assetId: A.USD },
    { code: "5000", name: "هزینه‌ها", type: "expense" },
    { code: "5010", name: "خوراک و خانه", type: "expense", assetId: A.USD },
    { code: "5020", name: "مسکن و اجاره", type: "expense", assetId: A.USD },
    { code: "5030", name: "حمل‌ونقل", type: "expense", assetId: A.USD },
    { code: "5040", name: "کارمزد و بانک", type: "expense", assetId: A.USD },
    { code: "5050", name: "سفر و رویداد", type: "expense", assetId: A.USD },
    { code: "5900", name: "هزینه متفرقه", type: "expense", assetId: A.USD },
  ];
  const acc = await db.insert(accounts).values(acctRows).returning();
  const C = Object.fromEntries(acc.map((a) => [a.code, a.id]));

  /* Opening balances ------------------------------------------------ */
  const openingCash: { code: string; asset: string; qty: string; base: string }[] = [
    { code: "1010", asset: "IRT", qty: "1200000000", base: "12000" },
    { code: "1020", asset: "IRT", qty: "450000000", base: "4500" },
    { code: "1030", asset: "IRT", qty: "50000000", base: "500" },
    { code: "1100", asset: "USDT", qty: "8000", base: "8000" },
    { code: "1110", asset: "USDT", qty: "5000", base: "5000" },
    { code: "1500", asset: "USDT", qty: "6000", base: "6000" },
    { code: "1510", asset: "IRT", qty: "300000000", base: "3000" },
    { code: "1520", asset: "USDT", qty: "4500", base: "4500" },
  ];
  const openingTotal = openingCash.reduce((s, o) => s.add(o.base), D("0"));
  await postEntry({
    entryDate: m(-14),
    type: "opening",
    description: "افتتاحیه — نقد، بانک و استیبل‌کوین",
    postings: [
      ...openingCash.map((o) => ({
        accountId: C[o.code],
        assetId: A[o.asset],
        quantity: o.qty,
        baseValue: o.base,
      })),
      {
        accountId: C["3010"],
        assetId: A.USD,
        quantity: openingTotal.neg().toString(),
        baseValue: openingTotal.neg().toString(),
      },
    ],
  });

  const openingHoldings = [
    { code: "1200", asset: "BTC", qty: "0.35", base: "21000", date: m(-14) },
    { code: "1210", asset: "ETH", qty: "4", base: "9600", date: m(-13) },
    { code: "1300", asset: "GOLD18", qty: "120", base: "6600", date: m(-12) },
    { code: "1400", asset: "KIAN", qty: "20000", base: "9000", date: m(-10) },
  ];
  for (const h of openingHoldings) {
    await postEntry({
      entryDate: h.date,
      type: "opening",
      description: `افتتاحیه — ${h.asset}`,
      postings: [
        { accountId: C[h.code], assetId: A[h.asset], quantity: h.qty, baseValue: h.base },
        {
          accountId: C["3010"],
          assetId: A.USD,
          quantity: D(h.base).neg().toString(),
          baseValue: D(h.base).neg().toString(),
        },
      ],
      openLot: { accountId: C[h.code], assetId: A[h.asset], quantity: h.qty, costBase: h.base },
    });
  }

  /* Income & expenses ---------------------------------------------- */
  for (let i = 6; i >= 1; i--) {
    await recordIncome({
      entryDate: m(-i),
      description: "حقوق ماهانه",
      cashAccountId: C["1010"],
      categoryAccountId: C["4010"],
      assetId: A.IRT,
      quantity: "320000000",
      baseValue: "3200",
    });
    await recordExpense({
      entryDate: m(-i),
      description: "اجاره مسکن",
      cashAccountId: C["1010"],
      categoryAccountId: C["5020"],
      assetId: A.IRT,
      quantity: "90000000",
      baseValue: "900",
    });
    await recordExpense({
      entryDate: m(-i),
      description: "خوراک و مخارج خانه",
      cashAccountId: C["1010"],
      categoryAccountId: C["5010"],
      assetId: A.IRT,
      quantity: `${70000000 + i * 1500000}`,
      baseValue: `${700 + i * 15}`,
    });
  }

  /* Trades ---------------------------------------------------------- */
  await recordBuy({
    entryDate: m(-5),
    description: "خرید بیت‌کوین",
    assetAccountId: C["1200"],
    cashAccountId: C["1100"],
    assetId: A.BTC,
    quantity: "0.05",
    cashAssetId: A.USDT,
    cashQuantity: "4600",
    baseValue: "4600",
    feeBase: "9",
    feeAccountId: C["5040"],
  });
  await recordBuy({
    entryDate: m(-3),
    description: "خرید اتریوم",
    assetAccountId: C["1210"],
    cashAccountId: C["1110"],
    assetId: A.ETH,
    quantity: "1.5",
    cashAssetId: A.USDT,
    cashQuantity: "4200",
    baseValue: "4200",
    feeBase: "6",
    feeAccountId: C["5040"],
  });
  await recordSell({
    entryDate: m(-1),
    description: "فروش بخشی از بیت‌کوین",
    assetAccountId: C["1200"],
    cashAccountId: C["1100"],
    assetId: A.BTC,
    quantity: "0.03",
    cashAssetId: A.USDT,
    cashQuantity: "2850",
    baseValue: "2850",
    feeBase: "0",
    pnlAccountId: C["4100"],
  });

  /* Debts & installments -------------------------------------------- */
  const [loan] = await db
    .insert(debts)
    .values({
      creditor: "بانک ملت",
      title: "وام مسکن",
      principalBase: "8000",
      interestRate: "18",
      startDate: m(-6),
      accountId: C["2010"],
    })
    .returning();
  await postEntry({
    entryDate: m(-6),
    type: "debt",
    description: "دریافت وام مسکن از بانک ملت",
    postings: [
      { accountId: C["1010"], assetId: A.IRT, quantity: "800000000", baseValue: "8000" },
      { accountId: C["2010"], assetId: A.IRT, quantity: "-800000000", baseValue: "-8000" },
    ],
  });
  await db.insert(installments).values(
    Array.from({ length: 24 }, (_, i) => ({
      debtId: loan.id,
      seq: i + 1,
      dueDate: m(-6 + i),
      amountBase: "390",
    })),
  );

  const [car] = await db
    .insert(debts)
    .values({
      creditor: "لیزینگ ایران‌خودرو",
      title: "اقساط خودرو",
      principalBase: "6000",
      interestRate: "21",
      startDate: m(-4),
      accountId: C["2020"],
    })
    .returning();
  await postEntry({
    entryDate: m(-4),
    type: "debt",
    description: "ثبت مانده اقساط خودرو",
    postings: [
      { accountId: C["3010"], assetId: A.USD, quantity: "6000", baseValue: "6000" },
      { accountId: C["2020"], assetId: A.IRT, quantity: "-600000000", baseValue: "-6000" },
    ],
  });
  await db.insert(installments).values(
    Array.from({ length: 20 }, (_, i) => ({
      debtId: car.id,
      seq: i + 1,
      dueDate: m(-4 + i),
      amountBase: "330",
    })),
  );

  const duePast = await db
    .select()
    .from(installments)
    .where(sql`${installments.dueDate} < ${today}`);
  for (const i of duePast) {
    await payInstallment(i.id, C["1010"]);
  }

  /* Goals, funds, events, plans -------------------------------------- */
  await db.insert(goals).values([
    { name: "خرید خانه", description: "پیش‌پرداخت آپارتمان", targetBase: "120000", targetDate: m(36), priority: 1, fundAccountId: C["1520"] },
    { name: "سفر اروپا", description: "سفر خانوادگی تابستان", targetBase: "9000", targetDate: m(10), priority: 2, fundAccountId: C["1500"] },
    { name: "تحصیل فرزند", description: "صندوق آموزش", targetBase: "25000", targetDate: m(60), priority: 3, fundAccountId: C["1510"] },
  ]);

  await db.insert(funds).values([
    { name: "صندوق اضطراری", kind: "emergency", targetBase: "12000", accountId: C["1500"], note: "معادل ۶ ماه هزینه" },
    { name: "صندوق حمایت خانواده", kind: "family_support", targetBase: "6000", accountId: C["1510"] },
    { name: "ذخیره فرصت سرمایه‌گذاری", kind: "reserve", targetBase: "10000", accountId: C["1110"] },
  ]);

  await db.insert(events).values([
    { name: "سفر ترکیه", category: "trip", eventDate: m(3), budgetBase: "3000" },
    { name: "جشن سالگرد", category: "ceremony", eventDate: m(1), budgetBase: "600" },
    { name: "هدیه تولد مادر", category: "gift", eventDate: m(2), budgetBase: "350" },
    { name: "تعویض لپ‌تاپ", category: "purchase", eventDate: m(5), budgetBase: "2200" },
  ]);

  await db.insert(plannedTransactions).values([
    { title: "شارژ ماهانه صندوق اضطراری", plannedDate: m(1), direction: "outflow", amountBase: "400", fromAccountId: C["1010"], toAccountId: C["1500"], recurrence: "monthly" },
    { title: "پس‌انداز هدف خانه", plannedDate: m(1), direction: "outflow", amountBase: "800", fromAccountId: C["1010"], toAccountId: C["1520"], recurrence: "monthly" },
    { title: "پاداش پایان سال", plannedDate: m(4), direction: "inflow", amountBase: "2500", toAccountId: C["1010"], recurrence: "yearly" },
    { title: "بیمه عمر", plannedDate: m(2), direction: "outflow", amountBase: "450", fromAccountId: C["1010"], toAccountId: C["5900"], recurrence: "yearly" },
  ]);

  await db.insert(obligations).values([
    { title: "اجاره ماهانه", amountBase: "900", dueDate: m(1), recurrence: "monthly" },
    { title: "شهریه مدرسه", amountBase: "1400", dueDate: m(6), recurrence: "yearly" },
    { title: "بیمه خودرو", amountBase: "320", dueDate: m(2), recurrence: "yearly" },
  ]);

  await db.insert(budgets).values([
    { name: "خوراک ماهانه", periodStart: today.slice(0, 8) + "01", periodEnd: addMonthsIso(today.slice(0, 8) + "01", 1), accountId: C["5010"], amountBase: "800" },
    { name: "حمل‌ونقل", periodStart: today.slice(0, 8) + "01", periodEnd: addMonthsIso(today.slice(0, 8) + "01", 1), accountId: C["5030"], amountBase: "250" },
  ]);

  /* Historical snapshots (12 months) ---------------------------------- */
  for (let i = 12; i >= 1; i--) {
    const growth = 1 + (12 - i) * 0.021;
    const assetsTotal = D("72000").mul(String(growth));
    const liab = D("14000").sub(D(String((12 - i) * 380)));
    const snapDate = m(-i);
    const [snap] = await db
      .insert(snapshots)
      .values({
        asOf: snapDate,
        baseCurrency: "USD",
        totalAssets: assetsTotal.toFixed(2),
        totalLiabilities: liab.toFixed(2),
        netWorth: assetsTotal.sub(liab).toFixed(2),
      })
      .returning();
    await db.insert(snapshotLines).values([
      { snapshotId: snap.id, assetId: A.BTC, quantity: "0.37", priceBase: D("70000").mul(String(growth)).toFixed(2), valueBase: D("25900").mul(String(growth)).toFixed(2) },
      { snapshotId: snap.id, assetId: A.USDT, quantity: "19000", priceBase: "1", valueBase: "19000" },
    ]);
  }

  await db.insert(users).values({ name: "مالک خانواده", role: "owner" });
  await db.insert(settings).values([
    { key: "base_currency", value: "USD" },
    { key: "digit_style", value: "fa" },
    { key: "theme", value: "system" },
    { key: "irt_rate", value: "190000" },
  ]);
}
