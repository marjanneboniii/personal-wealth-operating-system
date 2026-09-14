/**
 * خرید و فروش دارایی — which asset may be traded against which money, and the
 * price arithmetic the form shows and the ledger entry freezes.
 *
 * PRODUCT RULES
 *   • A trade always settles in MONEY: Toman, or a USD stablecoin (USDT, USDC…).
 *     Crypto, gold, tokenised metal and shares are positions — never a payment
 *     account.
 *   • Iranian-market assets — «سهام بورسی», «صندوق بورسی» (gold funds included),
 *     online melted gold, and registry assets (property, vehicle) — settle in
 *     Toman through a BANK account only. Stablecoin wallets and cash boxes are
 *     simply not offered for them.
 *   • A stablecoin (or USD) against Toman or another stablecoin is a CONVERSION
 *     (سواپ): the ledger books it as `fx`, without FIFO lots.
 *
 * PURE: no database, no Next — imported by the client form and the server
 * action alike, so the two can never disagree about what is allowed.
 */
import { D } from "@/domain/decimal";

export const STABLECOIN_SYMBOLS: ReadonlySet<string> = new Set([
  "USDT", "USDC", "USDG", "USDE", "USDS", "PYUSD", "BUSD", "DAI", "USDD", "FDUSD",
]);

const TOMAN_SYMBOLS: ReadonlySet<string> = new Set(["IRT", "IRR"]);

/** Asset-class codes of Tehran-exchange instruments (features/funds/service CLASS_SEED). */
const TOMAN_ONLY_CLASS_CODES: ReadonlySet<string> = new Set(["fund", "stock", "mutualfund"]);
const TOMAN_ONLY_CLASS_NAMES: ReadonlySet<string> = new Set([
  "صندوق سرمایه‌گذاری",
  "صندوق سرمایه گذاری",
  "صندوق",
  "صندوق بورسی",
  "سهام",
  "سهامی",
  "سهام بورسی",
  "طلای آب‌شده",
  "طلای آب شده",
]);
/** Market-catalogue kinds of the same instruments (features/pricing/wallexKinds). */
const TOMAN_ONLY_KINDS: ReadonlySet<string> = new Set(["ir_fund", "ir_stock"]);
/**
 * Domestic gold held in grams (طلای آب‌شده آنلاین). Tokenised metal (PAXG,
 * XAUT) shares the «gold» class but trades against Tether, so the domestic
 * product is recognised by its symbol.
 */
const DOMESTIC_GOLD_SYMBOLS: ReadonlySet<string> = new Set(["GOLD18", "GOLD24"]);

export type TradeSide = "buy" | "sell";
export type SettlementUnit = "toman" | "stablecoin" | "usd";
/** The unit a unit price is typed in: Toman, or Tether for every USD-faced settlement. */
export type PriceUnit = "IRT" | "USDT";

export type TradeInstrument = {
  symbol?: string | null;
  classCode?: string | null;
  className?: string | null;
  /** market-catalogue kind, when known (client side) */
  kind?: string | null;
};

/** The account a trade settles through. A bare symbol is accepted for convenience. */
export type SettlementAccount = {
  symbol?: string | null;
  /** `wallets.kind` — bank | cash | exchange | hot | cold | fund */
  walletKind?: string | null;
  name?: string | null;
};

const sym = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const asAccount = (settle: SettlementAccount | string | null | undefined): SettlementAccount =>
  typeof settle === "string" || settle == null ? { symbol: settle ?? null } : settle;

export const isStablecoin = (symbol: string | null | undefined) => STABLECOIN_SYMBOLS.has(sym(symbol));

/** What an account may settle a trade in — `null` when it is a position, not money. */
export function settlementUnitOf(symbol: string | null | undefined): SettlementUnit | null {
  const s = sym(symbol);
  if (TOMAN_SYMBOLS.has(s)) return "toman";
  if (STABLECOIN_SYMBOLS.has(s)) return "stablecoin";
  if (s === "USD") return "usd";
  return null;
}

export function priceUnitFor(settleSymbol: string | null | undefined): PriceUnit {
  return settlementUnitOf(settleSymbol) === "toman" ? "IRT" : "USDT";
}

/**
 * A Toman account held at a bank. An account without a wallet (older charts)
 * counts as a bank only when its name says so — a «صندوق خانگی» cash box never does.
 */
