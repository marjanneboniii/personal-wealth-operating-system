/**
 * Occupations — what a person does, used ONLY to put the income sources they
 * are likely to record first. Every source stays available to everyone; a
 * retiree who freelances simply picks both.
 *
 * PURE: shared by settings, the setup wizard and the transaction form.
 */

export type Occupation = {
  code: string;
  label: string;
  /** Income category codes (features/categories/catalog) offered first, in order. */
  suggest: readonly string[];
};

export const OCCUPATIONS: readonly Occupation[] = [
  { code: "employee_private", label: "کارمند بخش خصوصی", suggest: ["INC-SAL-NET", "INC-SAL-BONUS", "INC-SAL-OVERTIME", "INC-SAL-ALLOW"] },
  { code: "employee_government", label: "کارمند دولت", suggest: ["INC-SAL-NET", "INC-SAL-BONUS", "INC-SAL-ALLOW", "INC-SAL-ARREARS"] },
  { code: "student", label: "دانشجو", suggest: ["INC-SUP-FAMILY", "INC-SUP-SCHOLAR", "INC-BIZ-FREELANCE", "INC-BIZ-TEACH"] },
  { code: "homemaker", label: "خانه‌دار", suggest: ["INC-SUP-FAMILY", "INC-SUP-SUBSIDY", "INC-INV-INTEREST"] },
  { code: "freelancer", label: "فریلنسر", suggest: ["INC-BIZ-FREELANCE", "INC-BIZ-TEACH", "INC-BIZ-COMMISSION"] },
  { code: "employer", label: "کارفرما", suggest: ["INC-BIZ-PROFIT", "INC-BIZ-SALES"] },
  { code: "entrepreneur", label: "کارآفرین", suggest: ["INC-BIZ-PROFIT", "INC-BIZ-SALES", "INC-BIZ-FREELANCE"] },
  { code: "retired", label: "بازنشسته", suggest: ["INC-PEN-PENSION", "INC-PEN-SUPPLEMENT", "INC-INV-INTEREST"] },
  { code: "other", label: "سایر", suggest: ["INC-OTH-MISC"] },
];

const OCCUPATION_CODES = new Set(OCCUPATIONS.map((o) => o.code));

/** Sources most households receive whatever they do. */
const COMMON_INCOME_CODES = ["INC-INV-INTEREST", "INC-SUP-SUBSIDY"];

/** Valid, de-duplicated occupation codes from untrusted input (array or comma list). */
export function normalizeOccupations(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const seen = new Set<string>();
  for (const value of raw) {
    const code = String(value).trim();
    if (OCCUPATION_CODES.has(code)) seen.add(code);
  }
  return OCCUPATIONS.map((o) => o.code).filter((code) => seen.has(code));
}

/** Income category codes to offer first for these occupations — at most `limit`. */
export function suggestedIncomeCodes(occupations: readonly string[], limit = 6): string[] {
  const out: string[] = [];
  for (const occupation of OCCUPATIONS) {
    if (!occupations.includes(occupation.code)) continue;
    for (const code of occupation.suggest) if (!out.includes(code)) out.push(code);
  }
  for (const code of COMMON_INCOME_CODES) if (!out.includes(code)) out.push(code);
  return out.slice(0, limit);
}
