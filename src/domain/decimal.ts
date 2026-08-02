/**
 * Exact decimal arithmetic for money & crypto quantities.
 * Implemented on BigInt with a fixed scale of 18 fractional digits.
 * No floating point is ever used for balances, costs or P&L.
 */
export const SCALE = 18;
const ONE = 10n ** BigInt(SCALE);

export type DecimalInput = string | number | bigint | Decimal;

function parse(input: DecimalInput): bigint {
  if (input instanceof Decimal) return input.raw;
  if (typeof input === "bigint") return input * ONE;
  const s = String(input ?? "0").trim();
  if (s === "" || s === "-" || s === "." || s.toLowerCase() === "nan") return 0n;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const [intPart = "0", fracPartRaw = ""] = body.split(".");
  const frac = (fracPartRaw + "0".repeat(SCALE)).slice(0, SCALE);
  const digitsOnly = (v: string) => v.replace(/[^0-9]/g, "") || "0";
  const value = BigInt(digitsOnly(intPart)) * ONE + BigInt(digitsOnly(frac));
  return neg ? -value : value;
}

export class Decimal {
  readonly raw: bigint;

  private constructor(raw: bigint) {
    this.raw = raw;
  }

  static from(input: DecimalInput): Decimal {
    return new Decimal(parse(input));
  }

  static zero(): Decimal {
    return new Decimal(0n);
  }

  static sum(values: DecimalInput[]): Decimal {
    return values.reduce<Decimal>((acc, v) => acc.add(v), Decimal.zero());
  }

  add(other: DecimalInput): Decimal {
    return new Decimal(this.raw + parse(other));
  }

  sub(other: DecimalInput): Decimal {
    return new Decimal(this.raw - parse(other));
  }

  mul(other: DecimalInput): Decimal {
    return new Decimal((this.raw * parse(other)) / ONE);
  }

  div(other: DecimalInput): Decimal {
    const d = parse(other);
    if (d === 0n) return Decimal.zero();
    return new Decimal((this.raw * ONE) / d);
  }

  neg(): Decimal {
    return new Decimal(-this.raw);
  }

  abs(): Decimal {
    return new Decimal(this.raw < 0n ? -this.raw : this.raw);
  }

  isZero(): boolean {
    return this.raw === 0n;
  }

  isNegative(): boolean {
    return this.raw < 0n;
  }

  isPositive(): boolean {
    return this.raw > 0n;
  }

  cmp(other: DecimalInput): number {
    const o = parse(other);
    return this.raw === o ? 0 : this.raw > o ? 1 : -1;
  }

  gt(other: DecimalInput) {
    return this.cmp(other) > 0;
  }
  gte(other: DecimalInput) {
    return this.cmp(other) >= 0;
  }
  lt(other: DecimalInput) {
    return this.cmp(other) < 0;
  }
  lte(other: DecimalInput) {
    return this.cmp(other) <= 0;
  }

  min(other: DecimalInput): Decimal {
    return this.lte(other) ? this : Decimal.from(other);
  }

  /** Canonical string with full 18-digit scale trimmed of trailing zeros. */
  toString(): string {
    const neg = this.raw < 0n;
    const v = neg ? -this.raw : this.raw;
    const int = v / ONE;
    const frac = (v % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
    return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
  }

  /** Fixed-precision string, half-up rounding. Safe for storage & display. */
  toFixed(dp = 2): string {
    const neg = this.raw < 0n;
    const v = neg ? -this.raw : this.raw;
    const factor = 10n ** BigInt(SCALE - dp);
    const rounded = (v + factor / 2n) / factor;
    const s = rounded.toString().padStart(dp + 1, "0");
    const int = s.slice(0, s.length - dp) || "0";
    const frac = dp > 0 ? s.slice(s.length - dp) : "";
    return `${neg && rounded !== 0n ? "-" : ""}${int}${dp > 0 ? "." + frac : ""}`;
  }

  toNumber(): number {
    return Number(this.toString());
  }
}

export const D = Decimal.from;