export function isTomanBankAccount(settle: SettlementAccount | string | null | undefined): boolean {
  const account = asAccount(settle);
  if (settlementUnitOf(account.symbol) !== "toman") return false;
  const kind = (account.walletKind ?? "").trim().toLowerCase();
  if (kind) return kind === "bank";
  return /بانک|bank/i.test(account.name ?? "");
}

/** Iranian-market instruments that settle through a Toman bank account only. */
export function isTomanOnlyInstrument(asset: TradeInstrument): boolean {
  if (asset.kind && TOMAN_ONLY_KINDS.has(asset.kind)) return true;
  if (DOMESTIC_GOLD_SYMBOLS.has(sym(asset.symbol))) return true;
  const code = (asset.classCode ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (TOMAN_ONLY_CLASS_CODES.has(code)) return true;
  return TOMAN_ONLY_CLASS_NAMES.has((asset.className ?? "").trim());
}

/** A stablecoin or dollar position moves by conversion, not by a FIFO trade. */
export function tradeRouteFor(asset: TradeInstrument): "conversion" | "trade" {
  const s = sym(asset.symbol);
  return STABLECOIN_SYMBOLS.has(s) || s === "USD" ? "conversion" : "trade";
}

export const TOMAN_ONLY_MESSAGE = "این دارایی فقط از طریق حساب بانکی تومانی خرید و فروش می‌شود.";

/** Why this pair cannot be traded, in Persian — or `null` when it can. */
export function tradePairError(
  side: TradeSide,
  asset: TradeInstrument,
  settle: SettlementAccount | string | null | undefined,
): string | null {
  const account = asAccount(settle);
  const assetSymbol = sym(asset.symbol);
  if (!assetSymbol) return "دارایی معامله مشخص نیست.";
  if (TOMAN_SYMBOLS.has(assetSymbol)) return "تومان دارایی قابل خرید یا فروش نیست؛ برای جابه‌جایی پول از «انتقال» استفاده کنید.";
  const unit = settlementUnitOf(account.symbol);
  if (!unit) {
    return side === "buy"
      ? "پرداخت فقط از حساب تومانی یا کیف پول استیبل‌کوین انجام می‌شود."
      : "وجه فروش فقط به حساب تومانی یا کیف پول استیبل‌کوین واریز می‌شود.";
  }
  if (sym(account.symbol) === assetSymbol) return "دارایی و حساب پرداخت/دریافت نمی‌توانند یکی باشند.";
  if (isTomanOnlyInstrument(asset) && !isTomanBankAccount(account)) return TOMAN_ONLY_MESSAGE;
  return null;
}

/** Property and vehicle sales: Toman, into a bank account — nothing else. */
export function registrySaleError(settle: SettlementAccount | string | null | undefined): string | null {
  return isTomanBankAccount(settle) ? null : "وجه فروش ملک و خودرو فقط به حساب بانکی تومانی واریز می‌شود.";
}

export type TradeQuote = {
  /** total in the price unit (what leaves or reaches the settlement account) */
  total: string;
  totalToman: string;
  totalUsdt: string | null;
  unitToman: string;
  unitUsdt: string | null;
};

/**
 * quantity × unit price, with the Toman and Tether equivalents side by side.
 * `usdtToman` is Toman per 1 USDT; without it the Tether figures are `null`
 * for a Toman-priced trade (and a Tether-priced trade cannot be valued).
 */
export function quoteTrade(input: {
  quantity: string;
  unitPrice: string;
  priceUnit: PriceUnit;
  usdtToman?: string | null;
}): TradeQuote | null {
  const qty = safe(input.quantity);
  const price = safe(input.unitPrice);
  if (!qty || !price || qty.lte(0) || price.lte(0)) return null;
  const usdt = safe(input.usdtToman ?? "");
  const hasUsdt = !!usdt && usdt.gt(0);
  const total = qty.mul(price);
  if (input.priceUnit === "IRT") {
    return {
      total: total.toString(),
      totalToman: total.toString(),
      totalUsdt: hasUsdt ? total.div(usdt!).toString() : null,
      unitToman: price.toString(),
      unitUsdt: hasUsdt ? price.div(usdt!).toString() : null,
    };
  }
  if (!hasUsdt) return null;
  return {
    total: total.toString(),
    totalToman: total.mul(usdt!).toString(),
    totalUsdt: total.toString(),
    unitToman: price.mul(usdt!).toString(),
    unitUsdt: price.toString(),
  };
}

function safe(value: string) {
  try {
    return value ? D(value) : null;
  } catch {
    return null;
  }
}
