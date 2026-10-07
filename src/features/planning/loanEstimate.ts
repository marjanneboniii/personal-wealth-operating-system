import { D } from "@/domain/decimal";
/** Equal monthly payments; excludes penalties, insurance and changing rates. */
export function estimateLoan(principal: string, annualRate: string, months: number, fees = "0") {
  const p = D(principal), fee = D(fees), annual = D(annualRate);
  if (!p.gt(0) || annual.lt(0) || annual.gt(100) || !Number.isInteger(months) || months < 1 || months > 600 || fee.lt(0) || !p.sub(fee).gt(0)) throw new Error("مبلغ، نرخ، تعداد ماه یا کارمزد معتبر نیست.");
  const r = annual.div("1200");
  let factor = D("1");
  for (let i=0;i<months;i++) factor=factor.mul(D("1").add(r));
  const monthly = r.isZero() ? p.div(String(months)) : p.mul(r).mul(factor).div(factor.sub("1"));
  const total = monthly.mul(String(months));
  return {monthly:monthly.toFixed(0),total:total.toFixed(0),netReceived:p.sub(fee).toFixed(0),cost:total.sub(p).add(fee).toFixed(0)};
}
